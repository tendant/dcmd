import { useEffect } from "react";
import { useFileManagerStore } from "../state/fileManagerStore";
import { useGlobalKeyboard } from "./useGlobalKeyboard";
import { DualPaneLayout } from "../components/DualPaneLayout";
import * as commands from "../tauri/commands";

// Check if Tauri is available
function isTauriAvailable(): boolean {
  return typeof (window as any).__TAURI__ !== "undefined";
}

export function App() {
  useGlobalKeyboard();

  useEffect(() => {
    const initializePanes = async () => {
      console.log("Initializing panes...");
      console.log("Tauri available?", isTauriAvailable());

      let startDir = "/";
      let retries = 0;
      const maxRetries = 20;

      // Wait for Tauri to become available
      while (!isTauriAvailable() && retries < maxRetries) {
        retries++;
        console.log(`Waiting for Tauri... (attempt ${retries}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (!isTauriAvailable()) {
        console.error("✗ Tauri not available after 10 seconds, using / fallback");
        startDir = "/";
      } else {
        // Now try to get the home directory
        retries = 0;
        while (retries < 5) {
          try {
            startDir = await commands.defaultStartDir();
            console.log("✓ Got start directory:", startDir);
            break;
          } catch (err) {
            retries++;
            console.warn(`✗ Attempt ${retries}/5 failed to get home directory:`, err);
            if (retries >= 5) {
              console.error("✗ Could not get home directory after retries, using /");
              startDir = "/";
            } else {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
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

    // Start initialization immediately
    initializePanes();
  }, []);

  return <DualPaneLayout />;
}

export default App;
