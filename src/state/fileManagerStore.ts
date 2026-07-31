import { create } from "zustand";
import type { FileEntry } from "../types/fileEntry";
import * as commands from "../tauri/commands";
import type { ConflictPolicy } from "../tauri/commands";
import { toAppError, isCancellation, type AppError, type ErrorContext } from "../errors";

export type PaneId = "left" | "right";

export type SortKey = "name" | "size" | "modified" | "created" | "kind";

export const SORT_KEYS: SortKey[] = ["name", "size", "modified", "created", "kind"];

/** Guards a persisted value: the settings file is user-editable and may predate
 * or postdate this build's set of keys. */
export const asSortKey = (value: string): SortKey =>
  (SORT_KEYS as string[]).includes(value) ? (value as SortKey) : "name";

export interface SortOrder {
  key: SortKey;
  ascending: boolean;
}

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
  error: AppError | null;
  renameMode: RenameMode;
  isEditingPath: boolean;
  /** Type-to-filter text; empty means no filter. Resolve rows via visibleEntries(). */
  filter: string;
  /** Whether dotfiles are listed. Per pane, since the two are often used for
   * different things — browsing a project on one side, a config dir on the other. */
  showHidden: boolean;
  /** Sort applied to this pane's rows. Per pane, for the same reason. */
  sort: SortOrder;
  /**
   * Alias of the SSH host this pane is browsing, or null for the local machine.
   * Remote panes are read-only apart from rsync, so nothing destructive here
   * can reach the far side.
   */
  remote: string | null;
  /** Directories visited in this pane, oldest first. */
  history: string[];
  /** Position within `history`; entries after it are the forward stack. */
  historyIndex: number;
  /** Widths of the two fixed columns. Per pane, because the panes can be very
   * different widths once the split is dragged, and a narrow pane needs
   * narrower columns than a wide one. */
  columnWidths: Record<ResizableColumn, number>;
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
    }
  | {
      /** Choosing a host to add, from the user's ssh config. */
      kind: "addRemote";
      pane: PaneId;
      available: string[];
    }
  | {
      /**
       * What an rsync transfer would change, shown before it runs. rsync can say
       * this exactly, which makes a remote transfer far easier to agree to than
       * a local one.
       */
      kind: "rsyncPreview";
      pane: PaneId;
      sources: commands.RsyncEndpoint[];
      destination: commands.RsyncEndpoint;
      changes: string[];
    }
  | {
      /** Shown after a transfer that did not fully succeed, listing each item. */
      kind: "transferOutcome";
      op: "copy" | "move" | "delete";
      completed: number;
      skipped: string[];
      failed: commands.FailedItem[];
    };

/** A transfer currently running, so it can be shown and cancelled. */
export interface ActiveTransfer {
  id: string;
  op: "copy" | "move";
  pane: PaneId;
  current: number;
  total: number;
  name: string;
}

/**
 * Narrowest a pane may be dragged to, as a fraction of the window. Collapsing is
 * a deliberate action with its own way back, so the divider must not be able to
 * squeeze a pane to nothing by accident.
 */
/** Cap on remembered directories, so a long session cannot grow without bound. */
export const HISTORY_LIMIT = 200;

/** Matches the backend cap; the list is a menu, not something to scroll. */
export const MAX_BOOKMARKS = 30;

export const MIN_SPLIT = 0.15;
export const MAX_SPLIT = 1 - MIN_SPLIT;

export type ResizableColumn = "size" | "modified";

/** Pixels, not a fraction: these size their content, not the window. */
export const DEFAULT_COLUMN_WIDTH = 64;
export const MIN_COLUMN_WIDTH = 40;
export const MAX_COLUMN_WIDTH = 240;

export interface ContextMenuState {
  x: number;
  y: number;
  pane: PaneId;
  /** null when the click landed on empty space rather than a row. */
  path: string | null;
  /**
   * Set when the menu was opened on a places-bar chip rather than inside a pane.
   * Those need their own actions — a bookmark is not a file, and offering to
   * rename or trash one would be nonsense.
   */
  place?: { kind: "bookmark" | "remote"; id: string };
}

