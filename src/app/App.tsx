import { useEffect } from "react";
import { useFileManagerStore } from "../state/fileManagerStore";
import { useGlobalKeyboard } from "./useGlobalKeyboard";
import { DualPaneLayout } from "../components/DualPaneLayout";
import * as commands from "../tauri/commands";

export function App() {
  useGlobalKeyboard();

  useEffect(() => {
    const initializePanes = async () => {
      console.log("Initializing panes...");
      let startDir = "/";

      try {
        startDir = await commands.defaultStartDir();
        console.log("✓ Got start directory:", startDir);
      } catch (err) {
        console.error("✗ Could not get home directory, falling back to /:", err);
      }

      try {
        console.log("Navigating panes to:", startDir);
        const store = useFileManagerStore.getState();

        console.log("Navigating left pane...");
        await store.navigate("left", startDir);
        console.log("✓ Left pane ready");

        console.log("Navigating right pane...");
        await store.navigate("right", startDir);
        console.log("✓ Right pane ready");
      } catch (err) {
        console.error("✗ Failed to navigate to start directory:", err);
      }
    };

    initializePanes();
  }, []);

  return <DualPaneLayout />;
}

export default App;
