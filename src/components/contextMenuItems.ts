import { DEL, MOD, SHIFT } from "../platform";
import {
  entryAtCursor,
  parentPath,
  visibleEntries,
  type ContextMenuState,
  type FileManagerState,
  type SortKey,
} from "../state/fileManagerStore";
import type { FileEntry } from "../types/fileEntry";

export type MenuItem =
  | {
      kind: "action";
      label: string;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      run: () => void;
    }
  | { kind: "check"; label: string; shortcut?: string; checked: boolean; run: () => void }
  | { kind: "submenu"; label: string; items: MenuItem[] }
  | { kind: "separator" };

const SORT_LABELS: [SortKey, string][] = [
  ["name", "Name"],
  ["size", "Size"],
  ["modified", "Date modified"],
  ["created", "Date created"],
  ["kind", "Kind"],
];

/** Best-effort; the clipboard is not worth an error dialog if it is unavailable. */
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    console.error("Could not write to the clipboard");
  }
}

/**
 * The menu for a right-click, built from the store so it cannot describe actions
 * the app does not have.
 *
 * Every item carries its keyboard shortcut. The menu is as much a way of
 * learning the keyboard interface as it is a way of avoiding it — this app hides
 * most of what it can do behind keys, and a menu that showed no shortcuts would
 * teach people to keep reaching for the mouse.
 */
export function buildMenuItems(state: FileManagerState, menu: ContextMenuState): MenuItem[] {
  const { pane } = menu;
  if (menu.place) return placeMenuItems(state, menu, menu.place);
  const paneState = state.panes[pane];
  const target: FileEntry | null =
    (menu.path && visibleEntries(paneState).find((e) => e.path === menu.path)) || null;
  const other = pane === "left" ? "right" : "left";
  const selectionCount = paneState.selected.size;

  const parent = parentPath(paneState.path);

  const common: MenuItem[] = [
    { kind: "separator" },
    {
      kind: "action",
      label: "Back",
      shortcut: `${MOD}[`,
      disabled: !state.canGoBack(pane),
      run: () => state.goBack(pane),
    },
    {
      kind: "action",
      label: "Forward",
      shortcut: `${MOD}]`,
      disabled: !state.canGoForward(pane),
      run: () => state.goForward(pane),
    },
    {
      kind: "action",
      label: "Go up",
      shortcut: DEL,
      // Nothing above the root, and offering it there would be a no-op.
      disabled: parent === null,
      run: () => state.goToParent(pane),
    },
    {
      kind: "action",
      label: "New folder",
      shortcut: `F7 / ${MOD}${SHIFT}N`,
      run: () => state.startCreatingFolder(pane),
    },
    { kind: "action", label: "Refresh", shortcut: `${MOD}R`, run: () => state.refresh(pane) },
    { kind: "separator" },
    ...(true
      ? [
          {
            kind: "submenu" as const,
            label: "Connect to",
            items: [
              {
                kind: "action" as const,
                label: "Add host…",
                run: () => void state.requestAddRemote(pane),
              },
              ...(paneState.remote
                ? [
                    {
                      kind: "action" as const,
                      label: `Forget “${paneState.remote}”`,
                      run: () => state.removeRemote(paneState.remote!),
                    },
                  ]
                : []),
              { kind: "separator" as const },
              {
                kind: "action" as const,
                label: "This machine",
                disabled: !paneState.remote,
                run: () => void state.connectPane(pane, null, "/"),
              },
              ...(state.remotes.length > 0 ? [{ kind: "separator" as const }] : []),
              ...state.remotes.map((r) => ({
                kind: "action" as const,
                label: r.name || r.alias,
                disabled: paneState.remote === r.alias,
                run: () => void state.connectPane(pane, r.alias),
              })),
            ],
          },
        ]
      : []),
    {
      kind: "submenu",
      label: "Bookmarks",
      items: [
        {
          kind: "action" as const,
          label: state.isBookmarked(paneState.path)
            ? "Remove this folder"
            : "Bookmark this folder",
          shortcut: `${MOD}D`,
          run: () =>
            state.isBookmarked(paneState.path)
              ? state.removeBookmark(paneState.path)
              : state.addBookmark(pane),
        },
        ...(state.bookmarks.length > 0 ? [{ kind: "separator" as const }] : []),
        ...state.bookmarks.map((b) => ({
          kind: "action" as const,
          label: b.name,
          run: () => state.navigate(pane, b.path),
        })),
      ],
    },
    {
      kind: "submenu",
      label: "Sort by",
      items: SORT_LABELS.map(([key, label], i) => ({
        kind: "check" as const,
        label,
        shortcut: `${MOD}${i + 1}`,
        checked: paneState.sort.key === key,
        run: () => state.setSort(pane, key),
      })),
    },
    {
      kind: "check",
      label: "Show hidden files",
      shortcut: `${MOD}${SHIFT}.`,
      checked: paneState.showHidden,
      run: () => state.toggleHidden(pane),
    },
  ];

  if (!target) return common.slice(1);

  // Acting on a multi-item selection is common enough to be worth naming, so the
  // menu cannot imply it will act on one file when it will act on twelve.
  const acting = selectionCount > 1 ? `${selectionCount} items` : `“${target.name}”`;
  const sizeKnown = paneState.dirSizes[target.path];

  return [
    {
      kind: "action",
      label: target.kind === "directory" ? "Open folder" : "Open",
      shortcut: "⏎",
      run: () =>
        target.kind === "directory"
          ? state.navigate(pane, target.path)
          : state.openEntry(pane, target.path),
    },
    {
      kind: "action",
      label: "Show in other pane",
      run: () =>
        state.navigate(other, target.kind === "directory" ? target.path : paneState.path),
    },
    { kind: "separator" },
    {
      kind: "action",
      label: `Copy ${acting} to other pane`,
      shortcut: `F5 / ${MOD}${SHIFT}C`,
      run: () => state.requestTransfer("copy"),
    },
    {
      kind: "action",
      label: `Move ${acting} to other pane`,
      shortcut: `F6 / ${MOD}${SHIFT}M`,
      run: () => state.requestTransfer("move"),
    },
    {
      kind: "action",
      label: "Rename…",
      shortcut: `F2 / ${MOD}${SHIFT}R`,
      // Renaming is one-at-a-time; offering it for a multi-selection would
      // silently act on only one of them.
      disabled: selectionCount > 1,
      run: () => state.startRenaming(pane, target.path),
    },
    {
      kind: "action",
      label: `Move ${acting} to Trash`,
      shortcut: `F8 / ${MOD}${DEL}`,
      danger: true,
      run: () => state.requestTrash(pane),
    },
    { kind: "separator" },
    ...(target.kind === "directory"
      ? [
          {
            kind: "action" as const,
            label:
              sizeKnown === "pending" ? "Calculating size…" : "Calculate size",
            shortcut: "Space",
            disabled: sizeKnown === "pending",
            run: () => state.computeDirSize(pane, target.path),
          },
        ]
      : []),
    {
      kind: "action",
      label: "Copy path",
      run: () => void copyToClipboard(target.path),
    },
    {
      kind: "action",
      label: "Reveal in file browser",
      run: () => void state.revealEntry(pane, target.path),
    },
    ...common,
  ];
}

