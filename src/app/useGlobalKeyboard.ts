import { useEffect } from "react";
import { useFileManagerStore } from "../state/fileManagerStore";

export function useGlobalKeyboard() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const store = useFileManagerStore.getState();

      // Ctrl+L to edit path (works even in input fields for this specific case)
      if ((e.ctrlKey || e.metaKey) && e.key === "l") {
        e.preventDefault();
        const pane = store.activePane;
        store.startEditingPath(pane);
        return;
      }

      // Don't intercept when typing in inputs or textareas
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "Tab": {
          e.preventDefault();
          const nextPane = store.activePane === "left" ? "right" : "left";
          store.setActivePane(nextPane);
          break;
        }

        case "ArrowDown": {
          e.preventDefault();
          const pane = store.activePane;
          const cursor = store.panes[pane].cursor;
          store.setCursor(pane, cursor + 1);
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          const pane = store.activePane;
          const cursor = store.panes[pane].cursor;
          store.setCursor(pane, cursor - 1);
          break;
        }

        case "ArrowDown":
        case "ArrowUp": {
          e.preventDefault();
          const pane = store.activePane;
          const cursor = store.panes[pane].cursor;
          const delta = e.key === "ArrowDown" ? 1 : -1;
          store.setCursor(pane, cursor + delta);
          break;
        }

        case "Enter": {
          e.preventDefault();
          const pane = store.activePane;
          const paneState = store.panes[pane];
          const entry = paneState.entries[paneState.cursor];
          if (entry && entry.kind === "directory") {
            store.navigate(pane, entry.path);
          }
          break;
        }

        case "Backspace": {
          e.preventDefault();
          const pane = store.activePane;
          store.goToParent(pane);
          break;
        }

        case " ": {
          e.preventDefault();
          const pane = store.activePane;
          const paneState = store.panes[pane];
          const entry = paneState.entries[paneState.cursor];
          if (entry) {
            store.toggleSelection(pane, entry.path);
          }
          break;
        }

        case "F2": {
          e.preventDefault();
          const pane = store.activePane;
          const paneState = store.panes[pane];
          const entry = paneState.entries[paneState.cursor];
          if (entry) {
            store.startRenaming(pane, entry.path);
          }
          break;
        }

        case "F5": {
          e.preventDefault();
          store.copySelection();
          break;
        }

        case "F6": {
          e.preventDefault();
          store.moveSelection();
          break;
        }

        case "F7": {
          e.preventDefault();
          const pane = store.activePane;
          store.startCreatingFolder(pane);
          break;
        }

        case "F8": {
          e.preventDefault();
          const pane = store.activePane;
          const paneState = store.panes[pane];
          const hasSelection = paneState.selected.size > 0;
          const itemsToDelete = hasSelection ? paneState.selected.size : 1;
          if (
            window.confirm(
              `Delete ${itemsToDelete} item${itemsToDelete !== 1 ? "s" : ""}?`
            )
          ) {
            if (hasSelection) {
              store.trashSelection(pane);
            } else {
              const entry = paneState.entries[paneState.cursor];
              if (entry) {
                store.trashSelection(pane);
              }
            }
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
