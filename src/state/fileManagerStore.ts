import { create } from "zustand";
import type { FileEntry } from "../types/fileEntry";
import * as commands from "../tauri/commands";
import type { ConflictPolicy } from "../tauri/commands";

export type PaneId = "left" | "right";

export type RenameMode =
  | { type: "rename"; path: string }
  | { type: "creating" }
  | null;

export interface PaneState {
  path: string;
  entries: FileEntry[];
  selected: Set<string>;
  cursor: number;
  rangeStart: number | null;
  loading: boolean;
  error: string | null;
  renameMode: RenameMode;
  isEditingPath: boolean;
  /** Type-to-filter text; empty means no filter. Resolve rows via visibleEntries(). */
  filter: string;
  /**
   * Directory sizes computed on demand (Space), keyed by path. Directory sizes
   * are never computed during listing — see `directory_size` in the backend.
   * A value of "pending" means a computation is in flight.
   */
  dirSizes: Record<string, number | "pending" | "error">;
}

/**
 * A modal question awaiting the user. Held at the top level rather than per-pane
 * because it blocks interaction with both, and kept in the store rather than using
 * window.confirm so it can name the files involved and be styled.
 */
export type DialogState =
  | {
      kind: "conflict";
      op: "copy" | "move";
      pane: PaneId;
      sources: string[];
      destination: string;
      /** Names that already exist at the destination. */
      names: string[];
    }
  | {
      kind: "confirmTrash";
      pane: PaneId;
      paths: string[];
    };

export interface FileManagerState {
  panes: Record<PaneId, PaneState>;
  activePane: PaneId;
  dialog: DialogState | null;

  setActivePane: (pane: PaneId) => void;
  navigate: (pane: PaneId, path: string) => Promise<void>;
  goToParent: (pane: PaneId) => Promise<void>;
  refresh: (pane: PaneId) => Promise<void>;
  setCursor: (pane: PaneId, index: number) => void;
  toggleSelection: (pane: PaneId, path: string) => void;
  setFilter: (pane: PaneId, filter: string) => void;
  clearFilter: (pane: PaneId) => void;
  setPaneError: (pane: PaneId, message: string | null) => void;
  /** How many entries an operation would act on (selection, else cursor row). */
  targetCount: (pane: PaneId) => number;
  openEntry: (pane: PaneId, path: string) => Promise<void>;
  computeDirSize: (pane: PaneId, path: string) => Promise<void>;
  cancelDirSize: (pane: PaneId, path: string) => void;
  cancelAllDirSizes: (pane: PaneId) => void;
  selectRange: (pane: PaneId, fromIndex: number, toIndex: number) => void;
  clearSelection: (pane: PaneId) => void;

  startCreatingFolder: (pane: PaneId) => void;
  startRenaming: (pane: PaneId, path: string) => void;
  commitMkdir: (pane: PaneId, name: string) => Promise<void>;
  commitRename: (pane: PaneId, path: string, newName: string) => Promise<void>;
  cancelInlineEdit: (pane: PaneId) => void;
  startEditingPath: (pane: PaneId) => void;
  commitPathEdit: (pane: PaneId, newPath: string) => Promise<void>;
  cancelPathEdit: (pane: PaneId) => void;
  copySelection: () => Promise<void>;
  moveSelection: () => Promise<void>;
  trashSelection: (pane: PaneId) => Promise<void>;

  /** Begins a transfer, asking about name clashes first if there are any. */
  requestTransfer: (op: "copy" | "move") => Promise<void>;
  /** Runs a transfer with a decided conflict policy. */
  performTransfer: (
    op: "copy" | "move",
    pane: PaneId,
    sources: string[],
    destination: string,
    policy: ConflictPolicy,
  ) => Promise<void>;
  /** Opens the delete confirmation, which names what it will remove. */
  requestTrash: (pane: PaneId) => void;
  dismissDialog: () => void;
}

/** Pulls a readable message out of whatever the Tauri layer threw. */
const errorMessage = (err: unknown): string =>
  err && typeof err === "object" && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);

