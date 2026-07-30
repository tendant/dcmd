import { useEffect } from "react";
import { entryAtCursor, useFileManagerStore } from "../state/fileManagerStore";

type Store = ReturnType<typeof useFileManagerStore.getState>;

/**
 * Trash whatever the active pane would act on, after confirming. Deletion always
 * asks first, and the confirmation names the files rather than showing the bare
 * count window.confirm was limited to.
 */
function confirmAndTrash(store: Store) {
  store.requestTrash(store.activePane);
}

export function useGlobalKeyboard() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const store = useFileManagerStore.getState();

      // A modal owns the keyboard while it is open, or typing would land in the
      // filter behind it. The dialog handles its own Escape.
      if (store.dialog) return;

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

      // macOS reserves F5-F8 for system functions (dictation, Do Not Disturb,
      // media keys), so they never reach the app unless the user holds Fn or
      // enables "Use F1, F2, etc. as standard function keys". Provide Cmd
      // equivalents so the app is usable without fighting the OS, following
      // Finder's bindings where they exist.
      if (e.metaKey || e.ctrlKey) {
        const pane = store.activePane;
        const key = e.key.toLowerCase();

        if (key === "backspace") {
          e.preventDefault();
          confirmAndTrash(store);
          return;
        }
        if (e.shiftKey && key === "n") {
          e.preventDefault();
          store.startCreatingFolder(pane);
          return;
        }
        if (e.shiftKey && key === "c") {
          e.preventDefault();
          store.requestTransfer("copy");
          return;
        }
        if (e.shiftKey && key === "m") {
          e.preventDefault();
          store.requestTransfer("move");
          return;
        }
        if (e.shiftKey && key === "r") {
          e.preventDefault();
          const paneState = store.panes[pane];
          if (paneState.cursor > 0) {
            const entry = entryAtCursor(paneState);
            if (entry) store.startRenaming(pane, entry.path);
          }
          return;
        }
        if (key === "r") {
          // preventDefault matters here: unhandled, Cmd+R reloads the webview
          // and throws away all pane state.
          e.preventDefault();
          store.refresh(pane);
          return;
        }
      }

      switch (e.key) {
        case "Tab": {
          e.preventDefault();
          const nextPane = store.activePane === "left" ? "right" : "left";
          store.setActivePane(nextPane);
          break;
        }

        case "ArrowDown":
        case "ArrowUp": {
          e.preventDefault();
          const pane = store.activePane;
          const paneState = store.panes[pane];
          const delta = e.key === "ArrowDown" ? 1 : -1;
          const newCursor = paneState.cursor + delta;

          if (e.shiftKey) {
            // Shift+Arrow to select range
            const rangeStart = paneState.rangeStart ?? paneState.cursor;
            store.selectRange(pane, rangeStart, newCursor);
          }

          store.setCursor(pane, newCursor);
          break;
        }

        case "Enter": {
          e.preventDefault();
          const pane = store.activePane;
          const paneState = store.panes[pane];
          // Cursor 0 is the synthetic ".." parent entry
          if (paneState.cursor === 0) {
            // Enter on ".." goes to parent
            store.goToParent(pane);
          } else {
            const entry = entryAtCursor(paneState);
            if (entry?.kind === "directory") {
              store.navigate(pane, entry.path);
            } else if (entry) {
              store.openEntry(pane, entry.path);
            }
          }
          break;
        }

        case "Backspace": {
          e.preventDefault();
          const pane = store.activePane;
          const { filter } = store.panes[pane];
          // While filtering, Backspace edits the filter rather than navigating
          // away — leaving the directory mid-search would be surprising.
          if (filter) {
            store.setFilter(pane, filter.slice(0, -1));
          } else {
            store.goToParent(pane);
          }
          break;
        }

        case "Escape": {
          e.preventDefault();
          const pane = store.activePane;
          // Escape clears an active filter first; only once there is nothing to
          // clear does it fall through to aborting directory size walks.
          if (store.panes[pane].filter) {
            store.clearFilter(pane);
          } else {
            store.cancelAllDirSizes(pane);
          }
          break;
        }

        case " ": {
          e.preventDefault();
          const pane = store.activePane;
          const paneState = store.panes[pane];
          // Cursor 0 is the synthetic ".." parent entry, skip it
          if (paneState.cursor > 0) {
            const entry = entryAtCursor(paneState);
            if (entry) {
              store.toggleSelection(pane, entry.path);
              // Directory sizes are expensive, so Space is the only trigger.
              // Pressing it again on a running calculation cancels it.
              if (entry.kind === "directory") {
                if (paneState.dirSizes[entry.path] === "pending") {
                  store.cancelDirSize(pane, entry.path);
                } else {
                  store.computeDirSize(pane, entry.path);
                }
              }
            }
          }
          break;
        }

        case "F2": {
          e.preventDefault();
          const pane = store.activePane;
          const paneState = store.panes[pane];
          // Cursor 0 is the synthetic ".." parent entry, can't rename it
          if (paneState.cursor > 0) {
            const entry = entryAtCursor(paneState);
            if (entry) {
              store.startRenaming(pane, entry.path);
            }
          }
          break;
        }

        case "F5": {
          e.preventDefault();
          store.requestTransfer("copy");
          break;
        }

        case "F6": {
          e.preventDefault();
          store.requestTransfer("move");
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
          confirmAndTrash(store);
          break;
        }

        default: {
          // Any single printable character types into the pane's filter. Keys
          // handled above (Tab, Enter, Space, arrows, F-keys) never reach here,
          // and modifier combos were already returned on, so this cannot
          // swallow a shortcut.
          if (e.key.length === 1 && !e.altKey) {
            e.preventDefault();
            const pane = store.activePane;
            store.setFilter(pane, store.panes[pane].filter + e.key);
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