export interface FileManagerState {
  panes: Record<PaneId, PaneState>;
  activePane: PaneId;
  /**
   * Width of the left pane as a fraction of the window. A ratio rather than a
   * pixel width, so resizing the window cannot push a pane off-screen.
   */
  splitRatio: number;
  /** Pinned directories, shared by both panes. */
  bookmarks: commands.Bookmark[];
  /** Saved SSH hosts. */
  remotes: commands.Remote[];
  /** Whether the places bar is shown. */
  showPlaces: boolean;
  /**
   * Remote listings kept for the session, keyed by alias and path.
   *
   * Not persisted: a listing from yesterday is indistinguishable from a fresh
   * one, and a decision made from it could be wrong. Within a session the age
   * is shown, so stale is visible rather than assumed.
   */
  remoteCache: Record<string, { entries: FileEntry[]; fetchedAt: number }>;
  /** Which pane is hidden entirely, if either. */
  collapsed: PaneId | null;
  /** Open context menu, if any. Holds a path rather than an entry so it cannot
   * go stale if the listing refreshes underneath it. */
  contextMenu: ContextMenuState | null;
  dialog: DialogState | null;
  transfer: ActiveTransfer | null;

  setActivePane: (pane: PaneId) => void;
  /**
   * `record: false` replays an existing history entry rather than adding one,
   * which is what going back and forward do — recording there would make the
   * back button push a new entry and never actually go anywhere.
   */
  navigate: (pane: PaneId, path: string, opts?: { record?: boolean }) => Promise<void>;
  goBack: (pane: PaneId) => Promise<void>;
  goForward: (pane: PaneId) => Promise<void>;
  canGoBack: (pane: PaneId) => boolean;
  canGoForward: (pane: PaneId) => boolean;
  goToParent: (pane: PaneId) => Promise<void>;
  refresh: (pane: PaneId) => Promise<void>;
  setCursor: (pane: PaneId, index: number) => void;
  toggleSelection: (pane: PaneId, path: string) => void;
  setFilter: (pane: PaneId, filter: string) => void;
  clearFilter: (pane: PaneId) => void;
  toggleHidden: (pane: PaneId) => void;
  setSplitRatio: (ratio: number) => void;
  nudgeSplit: (delta: number) => void;
  resetSplit: () => void;
  /** Hides a pane, or restores it if it is the one already hidden. */
  toggleCollapse: (pane: PaneId) => void;
  setColumnWidth: (pane: PaneId, column: ResizableColumn, px: number) => void;
  resetColumnWidths: (pane: PaneId) => void;
  /** Pins the pane's current directory. Re-adding an existing one is a no-op. */
  addBookmark: (pane: PaneId) => void;
  removeBookmark: (path: string) => void;
  isBookmarked: (path: string) => boolean;
  /** Points a pane at a host, or back at the local machine with null. */
  connectPane: (pane: PaneId, alias: string | null, path?: string) => Promise<void>;
  togglePlaces: () => void;
  /** Offers the ssh config's hosts so an alias never has to be typed. */
  requestAddRemote: (pane: PaneId) => Promise<void>;
  addRemote: (alias: string, startPath?: string) => void;
  removeRemote: (alias: string) => void;
  /** Opens the nth bookmark, then the nth host, as one flat list. */
  openPlace: (index: number, pane: PaneId) => void;
  /** How old this pane's listing is, in ms, or null when it is not cached. */
  listingAge: (pane: PaneId) => number | null;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
  revealEntry: (pane: PaneId, path: string) => Promise<void>;
  /** Applies persisted settings over the defaults at startup. */
  applySettings: (settings: commands.Settings) => void;
  /** Re-selecting the active key reverses it, which is what column headers do. */
  setSort: (pane: PaneId, key: SortKey) => void;
  setPaneError: (pane: PaneId, error: AppError | string | null) => void;
  reportError: (pane: PaneId, err: unknown, context?: ErrorContext) => void;
  /** How many entries an operation would act on (selection, else cursor row). */
  targetCount: (pane: PaneId) => number;
  openEntry: (pane: PaneId, path: string) => Promise<void>;
  computeDirSize: (pane: PaneId, path: string) => Promise<void>;
  cancelDirSize: (pane: PaneId, path: string) => void;
  cancelAllDirSizes: (pane: PaneId) => void;
  selectRange: (pane: PaneId, fromIndex: number, toIndex: number) => void;
  clearSelection: (pane: PaneId) => void;
  selectAll: (pane: PaneId) => void;
  invertSelection: (pane: PaneId) => void;

