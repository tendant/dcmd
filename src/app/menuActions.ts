import { entryAtCursor, type FileManagerState, type SortKey } from "../state/fileManagerStore";
import * as commands from "../tauri/commands";

/**
 * What each menu id does, in terms of the same store actions the keyboard uses.
 *
 * The menu owns the accelerator for everything listed here, so these commands
 * are deliberately absent from the keyboard handler — both would fire otherwise.
 * Contextual commands (Escape, Backspace, Space, typing) are not here and cannot
 * be: an accelerator is one fixed command, and those change with state.
 */
export const MENU_ACTIONS: Record<string, (s: FileManagerState) => void> = {
  new_folder: (s) => s.startCreatingFolder(s.activePane),
  rename: (s) => {
    const entry = entryAtCursor(s.panes[s.activePane]);
    if (entry) s.startRenaming(s.activePane, entry.path);
  },
  copy: (s) => void s.requestTransfer("copy"),
  move: (s) => void s.requestTransfer("move"),
  reveal: (s) => {
    const entry = entryAtCursor(s.panes[s.activePane]);
    if (entry) void s.revealEntry(s.activePane, entry.path);
  },
  copy_path: (s) => {
    const entry = entryAtCursor(s.panes[s.activePane]);
    if (entry) void navigator.clipboard.writeText(entry.path).catch(() => {});
  },
  trash: (s) => s.requestTrash(s.activePane),
  preview: (s) => void s.openPreview(s.activePane),
  open: (s) => {
    const pane = s.panes[s.activePane];
    // Same three-way meaning Enter has, since this is the menu's version of it.
    if (pane.cursor === 0) return void s.goToParent(s.activePane);
    const entry = entryAtCursor(pane);
    if (!entry) return;
    if (entry.kind === "directory") void s.navigate(s.activePane, entry.path);
    else void s.openEntry(s.activePane, entry.path);
  },

  back: (s) => void s.goBack(s.activePane),
  forward: (s) => void s.goForward(s.activePane),
  up: (s) => void s.goToParent(s.activePane),
  edit_path: (s) => s.startEditingPath(s.activePane),
  refresh: (s) => void s.refresh(s.activePane),
  bookmark: (s) => {
    const path = s.panes[s.activePane].path;
    if (s.isBookmarked(path)) s.removeBookmark(path);
    else s.addBookmark(s.activePane);
  },
  add_host: (s) => void s.requestAddRemote(s.activePane),
  open_log: () => void commands.openLog().catch(() => {}),
  switch_pane: (s) => s.setActivePane(s.activePane === "left" ? "right" : "left"),

  select_all: (s) => s.selectAll(s.activePane),
  deselect_all: (s) => s.clearSelection(s.activePane),
  invert_selection: (s) => s.invertSelection(s.activePane),
  calc_size: (s) => {
    const entry = entryAtCursor(s.panes[s.activePane]);
    if (entry?.kind === "directory") void s.computeDirSize(s.activePane, entry.path);
  },
  clear_filter: (s) => s.clearFilter(s.activePane),
  cancel: (s) => {
    // Escape's order: the transfer first, then any size walks.
    if (s.transfer) s.cancelTransfer();
    else s.cancelAllDirSizes(s.activePane);
  },

  toggle_hidden: (s) => s.toggleHidden(s.activePane),
  toggle_places: (s) => s.togglePlaces(),
  split_even: (s) => s.resetSplit(),
  split_wider: (s) => s.nudgeSplit(0.05),
  split_narrower: (s) => s.nudgeSplit(-0.05),
  toggle_collapse: (s) =>
    s.toggleCollapse(s.activePane === "left" ? "right" : "left"),

  ...Object.fromEntries(
    (["name", "size", "modified", "created", "kind"] as SortKey[]).map((key) => [
      `sort_${key}`,
      (s: FileManagerState) => s.setSort(s.activePane, key),
    ]),
  ),
};

/** Every id the menu can emit. Exported so a mismatch is a test failure. */
export const MENU_IDS = Object.keys(MENU_ACTIONS);
