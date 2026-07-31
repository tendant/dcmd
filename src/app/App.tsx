import { useEffect } from "react";
import { useFileManagerStore } from "../state/fileManagerStore";
import { useGlobalKeyboard } from "./useGlobalKeyboard";
import { DualPaneLayout } from "../components/DualPaneLayout";
import * as commands from "../tauri/commands";
import { createSettingsSaver, settingsFrom } from "../state/settings";
import { listen } from "@tauri-apps/api/event";
import { MENU_ACTIONS } from "./menuActions";

const saver = createSettingsSaver();

export function App() {
  useGlobalKeyboard();

  useEffect(() => {
    // The menu owns its accelerators, so a command invoked from it reaches the
    // same store action the keyboard would.
    const unlisten = listen<string>("menu://action", (e) => {
      MENU_ACTIONS[e.payload]?.(useFileManagerStore.getState());
    });
    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    // The webview shows its own menu (Reload, Inspect) otherwise, on top of
    // ours. Tauri has no configuration flag for this. Inputs keep theirs, since
    // the native menu is genuinely useful for cut/copy/paste while renaming.
    const suppress = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea")) return;
      e.preventDefault();
    };
    window.addEventListener("contextmenu", suppress);
    return () => window.removeEventListener("contextmenu", suppress);
  }, []);

  useEffect(() => {
    if (!commands.isTauriWebview()) {
      // A browser tab pointed at the dev server reaches this. Vite forwards its
      // console to the terminal, so say plainly where the output is coming from.
      console.error(
        "dcmd is open outside the Tauri webview (probably a browser tab on " +
          "localhost:1420). File operations are unavailable here — use the " +
          "window that `pnpm tauri dev` opens. userAgent: " +
          navigator.userAgent,
      );
      return;
    }

    const initializePanes = async () => {
      const { startDir, settings } = await commands.startupInfo();
      const store = useFileManagerStore.getState();
      store.applySettings(settings);
      saver.prime(settings);
      // Both panes open on the same directory and neither depends on the other,
      // so listing them in sequence made the second wait on the first for no
      // reason. Startup is already over its budget before this point.
      await Promise.all([store.navigate("left", startDir), store.navigate("right", startDir)]);
      void commands.markStartup("panes ready");
      // What the panes actually ended up with. A window that looks empty is
      // either a pane with no rows or a pane that never loaded, and those need
      // different fixes.
      const after = useFileManagerStore.getState().panes;
      void commands.logMessage(
        "info",
        `panes ready: left=${after.left.entries.length} at ${after.left.path}, ` +
          `right=${after.right.entries.length} at ${after.right.path}`,
      );

      // Persist afterwards, so applying the loaded settings does not itself
      // trigger a write.
      unsubscribe = useFileManagerStore.subscribe((state) =>
        saver.schedule(settingsFrom(state)),
      );
    };

    let unsubscribe: (() => void) | undefined;

    initializePanes().catch((err) => {
      console.error("Failed to initialize panes:", err);
      void commands.logMessage("error", `failed to initialize panes: ${String(err)}`);
    });

    return () => {
      unsubscribe?.();
      // A pending change would otherwise be lost on the way out.
      saver.flushNow();
    };
  }, []);

  return <DualPaneLayout />;
}

export default App;