  startCreatingFolder: (pane: PaneId) => void;
  startRenaming: (pane: PaneId, path: string) => void;
  commitMkdir: (pane: PaneId, name: string) => Promise<void>;
  commitRename: (pane: PaneId, path: string, newName: string) => Promise<void>;
  cancelInlineEdit: (pane: PaneId) => void;
  startEditingPath: (pane: PaneId) => void;
  commitPathEdit: (pane: PaneId, newPath: string) => Promise<void>;
  cancelPathEdit: (pane: PaneId) => void;
  trashSelection: (pane: PaneId) => Promise<void>;

  /** Begins a transfer, asking about name clashes first if there are any. */
  requestTransfer: (op: "copy" | "move") => Promise<void>;
  /** Runs an rsync transfer that the user has seen a preview of. */
  runRsync: (
    pane: PaneId,
    sources: commands.RsyncEndpoint[],
    destination: commands.RsyncEndpoint,
  ) => Promise<void>;
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
  setTransferProgress: (p: commands.TransferProgress) => void;
  cancelTransfer: () => void;
}

/**
 * The directory above `path`, or null at the root. Shared so that anything
 * offering to go up agrees with what going up actually does.
 */
export const parentPath = (path: string): string | null => {
  const parent = path.split("/").slice(0, -1).join("/") || "/";
  return parent === path ? null : parent;
};

/** Monotonic id source; Date.now() would collide on fast successive transfers. */
let transferSeq = 1;

/**
 * The entries actually shown in a pane, after its type-to-filter text.
 *
 * Every cursor index, selection range and operation target must resolve through
 * this, never through `entries` directly: while a filter is active the two
 * differ, and reading the unfiltered array would make an operation act on a row
 * the user cannot see.
 */
/**
 * Compares names the way a person reads them, so "file2" precedes "file10"
 * rather than following it as a plain string comparison would.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The value a key sorts on, or null where the entry has none — directories have
 * no size, and creation time is missing on some filesystems.
 */
function sortValue(key: SortKey, e: FileEntry): number | null {
  switch (key) {
    case "size":
      return e.size;
    case "modified":
      return e.modifiedAt;
    case "created":
      return e.createdAt;
    default:
      return 0;
  }
}

function compareBy(key: SortKey, a: FileEntry, b: FileEntry): number {
  const numeric = (x: number | null, y: number | null) => (x ?? 0) - (y ?? 0);

  switch (key) {
    case "size":
      return numeric(a.size, b.size) || collator.compare(a.name, b.name);
    case "modified":
      return numeric(a.modifiedAt, b.modifiedAt) || collator.compare(a.name, b.name);
    case "created":
      return numeric(a.createdAt, b.createdAt) || collator.compare(a.name, b.name);
    case "kind": {
      const ext = (e: FileEntry) => {
        const i = e.name.lastIndexOf(".");
        return i > 0 ? e.name.slice(i + 1).toLowerCase() : "";
      };
      return collator.compare(ext(a), ext(b)) || collator.compare(a.name, b.name);
    }
    case "name":
    default:
      return collator.compare(a.name, b.name);
  }
}

/**
 * Sorts a listing. Directories are always grouped ahead of files regardless of
 * the key or direction: a dual-pane manager is used for navigating, and burying
 * the folders under a size sort makes that harder rather than easier.
 */
