import { create } from "zustand";
import type { FileEntry } from "../types/fileEntry";
import * as commands from "../tauri/commands";

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
  /**
   * Directory sizes computed on demand (Space), keyed by path. Directory sizes
   * are never computed during listing — see `directory_size` in the backend.
   * A value of "pending" means a computation is in flight.
   */
  dirSizes: Record<string, number | "pending" | "error">;
}

export interface FileManagerState {
  panes: Record<PaneId, PaneState>;
  activePane: PaneId;

  setActivePane: (pane: PaneId) => void;
  navigate: (pane: PaneId, path: string) => Promise<void>;
  goToParent: (pane: PaneId) => Promise<void>;
  refresh: (pane: PaneId) => Promise<void>;
  setCursor: (pane: PaneId, index: number) => void;
  toggleSelection: (pane: PaneId, path: string) => void;
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
}

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
    const state = get();
    const path = state.panes[pane].path;
    await state.navigate(pane, path);
  },

  setCursor: (pane, index) => {
    set((state) => {
      const paneState = state.panes[pane];
      // Max cursor is entries.length because of synthetic ".." at index 0
      // So indices go from 0 (parent) to entries.length (last real entry)
      const clamped = Math.max(0, Math.min(index, paneState.entries.length));
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
      for (let i = start; i <= end; i++) {
        const entry = paneState.entries[i - 1];
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
      await commands.mkdir(parentDir, name);
      state.cancelInlineEdit(pane);
      await state.refresh(pane);
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

    const sources = Array.from(state.panes[active].selected);
    const destination = state.panes[other].path;

    if (sources.length === 0 || !destination) return;

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

    const sources = Array.from(state.panes[active].selected);
    const destination = state.panes[other].path;

    if (sources.length === 0 || !destination) return;

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
    const paths = Array.from(state.panes[pane].selected);

    if (paths.length === 0) return;

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