/**
 * Menu for a chip in the places bar.
 *
 * Both kinds offer the same first choice — open here, or in the other pane —
 * because lining up two locations is what the second pane is for, and the bar is
 * the fastest way to do it.
 */
function placeMenuItems(
  state: FileManagerState,
  menu: ContextMenuState,
  place: { kind: "bookmark" | "remote"; id: string },
): MenuItem[] {
  const here = menu.pane;
  const other: "left" | "right" = here === "left" ? "right" : "left";

  if (place.kind === "bookmark") {
    const bookmark = state.bookmarks.find((b) => b.path === place.id);
    if (!bookmark) return [];
    return [
      {
        kind: "action",
        label: "Open here",
        run: () => void state.navigate(here, bookmark.path),
      },
      {
        kind: "action",
        label: "Open in other pane",
        shortcut: "Alt-click",
        run: () => void state.navigate(other, bookmark.path),
      },
      { kind: "separator" },
      {
        kind: "action",
        label: "Remove bookmark",
        danger: true,
        run: () => state.removeBookmark(bookmark.path),
      },
    ];
  }

  const remote = state.remotes.find((r) => r.alias === place.id);
  if (!remote) return [];
  const connectedHere = state.panes[here].remote === remote.alias;
  return [
    {
      kind: "action",
      label: "Connect here",
      disabled: connectedHere,
      run: () => void state.connectPane(here, remote.alias),
    },
    {
      kind: "action",
      label: "Connect in other pane",
      shortcut: "Alt-click",
      disabled: state.panes[other].remote === remote.alias,
      run: () => void state.connectPane(other, remote.alias),
    },
    ...(connectedHere
      ? [
          {
            kind: "action" as const,
            label: "Back to this machine",
            run: () => void state.connectPane(here, null, "/"),
          },
        ]
      : []),
    { kind: "separator" },
    {
      kind: "action",
      // Only the saved entry goes; nothing on the host is touched.
      label: `Forget “${remote.name || remote.alias}”`,
      danger: true,
      run: () => state.removeRemote(remote.alias),
    },
  ];
}

/** Exported for tests: what the menu would act on given the current cursor. */
export function menuTargetPath(state: FileManagerState, pane: "left" | "right"): string | null {
  return entryAtCursor(state.panes[pane])?.path ?? null;
}
