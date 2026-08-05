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
      // filter behind it. Each handles its own Escape.
      if (store.dialog || store.preview || store.palette) return;

      // Don't intercept when typing in inputs or textareas
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Every Cmd/Ctrl shortcut is owned by the application menu, which fires
      // its own accelerator. Handling them here as well would run each command
      // twice. What remains below is the contextual keys, which cannot be
      // accelerators because their meaning depends on state.
      if (e.metaKey || e.ctrlKey) return;

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
          // Anything the pane is telling you goes, always, and without using up
          // the keypress. Being told something is advisory rather than an
          // operation to unwind, so it must not cost the Escape that was going
          // to clear a filter — otherwise the message makes you press it twice.
          store.dismissPaneMessages(pane);

          // Then unwind one thing at a time, most transient first: a pending
          // connection, then a running transfer, then a filter, then background
          // size walks. Connecting goes first because it is the one that blocks
          // the pane entirely — nothing else in it can proceed until it ends.
          if (store.cancelRemoteConnect(pane)) {
            // Handled.
          } else if (store.transfer) {
            store.cancelTransfer();
          } else if (store.panes[pane].filter) {
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
