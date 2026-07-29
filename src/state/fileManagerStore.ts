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
});

export const useFileManagerStore = create<FileManagerState>((set, get) => ({
  panes: {
    left: defaultPaneState(""),
    right: defaultPaneState(""),
  },
  activePane: "left",

  setActivePane: (pane) => set({ activePane: pane }),

  navigate: async (pane, path) => {
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
      const message = typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: string }).message)
        : String(err);
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
      const clamped = Math.max(0, Math.min(index, paneState.entries.length - 1));
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
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);

    set((state) => {
      const paneState = state.panes[pane];
      const newSelected = new Set<string>();

      for (let i = start; i <= end; i++) {
        const entry = paneState.entries[i];
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
