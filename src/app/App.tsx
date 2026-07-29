import { useEffect } from "react";
import { useFileManagerStore } from "../state/fileManagerStore";
import { useGlobalKeyboard } from "./useGlobalKeyboard";
import { DualPaneLayout } from "../components/DualPaneLayout";
import * as commands from "../tauri/commands";

export function App() {
  useGlobalKeyboard();

  useEffect(() => {
    const initializePanes = async () => {
      let startDir = "/";
      try {
        startDir = await commands.defaultStartDir();
        console.log("Starting directory:", startDir);
      } catch (err) {
        console.warn("Could not get home directory, using /:", err);
        // Fall back to root if home dir fails
      }

      try {
        const store = useFileManagerStore.getState();
        await store.navigate("left", startDir);
        await store.navigate("right", startDir);
      } catch (err) {
        console.error("Failed to navigate to start directory:", err);
      }
    };

    initializePanes();
  }, []);

  return <DualPaneLayout />;
}

export default App;
