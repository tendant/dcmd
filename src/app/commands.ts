import { DEL, MOD, SHIFT } from "../platform";
import { entryAtCursor, parentPath, type FileManagerState } from "../state/fileManagerStore";

/**
 * How each command is described, as against `MENU_ACTIONS`, which is what each
 * one does.
 *
 * Two tables rather than one because they answer to different things: the
 * actions are the contract with the native menu, checked against
 * `menu_ids.txt`, and this is presentation. A test asserts the id sets match,
 * so a command cannot reach the menu without a name here, or linger here after
 * being removed from the menu.
 *
 * `shortcut` is display only. The accelerator itself belongs to the native
 * menu — see the comment at the top of `useGlobalKeyboard`.
 */
export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  group: CommandGroup;
  /**
   * Whether the command would do anything right now. Absent means always.
   *
   * Unavailable commands are shown disabled rather than hidden: someone
   * searching for "duplicate" and finding nothing concludes the app cannot do
   * it, which is worse than finding it greyed out with the reason evident from
   * the pane behind.
   */
  available?: (s: FileManagerState) => boolean;
}

export type CommandGroup = "File" | "Go" | "Selection" | "View";

/** True when the cursor is on a real row rather than the synthetic "..". */
const hasEntry = (s: FileManagerState): boolean => entryAtCursor(s.panes[s.activePane]) !== null;

const isLocal = (s: FileManagerState): boolean => !s.panes[s.activePane].remote;

export const COMMANDS: Command[] = [
  // File
  { id: "open", label: "Open", shortcut: "Enter", group: "File", available: hasEntry },
  {
    id: "preview",
    label: "Preview",
    shortcut: "F3",
    group: "File",
    // Reading a remote file would mean fetching it first, which preview does
    // not do; the pane says so rather than opening an empty window.
    available: (s) => hasEntry(s) && isLocal(s),
  },
  { id: "new_folder", label: "New folder", shortcut: `F7 / ${MOD}${SHIFT}N`, group: "File" },
  {
    id: "rename",
    label: "Rename",
    shortcut: `F2 / ${MOD}${SHIFT}R`,
    group: "File",
    available: hasEntry,
  },
  {
    id: "duplicate",
    label: "Duplicate here",
    shortcut: `${MOD}${SHIFT}D`,
    group: "File",
    available: (s) => hasEntry(s) && isLocal(s),
  },
  {
    id: "copy",
    label: "Copy to other pane",
    shortcut: `F5 / ${MOD}${SHIFT}C`,
    group: "File",
    available: (s) => s.targetCount(s.activePane) > 0,
  },
  {
    id: "move",
    label: "Move to other pane",
    shortcut: `F6 / ${MOD}${SHIFT}M`,
    group: "File",
    available: (s) => s.targetCount(s.activePane) > 0,
  },
  {
    id: "trash",
    label: "Move to Trash",
    shortcut: `F8 / ${MOD}${DEL}`,
    group: "File",
    available: (s) => s.targetCount(s.activePane) > 0 && isLocal(s),
  },
  {
    id: "reveal",
    label: "Reveal in file browser",
    group: "File",
    available: (s) => hasEntry(s) && isLocal(s),
  },
  { id: "copy_path", label: "Copy path", group: "File", available: hasEntry },
  {
    id: "open_terminal",
    label: "Open terminal here",
    shortcut: `${MOD}${SHIFT}T`,
    group: "File",
    // Acts on the directory, not the row, so an empty pane is still fine.
    available: isLocal,
  },

  // Go
  {
    id: "back",
    label: "Back",
    shortcut: `${MOD}[`,
    group: "Go",
    available: (s) => s.canGoBack(s.activePane),
  },
  {
    id: "forward",
    label: "Forward",
    shortcut: `${MOD}]`,
    group: "Go",
    available: (s) => s.canGoForward(s.activePane),
  },
  {
    id: "up",
    label: "Enclosing folder",
    shortcut: `${DEL} / ${MOD}↑`,
    group: "Go",
    available: (s) => parentPath(s.panes[s.activePane].path) !== null,
  },
  { id: "edit_path", label: "Go to path…", shortcut: `${MOD}L`, group: "Go" },
  { id: "refresh", label: "Refresh", shortcut: `${MOD}R`, group: "Go" },
  { id: "bookmark", label: "Bookmark this folder", shortcut: `${MOD}D`, group: "Go" },
  { id: "add_host", label: "Add host…", group: "Go" },
  { id: "switch_pane", label: "Other pane", shortcut: "Tab", group: "Go" },
  { id: "open_log", label: "Open log", group: "Go" },

  // Selection
  { id: "select_all", label: "Select all", shortcut: `${MOD}A`, group: "Selection" },
  {
    id: "deselect_all",
    label: "Deselect all",
    shortcut: `${MOD}${SHIFT}A`,
    group: "Selection",
    available: (s) => s.panes[s.activePane].selected.size > 0,
  },
  { id: "invert_selection", label: "Invert selection", shortcut: `${MOD}I`, group: "Selection" },
  {
    id: "calc_size",
    label: "Calculate folder size",
    shortcut: "Space",
    group: "Selection",
    available: (s) => entryAtCursor(s.panes[s.activePane])?.kind === "directory",
  },
  {
    id: "clear_filter",
    label: "Clear filter",
    shortcut: "Esc",
    group: "Selection",
    available: (s) => s.panes[s.activePane].filter !== "",
  },
  {
    id: "cancel",
    label: "Cancel operation",
    shortcut: "Esc",
    group: "Selection",
    available: (s) => s.transfer !== null,
  },

  // View
  { id: "command_palette", label: "Command palette", shortcut: `${MOD}${SHIFT}P`, group: "View" },
  { id: "toggle_hidden", label: "Show hidden files", shortcut: `${MOD}${SHIFT}.`, group: "View" },
  { id: "toggle_places", label: "Places bar", shortcut: `${MOD}B`, group: "View" },
  { id: "split_even", label: "Even split", shortcut: `${MOD}0`, group: "View" },
  { id: "split_wider", label: "Wider left pane", shortcut: `${MOD}${SHIFT}→`, group: "View" },
  { id: "split_narrower", label: "Narrower left pane", shortcut: `${MOD}${SHIFT}←`, group: "View" },
  { id: "toggle_collapse", label: "Collapse other pane", shortcut: `${MOD}\\`, group: "View" },
  { id: "sort_name", label: "Sort by name", shortcut: `${MOD}1`, group: "View" },
  { id: "sort_size", label: "Sort by size", shortcut: `${MOD}2`, group: "View" },
  { id: "sort_modified", label: "Sort by date modified", shortcut: `${MOD}3`, group: "View" },
  { id: "sort_created", label: "Sort by date created", shortcut: `${MOD}4`, group: "View" },
  { id: "sort_kind", label: "Sort by kind", shortcut: `${MOD}5`, group: "View" },
];

