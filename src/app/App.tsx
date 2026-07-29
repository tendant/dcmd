import { useEffect } from "react";
import { useFileManagerStore } from "../state/fileManagerStore";
import { useGlobalKeyboard } from "./useGlobalKeyboard";
import { DualPaneLayout } from "../components/DualPaneLayout";
import * as commands from "../tauri/commands";

export function App() {
  useGlobalKeyboard();

  useEffect(() => {
    const initializePanes = async () => {
      try {
        const startDir = await commands.defaultStartDir();
        const store = useFileManagerStore.getState();
        await store.navigate("left", startDir);
        await store.navigate("right", startDir);
      } catch (err) {
        console.error("Failed to initialize panes:", err);
      }
    };

    initializePanes();
  }, []);

  return <DualPaneLayout />;
}

export default App;
