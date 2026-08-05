import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { FileEntry } from "../types/fileEntry";

// Tauri v2 injects __TAURI_INTERNALS__ into the webview it creates. If this is
// undefined, the page is being viewed outside the Tauri window (e.g. a browser
// tab open on the dev server) and no command can ever succeed there.
export function isTauriWebview(): boolean {
  return typeof (window as any).__TAURI_INTERNALS__ !== "undefined";
}

const invoke = async <T,>(command: string, args?: any): Promise<T> => {
  if (!isTauriWebview()) {
    throw new Error(
      `Not running inside the Tauri webview — '${command}' is unavailable. ` +
        `Open the window launched by \`pnpm tauri dev\`, not localhost:1420 in a browser.`,
    );
  }
  return tauriInvoke<T>(command, args);
};

export interface FailedItem {
  path: string;
  /** FsError wire name, so each failure can be phrased for the user. */
  kind: string;
  message: string;
}

export interface TransferReport {
  completed: string[];
  skipped: string[];
  failed: FailedItem[];
}

export interface PaneSettings {
  sortKey: string;
  sortAscending: boolean;
  showHidden: boolean;
  columns: ColumnWidths;
}

export interface ColumnWidths {
  size: number;
  modified: number;
}

export interface Bookmark {
  name: string;
  path: string;
  /** The host this path is on; absent or null means this machine. */
  remote?: string | null;
}

export interface Remote {
  name: string;
  alias: string;
  startPath: string;
}

export interface Settings {
  version: number;
  splitRatio: number;
  showPlaces: boolean;
  left: PaneSettings;
  right: PaneSettings;
  bookmarks: Bookmark[];
  remotes: Remote[];
}

export interface StartupInfo {
  startDir: string;
  settings: Settings;
}

/** Start directory and persisted settings in one round trip. */
export const startupInfo = (): Promise<StartupInfo> => invoke<StartupInfo>("startup_info");

export const saveSettings = (settings: Settings): Promise<void> =>
  invoke<void>("save_settings", { settings });

export const markStartup = (label: string): Promise<void> =>
  invoke<void>("mark_startup", { label });

/** Lists a directory on a saved SSH host. Read-only; nothing here can modify it. */
/** Host aliases from ~/.ssh/config, offered when adding a host. */
export const sshConfigHosts = (): Promise<string[]> => invoke<string[]>("ssh_config_hosts");

export interface RemoteListing {
  /** The path the request actually resolved to: "~" is not a thing over SFTP. */
  path: string;
  entries: FileEntry[];
}

/** Lists a directory on a saved SSH host. Read-only; nothing here can modify it. */
export const listRemoteDirectory = (alias: string, path: string): Promise<RemoteListing> =>
  invoke<RemoteListing>("list_remote_directory", { alias, path });

export const listDirectory = (path: string): Promise<FileEntry[]> =>
  invoke<FileEntry[]>("list_directory", { path });

export const defaultStartDir = (): Promise<string> =>
  invoke<string>("default_start_dir");

export const openEntry = (path: string): Promise<void> =>
  invoke<void>("open_entry", { path });

export const revealEntry = (path: string): Promise<void> =>
  invoke<void>("reveal_entry", { path });

/** Opens the system terminal at `path`, which must be a directory. */
export const openTerminal = (path: string): Promise<void> =>
  invoke<void>("open_terminal", { path });

/**
 * Abandons a connection still being established. A no-op if that host is not
 * currently connecting, so it is safe to call on any Escape.
 */
export const cancelRemoteConnect = (alias: string): Promise<void> =>
  invoke<void>("cancel_remote_connect", { alias });

export const directorySize = (path: string): Promise<number> =>
  invoke<number>("directory_size", { path });

export const cancelDirectorySize = (path: string): Promise<void> =>
  invoke<void>("cancel_directory_size", { path });

export const mkdir = (parentDir: string, name: string): Promise<FileEntry> =>
  invoke<FileEntry>("mkdir", { parentDir, name });

export const renameEntry = (path: string, newName: string): Promise<FileEntry> =>
  invoke<FileEntry>("rename", { path, newName });

export const trashEntries = (paths: string[]): Promise<TransferReport> =>
  invoke<TransferReport>("trash_entries", { paths });

export type ConflictPolicy = "fail" | "skip" | "overwrite" | "keepBoth";

/** Names already present at the destination, so the user can be asked first. */
export const checkConflicts = (sources: string[], destinationDir: string): Promise<string[]> =>
  invoke<string[]>("check_conflicts", { sources, destinationDir });

export interface TransferProgress {
  id: string;
  current: number;
  total: number;
  name: string;
}

export const copyEntriesWith = (
  id: string,
  sources: string[],
  destinationDir: string,
  policy: ConflictPolicy,
): Promise<TransferReport> =>
  invoke<TransferReport>("copy_entries_with", { id, sources, destinationDir, policy });

export const moveEntriesWith = (
  id: string,
  sources: string[],
  destinationDir: string,
  policy: ConflictPolicy,
): Promise<TransferReport> =>
  invoke<TransferReport>("move_entries_with", { id, sources, destinationDir, policy });

export interface RsyncEndpoint {
  alias: string | null;
  path: string;
}

export interface RsyncReport {
  changes: string[];
  cancelled: boolean;
  errors: string[];
}

/** Transfers between this machine and a host. `dryRun` reports without writing. */
export const rsyncTransfer = (
  id: string,
  sources: RsyncEndpoint[],
  destination: RsyncEndpoint,
  dryRun: boolean,
): Promise<RsyncReport> =>
  invoke<RsyncReport>("rsync_transfer", { id, sources, destination, dryRun });

export const cancelTransfer = (id: string): Promise<void> =>
  invoke<void>("cancel_transfer", { id });

/** Opens the app's log file in the system's default viewer. */
export async function openLog(): Promise<void> {
  return invoke("open_log");
}

/**
 * Appends a line to the app's log file.
 *
 * The webview console is not readable in a release build and the dev terminal
 * carries only vite's own output, so this is the only place a frontend message
 * survives long enough to be read.
 */
export async function logMessage(level: string, message: string): Promise<void> {
  return invoke("log_message", { level, message });
}

/**
 * What a file looks like for read-only display.
 *
 * A discriminated union rather than a blob with optional fields, so the UI has
 * to handle each case and cannot render an image as if it were text.
 */
export type Preview =
  | { kind: "text"; content: string; truncated: boolean }
  | { kind: "markdown"; content: string; truncated: boolean }
  | { kind: "image"; mime: string; data: string }
  | { kind: "pdf"; data: string }
  | { kind: "unsupported"; reason: string };

export async function previewFile(path: string): Promise<Preview> {
  return invoke("preview_file", { path });
}
