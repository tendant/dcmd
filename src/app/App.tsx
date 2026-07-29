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
      let retries = 0;
      const maxRetries = 10;

      // Retry getting home directory in case Tauri isn't ready
      while (retries < maxRetries) {
        try {
          startDir = await commands.defaultStartDir();
          console.log("✓ Got start directory:", startDir);
          break;
        } catch (err) {
          retries++;
          console.warn(`✗ Attempt ${retries}/${maxRetries} failed to get home directory:`, err);
          if (retries >= maxRetries) {
            console.error("✗ Could not get home directory after retries, using /");
            startDir = "/";
          } else {
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
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

    // Wait for Tauri to be ready before initializing
    const timer = setTimeout(initializePanes, 1000);
    return () => clearTimeout(timer);
  }, []);

  return <DualPaneLayout />;
}

export default App;