/**
 * A command matched against a query, with the score that ordered it.
 */
export interface Match {
  command: Command;
  /** Positions in the label that matched, for highlighting. */
  positions: number[];
  score: number;
}

/**
 * Subsequence match: "nf" finds "New folder", which a substring search would
 * miss. Scored so that the obvious answer comes first — a prefix beats a match
 * on a later word, which beats letters merely scattered in order.
 *
 * Returns null when the query's letters do not appear in order at all.
 */
export function scoreLabel(label: string, query: string): Omit<Match, "command"> | null {
  if (query === "") return { positions: [], score: 0 };

  const haystack = label.toLowerCase();
  const needle = query.toLowerCase();
  const positions: number[] = [];

  let at = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, at);
    if (found === -1) return null;
    positions.push(found);
    at = found + 1;
  }

  let score = 0;
  for (const [i, pos] of positions.entries()) {
    // Contiguous runs are what someone typing an abbreviation means, so they
    // count for much more than the same letters spread out.
    if (i > 0 && pos === positions[i - 1] + 1) score += 8;
    if (pos === 0) score += 16;
    else if (haystack[pos - 1] === " ") score += 6;
  }
  // Shorter labels win ties: "Refresh" should beat "Reveal in file browser"
  // for "ref", having less that did not match.
  score -= label.length * 0.1;

  return { positions, score };
}

/**
 * The commands matching `query`, best first.
 *
 * Pure, so ranking is testable without rendering anything. Availability is
 * carried through rather than filtered on — see `Command.available`.
 */
export function matchCommands(query: string, commands: Command[] = COMMANDS): Match[] {
  const matches: Match[] = [];
  for (const command of commands) {
    const scored = scoreLabel(command.label, query);
    if (scored) matches.push({ command, ...scored });
  }

  if (query === "") return matches;
  // Stable within a score, so the registry's order — grouped by menu — decides
  // ties rather than whatever sort the engine happens to use.
  return matches
    .map((m, i) => ({ m, i }))
    .sort((a, b) => b.m.score - a.m.score || a.i - b.i)
    .map(({ m }) => m);
}

/** Every id the palette knows how to describe. Exported so a mismatch fails a test. */
export const COMMAND_IDS = COMMANDS.map((c) => c.id);