export function sortEntries(entries: FileEntry[], sort: SortOrder): FileEntry[] {
  const dir = (e: FileEntry) => (e.kind === "directory" ? 0 : 1);
  return [...entries].sort((a, b) => {
    const grouped = dir(a) - dir(b);
    if (grouped !== 0) return grouped;

    // Entries with nothing to compare go last in *both* directions. Folding this
    // into the comparison instead would let the descending negation flip them to
    // the top, which reads as though they sorted highest.
    const aMissing = sortValue(sort.key, a) === null;
    const bMissing = sortValue(sort.key, b) === null;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;

    const cmp = compareBy(sort.key, a, b);
    return sort.ascending ? cmp : -cmp;
  });
}

export const visibleEntries = (paneState: PaneState): FileEntry[] => {
  const needle = paneState.filter.trim().toLowerCase();
  const wanted = paneState.showHidden
    ? paneState.entries
    : paneState.entries.filter((e) => !e.hidden);
  const matched = needle
    ? wanted.filter((e) => e.name.toLowerCase().includes(needle))
    : wanted;
  return sortEntries(matched, paneState.sort);
};

/**
 * Where the cursor sits in a directory that has just been listed: the first
 * real entry, or the ".." row when there is nothing else.
 *
 * Starting on ".." meant the first thing every operation acted on was nothing —
 * copy, rename and size all no-op there, so arriving in a folder always cost a
 * keystroke before anything could happen.
 */
export const initialCursor = (paneState: PaneState): number =>
  visibleEntries(paneState).length > 0 ? 1 : 0;

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
  remote: null,
  history: [],
  historyIndex: -1,
  showHidden: false,
  sort: { key: "name", ascending: true },
  columnWidths: { size: DEFAULT_COLUMN_WIDTH, modified: DEFAULT_COLUMN_WIDTH },
  dirSizes: {},
});