/**
 * The entries actually shown in a pane, after its type-to-filter text.
 *
 * Every cursor index, selection range and operation target must resolve through
 * this, never through `entries` directly: while a filter is active the two
 * differ, and reading the unfiltered array would make an operation act on a row
 * the user cannot see.
 */
export const visibleEntries = (paneState: PaneState): FileEntry[] => {
  const needle = paneState.filter.trim().toLowerCase();
  if (!needle) return paneState.entries;
  return paneState.entries.filter((e) => e.name.toLowerCase().includes(needle));
};

/**
 * The entry under the cursor, or null when the cursor is on the synthetic ".."
 * row (display index 0), which is never a real entry. Centralised so the
 * display-index-to-entry-index offset exists in exactly one place.
 */
export const entryAtCursor = (paneState: PaneState): FileEntry | null => {
  if (paneState.cursor <= 0) return null;
  return visibleEntries(paneState)[paneState.cursor - 1] ?? null;
};

/**
 * Paths an operation should act on: the explicit selection when there is one,
 * otherwise the row under the cursor. Acting on the cursor row is what every
 * dual-pane file manager does, and without it operations silently do nothing
 * until the user happens to have pressed Space.
 */
const targetPaths = (paneState: PaneState): string[] => {
  if (paneState.selected.size > 0) return Array.from(paneState.selected);
  const entry = entryAtCursor(paneState);
  return entry ? [entry.path] : [];
};

const defaultPaneState = (path: string): PaneState => ({
  path,
  entries: [],
  selected: new Set(),
  cursor: 0,
  rangeStart: null,
  loading: false,
  error: null,
  renameMode: null,
  isEditingPath: false,
  filter: "",
  dirSizes: {},
});

