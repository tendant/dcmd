import { useEffect } from "react";
import { useFileManagerStore } from "../state/fileManagerStore";
import { useGlobalKeyboard } from "./useGlobalKeyboard";
import { DualPaneLayout } from "../components/DualPaneLayout";
import * as commands from "../tauri/commands";

export function App() {
  useGlobalKeyboard();

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
      const startDir = await commands.defaultStartDir();
      const store = useFileManagerStore.getState();
      // Both panes open on the same directory and neither depends on the other,
      // so listing them in sequence made the second wait on the first for no
      // reason. Startup is already over its budget before this point.
      await Promise.all([store.navigate("left", startDir), store.navigate("right", startDir)]);
      void commands.markStartup("panes ready");
    };

    initializePanes().catch((err) => {
      console.error("Failed to initialize panes:", err);
    });
  }, []);

  return <DualPaneLayout />;
}

export default App;