export const useFileManagerStore = create<FileManagerState>((set, get) => ({
  panes: {
    left: defaultPaneState(""),
    right: defaultPaneState(""),
  },
  activePane: "left",
  splitRatio: 0.5,
  collapsed: null,
  contextMenu: null,
  bookmarks: [],
  remotes: [],
  showPlaces: true,
  remoteCache: {},

  togglePlaces: () => set((state) => ({ showPlaces: !state.showPlaces })),

  requestAddRemote: async (pane) => {
    try {
      const hosts = await commands.sshConfigHosts();
      const known = new Set(get().remotes.map((r) => r.alias));
      set({
        dialog: { kind: "addRemote", pane, available: hosts.filter((h) => !known.has(h)) },
      });
    } catch (err) {
      get().reportError(pane, err);
    }
  },

  addRemote: (alias, startPath) =>
    set((state) => {
      if (!alias.trim() || state.remotes.some((r) => r.alias === alias)) return {};
      return {
        dialog: null,
        remotes: [
          ...state.remotes,
          // Named after the alias: that is what the user already calls it.
          { name: alias, alias, startPath: startPath?.trim() || "." },
        ],
      };
    }),

  removeRemote: (alias) =>
    set((state) => ({ remotes: state.remotes.filter((r) => r.alias !== alias) })),

  openPlace: (index, pane) => {
    const { bookmarks, remotes } = get();
    if (index < bookmarks.length) {
      const b = bookmarks[index];
      // Same reasoning as the places bar: the bookmark says which machine it is
      // on, and navigate() alone would reuse whatever host the pane is on.
      void get().connectPane(pane, b.remote ?? null, b.path);
      return;
    }
    const remote = remotes[index - bookmarks.length];
    if (remote) void get().connectPane(pane, remote.alias);
  },

  connectPane: async (pane, alias, path) => {
    const target =
      path ??
      (alias
        ? get().remotes.find((r) => r.alias === alias)?.startPath || "/"
        : "/");
    set((state) => ({
      panes: {
        ...state.panes,
        // History belongs to a machine; carrying it across would offer to go
        // "back" to a path that does not exist on the new one.
        [pane]: { ...state.panes[pane], remote: alias, history: [], historyIndex: -1 },
      },
    }));
    await get().navigate(pane, target);
  },

  listingAge: (pane) => {
    const p = get().panes[pane];
    if (!p.remote) return null;
    const hit = get().remoteCache[`${p.remote}:${p.path}`];
    return hit ? Date.now() - hit.fetchedAt : null;
  },

  addBookmark: (pane) =>
    set((state) => {
      const { path, remote } = state.panes[pane];
      // The same path can exist on this machine and on a server and mean two
      // different places, so a bookmark is only a duplicate if the host matches
      // as well.
      if (!path || state.bookmarks.some((b) => b.path === path && (b.remote ?? null) === remote))
        return {};
      const name = path.split("/").filter(Boolean).pop() || path;
      return {
        bookmarks: [...state.bookmarks, { name, path, remote }].slice(0, MAX_BOOKMARKS),
      };
    }),

  removeBookmark: (path) =>
    set((state) => ({ bookmarks: state.bookmarks.filter((b) => b.path !== path) })),

  isBookmarked: (path) => {
    const remote = get().panes[get().activePane].remote;
    return get().bookmarks.some((b) => b.path === path && (b.remote ?? null) === remote);
  },

  setColumnWidth: (pane, column, px) =>
    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: {
          ...state.panes[pane],
          columnWidths: {
            ...state.panes[pane].columnWidths,
            [column]: Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(px))),
          },
        },
      },
    })),

  resetColumnWidths: (pane) =>
    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: {
          ...state.panes[pane],
          columnWidths: { size: DEFAULT_COLUMN_WIDTH, modified: DEFAULT_COLUMN_WIDTH },
        },
      },
    })),

  openContextMenu: (menu) => set({ contextMenu: menu }),
  closeContextMenu: () => set({ contextMenu: null }),

  revealEntry: async (pane, path) => {
    try {
      await commands.revealEntry(path);
    } catch (err) {
      get().reportError(pane, err, "open");
    }
  },

  setActivePane: (pane) => set({ activePane: pane }),

  applySettings: (settings) =>
    set((state) => {
      const forPane = (p: PaneId, s: commands.PaneSettings) => ({
        ...state.panes[p],
        sort: { key: asSortKey(s.sortKey), ascending: s.sortAscending },
        showHidden: s.showHidden,
        columnWidths: { size: s.columns.size, modified: s.columns.modified },
      });
      return {
        // Already clamped and validated by the backend; a hand-edited file
        // cannot put the UI into a state it has no way out of.
        // Already clamped and validated by the backend.
        splitRatio: settings.splitRatio,
        bookmarks: settings.bookmarks ?? [],
        remotes: settings.remotes ?? [],
        showPlaces: settings.showPlaces ?? true,
        panes: {
          left: forPane("left", settings.left),
          right: forPane("right", settings.right),
        },
      };
    }),

  setSplitRatio: (ratio) =>
    set({ splitRatio: Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio)) }),

  nudgeSplit: (delta) => get().setSplitRatio(get().splitRatio + delta),

  resetSplit: () => set({ splitRatio: 0.5, collapsed: null }),

  toggleCollapse: (pane) =>
    set((state) => {
      const collapsed = state.collapsed === pane ? null : pane;
      // Focus cannot stay on a pane that is no longer visible.
      const activePane =
        collapsed === state.activePane
          ? state.activePane === "left"
            ? "right"
            : "left"
          : state.activePane;
      return { collapsed, activePane };
    }),

  canGoBack: (pane) => get().panes[pane].historyIndex > 0,
  canGoForward: (pane) => {
    const p = get().panes[pane];
    return p.historyIndex < p.history.length - 1;
  },

  goBack: async (pane) => {
    const state = get();
    if (!state.canGoBack(pane)) return;
    const p = state.panes[pane];
    const target = p.history[p.historyIndex - 1];
    await state.navigate(pane, target, { record: false });
    set((s2) => ({
      panes: { ...s2.panes, [pane]: { ...s2.panes[pane], historyIndex: p.historyIndex - 1 } },
    }));
  },

  goForward: async (pane) => {
    const state = get();
    if (!state.canGoForward(pane)) return;
    const p = state.panes[pane];
    const target = p.history[p.historyIndex + 1];
    await state.navigate(pane, target, { record: false });
    set((s2) => ({
      panes: { ...s2.panes, [pane]: { ...s2.panes[pane], historyIndex: p.historyIndex + 1 } },
    }));
  },

  navigate: async (pane, path, opts) => {
    // Abandoning the listing abandons its size walks; stop them server-side too
    // rather than letting them run on for minutes against a directory we left.
    get().cancelAllDirSizes(pane);

    set((state) => {
      const previous = state.panes[pane];
      const record = opts?.record !== false && path !== previous.path;
      // Navigating somewhere new discards the forward stack, as it does in a
      // browser: the path not taken is no longer reachable.
      const history = record
        ? [...previous.history.slice(0, previous.historyIndex + 1), path].slice(-HISTORY_LIMIT)
        : previous.history;

      return {
      panes: {
        ...state.panes,
        [pane]: {
          ...state.panes[pane],
          history,
          historyIndex: record ? history.length - 1 : previous.historyIndex,
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
      };
    });

    try {
      const alias = get().panes[pane].remote;
      let entries: FileEntry[];
      if (alias) {
        const key = `${alias}:${path}`;
        const cached = get().remoteCache[key];
        if (cached) {
          entries = cached.entries;
        } else {
          const listing = await commands.listRemoteDirectory(alias, path);
          entries = listing.entries;
          // The server resolves what was asked for — "~" and "." are not paths
          // SFTP understands — so show where we actually landed.
          if (listing.path !== path) {
            set((s2) => ({
              panes: { ...s2.panes, [pane]: { ...s2.panes[pane], path: listing.path } },
              remoteCache: {
                ...s2.remoteCache,
                [`${alias}:${listing.path}`]: { entries, fetchedAt: Date.now() },
              },
            }));
          } else {
            set((s2) => ({
              remoteCache: { ...s2.remoteCache, [key]: { entries, fetchedAt: Date.now() } },
            }));
          }
        }
      } else {
        entries = await commands.listDirectory(path);
      }
      set((state) => {
        const next = { ...state.panes[pane], entries, loading: false };
        return {
          panes: {
            ...state.panes,
            [pane]: { ...next, cursor: initialCursor(next) },
          },
        };
      });
    } catch (err) {
      set((state) => ({
        panes: {
          ...state.panes,
          [pane]: {
            ...state.panes[pane],
            loading: false,
            error: toAppError(err, "list"),
            entries: [],
          },
        },
      }));
    }
  },

  goToParent: async (pane) => {
    const state = get();
    const parent = parentPath(state.panes[pane].path);
    if (parent) {
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
      const alias = before.remote;
      // Refresh is the way to say "I do not trust the cache", so it always
      // refetches and replaces what was stored.
      const entries = alias
        ? (await commands.listRemoteDirectory(alias, path)).entries
        : await commands.listDirectory(path);
      if (alias) {
        set((s2) => ({
          remoteCache: {
            ...s2.remoteCache,
            [`${alias}:${path}`]: { entries, fetchedAt: Date.now() },
          },
        }));
      }

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
      set((state) => ({
        panes: {
          ...state.panes,
          [pane]: { ...state.panes[pane], loading: false, error: toAppError(err, "list") },
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
  transfer: null,

  setTransferProgress: (p) =>
    set((state) =>
      // Ignore events from a transfer that already finished or was replaced.
      state.transfer && state.transfer.id === p.id
        ? { transfer: { ...state.transfer, current: p.current, total: p.total, name: p.name } }
        : {},
    ),

  cancelTransfer: () => {
    const t = get().transfer;
    if (!t) return;
    commands.cancelTransfer(t.id).catch((err) => {
      console.error("Failed to cancel transfer:", err);
    });
  },

  dismissDialog: () => set({ dialog: null }),

  runRsync: async (pane, sources, destination) => {
    const state = get();
    const id = `rsync-${transferSeq++}`;
    set({
      dialog: null,
      transfer: { id, op: "copy", pane, current: 0, total: sources.length, name: "" },
    });
    try {
      const report = await commands.rsyncTransfer(id, sources, destination, false);
      await state.refresh(pane);
      await state.refresh(pane === "left" ? "right" : "left");
      if (report.errors.length > 0) {
        state.setPaneError(pane, {
          kind: "io",
          message: `Transfer finished with problems.`,
          detail: report.errors.join("\n"),
        });
      }
    } catch (err) {
      state.reportError(pane, err, "copy");
    } finally {
      set((s2) => (s2.transfer?.id === id ? { transfer: null } : {}));
    }
  },

  requestTransfer: async (op) => {
    const state = get();
    const active = state.activePane;
    const other: PaneId = active === "left" ? "right" : "left";
    const sources = targetPaths(state.panes[active]);
    const destination = state.panes[other].path;

    // A transfer with a host on either end is rsync's job, not ours.
    const fromRemote = state.panes[active].remote;
    const toRemote = state.panes[other].remote;
    if (fromRemote || toRemote) {
      if (sources.length === 0 || !destination) {
        state.setPaneError(active, `Nothing to ${op}`);
        return;
      }
      if (op === "move") {
        state.setPaneError(active, {
          kind: "invalidName",
          message: "Moving to or from a host is not supported yet.",
          hint: "Copy it across, then delete the original once you are satisfied.",
        });
        return;
      }
      const ends = sources.map((p) => ({ alias: fromRemote, path: p }));
      const dest = { alias: toRemote, path: destination };
      const id = `rsync-dry-${transferSeq++}`;
      try {
        // Ask rsync what it would do, and show that before writing anything.
        const preview = await commands.rsyncTransfer(id, ends, dest, true);
        set({
          dialog: {
            kind: "rsyncPreview",
            pane: active,
            sources: ends,
            destination: dest,
            changes: preview.changes,
          },
        });
      } catch (err) {
        state.reportError(active, err, "copy");
      }
      return;
    }

    if (sources.length === 0 || !destination) {
      state.setPaneError(active, `Nothing to ${op}`);
      return;
    }

    // Caught here as well as in the backend so the user is told plainly, rather
    // than being shown a conflict dialog whose Replace option is destructive.
    // Both panes open on the same directory, so this is easy to hit by accident.
    if (state.panes[active].path === destination) {
      state.setPaneError(active, {
        kind: "invalidName",
        message: `Both panes are showing the same folder.`,
        hint: `Navigate the other pane somewhere else to ${op} into it.`,
      });
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
      state.reportError(active, err, op);
    }
  },

  performTransfer: async (op, pane, sources, destination, policy) => {
    const state = get();
    // The id lets progress events and a cancel request find this transfer.
    const id = `${op}-${transferSeq++}`;
    set({
      dialog: null,
      transfer: { id, op, pane, current: 0, total: sources.length, name: "" },
    });

    try {
      const report =
        op === "copy"
          ? await commands.copyEntriesWith(id, sources, destination, policy)
          : await commands.moveEntriesWith(id, sources, destination, policy);

      const other: PaneId = pane === "left" ? "right" : "left";
      await state.refresh(pane);
      await state.refresh(other);
      state.clearSelection(pane);

      // Anything less than a clean success gets itemised. Collapsing seven
      // failures into "7 failed (first message, …)" hides both which files were
      // affected and why each one was, which is the information needed to act.
      state.setPaneError(pane, null);
      if (report.failed.length > 0 || report.skipped.length > 0) {
        set({
          dialog: {
            kind: "transferOutcome",
            op,
            completed: report.completed.length,
            skipped: report.skipped,
            failed: report.failed,
          },
        });
      }
    } catch (err) {
      state.reportError(pane, err, op);
    } finally {
      // Clear only if this is still the transfer on screen.
      set((s2) => (s2.transfer?.id === id ? { transfer: null } : {}));
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

  setSort: (pane, key) => {
    set((state) => {
      const paneState = state.panes[pane];
      const sort: SortOrder =
        paneState.sort.key === key
          ? { key, ascending: !paneState.sort.ascending }
          : { key, ascending: true };

      // Rows move, so follow the entry the cursor was on rather than its index.
      const anchor = entryAtCursor(paneState)?.path ?? null;
      const next = { ...paneState, sort };
      let cursor = paneState.cursor;
      if (anchor) {
        const i = visibleEntries(next).findIndex((e) => e.path === anchor);
        if (i >= 0) cursor = i + 1;
      }
      return { panes: { ...state.panes, [pane]: { ...next, cursor } } };
    });
  },

  toggleHidden: (pane) => {
    set((state) => {
      const paneState = state.panes[pane];
      const next = { ...paneState, showHidden: !paneState.showHidden };
      // The visible row count changes, so the cursor has to be re-clamped or it
      // can point past the end of the list.
      const count = visibleEntries(next).length;
      return {
        panes: {
          ...state.panes,
          [pane]: { ...next, cursor: Math.min(paneState.cursor, count) },
        },
      };
    });
  },

  setPaneError: (pane, error) => {
    const normalised: AppError | null =
      error === null
        ? null
        : typeof error === "string"
          ? { kind: "unknown", message: error }
          : error;
    // An error bar can be dismissed, scrolled past, or replaced by the next one.
    // The log keeps it, which matters most for the failures that leave a pane
    // showing nothing at all.
    if (normalised) {
      void commands.logMessage(
        "error",
        `pane ${pane}: ${normalised.kind}: ${normalised.message}`,
      );
    }
    set((state) => ({
      panes: {
        ...state.panes,
        [pane]: { ...state.panes[pane], error: normalised },
      },
    }));
  },

  /** Records a failure against a pane, mapped for display. Cancellations are dropped. */
  reportError: (pane, err, context) => {
    if (isCancellation(err)) return;
    get().setPaneError(pane, toAppError(err, context));
  },

  targetCount: (pane) => targetPaths(get().panes[pane]).length,

  openEntry: async (pane, path) => {
    try {
      await commands.openEntry(path);
    } catch (err) {
      get().reportError(pane, err, "open");
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

  // Both act on what is on screen, not on every entry: with a filter active,
  // selecting rows you cannot see and then copying them would be a nasty
  // surprise. Neither triggers a directory size walk — that stays on Space,
  // where it is one folder at a time and deliberate.
  selectAll: (pane) => {
    set((state) => {
      const p = state.panes[pane];
      return {
        panes: {
          ...state.panes,
          [pane]: {
            ...p,
            selected: new Set(visibleEntries(p).map((e) => e.path)),
            rangeStart: null,
          },
        },
      };
    });
  },

  invertSelection: (pane) => {
    set((state) => {
      const p = state.panes[pane];
      const next = new Set<string>();
      for (const e of visibleEntries(p)) {
        if (!p.selected.has(e.path)) next.add(e.path);
      }
      return {
        panes: {
          ...state.panes,
          [pane]: { ...p, selected: next, rangeStart: null },
        },
      };
    });
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
      get().reportError(pane, err, "create folder");
    }
  },

  commitRename: async (pane, path, newName) => {
    const state = get();

    try {
      await commands.renameEntry(path, newName);
      state.cancelInlineEdit(pane);
      await state.refresh(pane);
    } catch (err) {
      get().reportError(pane, err, "rename");
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





  trashSelection: async (pane) => {
    const state = get();
    const paths = targetPaths(state.panes[pane]);

    if (paths.length === 0) {
      state.setPaneError(pane, "Nothing to delete");
      return;
    }

    set({ dialog: null });

    try {
      const report = await commands.trashEntries(paths);
      await state.refresh(pane);
      state.clearSelection(pane);

      // Same treatment as a transfer: name what could not be taken, rather than
      // reporting one generic failure for the whole batch.
      if (report.failed.length > 0) {
        set({
          dialog: {
            kind: "transferOutcome",
            op: "delete",
            completed: report.completed.length,
            skipped: report.skipped,
            failed: report.failed,
          },
        });
      }
    } catch (err) {
      get().reportError(pane, err, "delete");
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