export const useFileManagerStore = create<FileManagerState>((set, get) => ({
  panes: {
    left: defaultPaneState(""),
    right: defaultPaneState(""),
  },
  activePane: "left",

  setActivePane: (pane) => set({ activePane: pane }),

  navigate: async (pane, path) => {
    // Abandoning the listing abandons its size walks; stop them server-side too
    // rather than letting them run on for minutes against a directory we left.
    get().cancelAllDirSizes(pane);

    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: {
          ...state.panes[pane],
          path,
          loading: true,
          error: null,
          cursor: 0,
          selected: new Set(),
          renameMode: null,
          // A filter belongs to the directory it was typed in; carrying it into
          // a new one would hide rows for no visible reason.
          filter: "",
          dirSizes: {},
        },
      },
    }));

    try {
      const entries = await commands.listDirectory(path);
      set((state) => ({
        panes: {
          ...state.panes,
          [pane]: {
            ...state.panes[pane],
            entries,
            loading: false,
          },
        },
      }));
    } catch (err) {
      let message = "Unknown error";

      if (err && typeof err === "object") {
        // Handle Rust error response from Tauri (e.g., {kind: "...", message: "..."})
        if ("message" in err) {
          message = String((err as any).message);
        } else {
          message = JSON.stringify(err);
        }
      } else if (err instanceof Error) {
        message = err.message;
      } else {
        message = String(err);
      }

      console.error(`Navigate to ${path} failed:`, message);

      set((state) => ({
        panes: {
          ...state.panes,
          [pane]: {
            ...state.panes[pane],
            loading: false,
            error: message,
            entries: [],
          },
        },
      }));
    }
  },

  goToParent: async (pane) => {
    const state = get();
    const currentPath = state.panes[pane].path;
    const parent = currentPath
      .split("/")
      .slice(0, -1)
      .join("/") || "/";

    if (parent !== currentPath) {
      await state.navigate(pane, parent);
    }
  },

  refresh: async (pane) => {
    const before = get().panes[pane];
    const path = before.path;
    if (!path) return;

    // Re-listing must not behave like navigating: a refresh keeps the user where
    // they were. Remember what the cursor was on so it can be restored by path
    // rather than by index, since the index moves when entries appear or vanish.
    const anchorPath = entryAtCursor(before)?.path ?? null;
    const previousCursor = before.cursor;
    const previousSelection = before.selected;

    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: { ...state.panes[pane], loading: true, error: null },
      },
    }));

    try {
      const entries = await commands.listDirectory(path);

      set((state) => {
        const paneState = state.panes[pane];
        const present = new Set(entries.map((e) => e.path));

        // Drop selections and cached sizes for entries that are gone, keep the rest.
        const selected = new Set(
          Array.from(previousSelection).filter((p) => present.has(p)),
        );
        const dirSizes = Object.fromEntries(
          Object.entries(paneState.dirSizes).filter(([p]) => present.has(p)),
        );

        const next = { ...paneState, entries, selected, dirSizes, loading: false, error: null };

        // Prefer landing on the same entry; if it is gone, hold the same slot.
        const visible = visibleEntries(next);
        let cursor = Math.min(previousCursor, visible.length);
        if (anchorPath) {
          const i = visible.findIndex((e) => e.path === anchorPath);
          if (i >= 0) cursor = i + 1;
        }

        return { panes: { ...state.panes, [pane]: { ...next, cursor } } };
      });
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as any).message)
          : String(err);
      set((state) => ({
        panes: {
          ...state.panes,
          [pane]: { ...state.panes[pane], loading: false, error: message },
        },
      }));
    }
  },

  setCursor: (pane, index) => {
    set((state) => {
      const paneState = state.panes[pane];
      // Display indices run 0 (the ".." row) to visible.length (last real row).
      const clamped = Math.max(0, Math.min(index, visibleEntries(paneState).length));
      return {
        panes: {
          ...state.panes,
          [pane]: {
            ...paneState,
            cursor: clamped,
          },
        },
      };
    });
  },

  dialog: null,

  dismissDialog: () => set({ dialog: null }),

  requestTransfer: async (op) => {
    const state = get();
    const active = state.activePane;
    const other: PaneId = active === "left" ? "right" : "left";
    const sources = targetPaths(state.panes[active]);
    const destination = state.panes[other].path;

    if (sources.length === 0 || !destination) {
      state.setPaneError(active, `Nothing to ${op}`);
      return;
    }

    try {
      const names = await commands.checkConflicts(sources, destination);
      if (names.length > 0) {
        // Ask once up front rather than per item: deciding mid-transfer would
        // mean blocking a worker thread waiting on the UI.
        set({ dialog: { kind: "conflict", op, pane: active, sources, destination, names } });
        return;
      }
      await state.performTransfer(op, active, sources, destination, "fail");
    } catch (err) {
      state.setPaneError(active, errorMessage(err));
    }
  },

  performTransfer: async (op, pane, sources, destination, policy) => {
    const state = get();
    set({ dialog: null });

    try {
      const report =
        op === "copy"
          ? await commands.copyEntriesWith(sources, destination, policy)
          : await commands.moveEntriesWith(sources, destination, policy);

      const other: PaneId = pane === "left" ? "right" : "left";
      await state.refresh(pane);
      await state.refresh(other);
      state.clearSelection(pane);

      // A partial result must be stated, not hidden behind an apparent success.
      const parts: string[] = [];
      if (report.failed.length > 0) {
        parts.push(
          `${report.failed.length} failed (${report.failed[0].message}${
            report.failed.length > 1 ? ", …" : ""
          })`,
        );
      }
      if (report.skipped.length > 0) parts.push(`${report.skipped.length} skipped`);
      state.setPaneError(pane, parts.length > 0 ? `${op}: ${parts.join(", ")}` : null);
    } catch (err) {
      state.setPaneError(pane, errorMessage(err));
    }
  },

  requestTrash: (pane) => {
    const state = get();
    const paths = targetPaths(state.panes[pane]);
    if (paths.length === 0) {
      state.setPaneError(pane, "Nothing to delete");
      return;
    }
    set({ dialog: { kind: "confirmTrash", pane, paths } });
  },

  setFilter: (pane, filter) => {
    set((state) => {
      const paneState = state.panes[pane];
      const next = { ...paneState, filter };
      // Changing the filter changes which rows exist, so the cursor must be
      // re-clamped against the new visible list. Landing on the first match is
      // more useful than keeping a stale index.
      const count = visibleEntries(next).length;
      return {
        panes: {
          ...state.panes,
          [pane]: { ...next, cursor: count > 0 ? Math.min(Math.max(paneState.cursor, 1), count) : 0 },
        },
      };
    });
  },

  clearFilter: (pane) => {
    get().setFilter(pane, "");
  },

  setPaneError: (pane, message) => {
    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: { ...state.panes[pane], error: message },
      },
    }));
  },

  targetCount: (pane) => targetPaths(get().panes[pane]).length,

  openEntry: async (pane, path) => {
    try {
      await commands.openEntry(path);
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as any).message)
          : String(err);
      console.error(`Failed to open ${path}:`, message);
      set((state) => ({
        panes: {
          ...state.panes,
          [pane]: { ...state.panes[pane], error: `Could not open file: ${message}` },
        },
      }));
    }
  },

  computeDirSize: async (pane, path) => {
    const setSize = (value: number | "pending" | "error") =>
      set((state) => ({
        panes: {
          ...state.panes,
          [pane]: {
            ...state.panes[pane],
            dirSizes: { ...state.panes[pane].dirSizes, [path]: value },
          },
        },
      }));

    const clearSize = () =>
      set((state) => {
        const { [path]: _dropped, ...rest } = state.panes[pane].dirSizes;
        return {
          panes: {
            ...state.panes,
            [pane]: { ...state.panes[pane], dirSizes: rest },
          },
        };
      });

    // Already computed or in flight — don't kick off a second expensive walk.
    const existing = get().panes[pane].dirSizes[path];
    if (existing !== undefined) return;

    setSize("pending");
    try {
      setSize(await commands.directorySize(path));
    } catch (err) {
      // A cancelled walk is a user action, not a failure: drop the entry so the
      // row falls back to showing its item count.
      if (err && typeof err === "object" && (err as any).kind === "cancelled") {
        clearSize();
        return;
      }
      console.error(`Failed to compute size of ${path}:`, err);
      setSize("error");
    }
  },

  cancelDirSize: (pane, path) => {
    if (get().panes[pane].dirSizes[path] !== "pending") return;
    commands.cancelDirectorySize(path).catch((err) => {
      console.error(`Failed to cancel size calculation for ${path}:`, err);
    });
  },

  cancelAllDirSizes: (pane) => {
    const { dirSizes } = get().panes[pane];
    for (const [path, value] of Object.entries(dirSizes)) {
      if (value === "pending") {
        commands.cancelDirectorySize(path).catch((err) => {
          console.error(`Failed to cancel size calculation for ${path}:`, err);
        });
      }
    }
  },

  toggleSelection: (pane, path) => {
    set((state) => {
      const paneState = state.panes[pane];
      const newSelected = new Set(paneState.selected);
      if (newSelected.has(path)) {
        newSelected.delete(path);
      } else {
        newSelected.add(path);
      }
      return {
        panes: {
          ...state.panes,
          [pane]: {
            ...paneState,
            selected: newSelected,
            rangeStart: paneState.cursor,
          },
        },
      };
    });
  },

  selectRange: (pane, fromIndex, toIndex) => {
    let start = Math.min(fromIndex, toIndex);
    let end = Math.max(fromIndex, toIndex);

    // Adjust for synthetic ".." parent entry at index 0
    // Parent entry (index 0) cannot be selected
    if (start === 0) start = 1;
    if (end === 0) end = 1;

    set((state) => {
      const paneState = state.panes[pane];
      const newSelected = new Set<string>();

      // Convert display indices to entry indices (subtract 1 for the parent entry)
      const visible = visibleEntries(paneState);
      for (let i = start; i <= end; i++) {
        const entry = visible[i - 1];
        if (entry) {
          newSelected.add(entry.path);
        }
      }

      return {
        panes: {
          ...state.panes,
          [pane]: {
            ...paneState,
            selected: newSelected,
            rangeStart: fromIndex,
          },
        },
      };
    });
  },

  clearSelection: (pane) => {
    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: {
          ...state.panes[pane],
          selected: new Set(),
          rangeStart: null,
        },
      },
    }));
  },

  startCreatingFolder: (pane) => {
    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: {
          ...state.panes[pane],
          renameMode: { type: "creating" },
        },
      },
    }));
  },

  startRenaming: (pane, path) => {
    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: {
          ...state.panes[pane],
          renameMode: { type: "rename", path },
        },
      },
    }));
  },

  commitMkdir: async (pane, name) => {
    const state = get();
    const parentDir = state.panes[pane].path;

    try {
      const created = await commands.mkdir(parentDir, name);
      state.cancelInlineEdit(pane);
      await state.refresh(pane);

      // Put the cursor on the new folder: in a long listing it would otherwise
      // sort somewhere off-screen and be hard to find.
      const after = get().panes[pane];
      const i = visibleEntries(after).findIndex((e) => e.path === created.path);
      if (i >= 0) get().setCursor(pane, i + 1);
    } catch (err) {
      let message = "Failed to create folder";
      if (err && typeof err === "object" && "message" in err) {
        message = String((err as any).message);
      } else if (err instanceof Error) {
        message = err.message;
      }

      console.error("Mkdir failed:", message);

      set((state) => ({
        panes: {
          ...state.panes,
          [pane]: {
            ...state.panes[pane],
            error: message,
          },
        },
      }));
    }
  },

  commitRename: async (pane, path, newName) => {
    const state = get();

    try {
      await commands.renameEntry(path, newName);
      state.cancelInlineEdit(pane);
      await state.refresh(pane);
    } catch (err) {
      const message = typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: string }).message)
        : String(err);
      set((state) => ({
        panes: {
          ...state.panes,
          [pane]: {
            ...state.panes[pane],
            error: message,
          },
        },
      }));
    }
  },

  cancelInlineEdit: (pane) => {
    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: {
          ...state.panes[pane],
          renameMode: null,
        },
      },
    }));
  },

  copySelection: async () => {
    const state = get();
    const active = state.activePane;
    const other: PaneId = active === "left" ? "right" : "left";

    const sources = targetPaths(state.panes[active]);
    const destination = state.panes[other].path;

    if (sources.length === 0 || !destination) {
      state.setPaneError(active, "Nothing to copy");
      return;
    }

    try {
      await commands.copyEntries(sources, destination);
      await state.refresh(active);
      await state.refresh(other);
      state.clearSelection(active);
    } catch (err) {
      const message = typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: string }).message)
        : String(err);
      set((state) => ({
        panes: {
          ...state.panes,
          [other]: {
            ...state.panes[other],
            error: message,
          },
        },
      }));
    }
  },

  moveSelection: async () => {
    const state = get();
    const active = state.activePane;
    const other: PaneId = active === "left" ? "right" : "left";

    const sources = targetPaths(state.panes[active]);
    const destination = state.panes[other].path;

    if (sources.length === 0 || !destination) {
      state.setPaneError(active, "Nothing to move");
      return;
    }

    try {
      await commands.moveEntries(sources, destination);
      await state.refresh(active);
      await state.refresh(other);
      state.clearSelection(active);
    } catch (err) {
      const message = typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: string }).message)
        : String(err);
      set((state) => ({
        panes: {
          ...state.panes,
          [other]: {
            ...state.panes[other],
            error: message,
          },
        },
      }));
    }
  },

  trashSelection: async (pane) => {
    const state = get();
    const paths = targetPaths(state.panes[pane]);

    if (paths.length === 0) {
      state.setPaneError(pane, "Nothing to delete");
      return;
    }

    set({ dialog: null });

    try {
      await commands.trashEntries(paths);
      await state.refresh(pane);
      state.clearSelection(pane);
    } catch (err) {
      const message = typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: string }).message)
        : String(err);
      set((state) => ({
        panes: {
          ...state.panes,
          [pane]: {
            ...state.panes[pane],
            error: message,
          },
        },
      }));
    }
  },

  startEditingPath: (pane) => {
    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: {
          ...state.panes[pane],
          isEditingPath: true,
        },
      },
    }));
  },

  commitPathEdit: async (pane, newPath) => {
    const state = get();
    state.cancelPathEdit(pane);
    await state.navigate(pane, newPath);
  },

  cancelPathEdit: (pane) => {
    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: {
          ...state.panes[pane],
          isEditingPath: false,
        },
      },
    }));
  },
}));
