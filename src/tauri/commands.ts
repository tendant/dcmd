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

export const listDirectory = (path: string): Promise<FileEntry[]> =>
  invoke<FileEntry[]>("list_directory", { path });

export const defaultStartDir = (): Promise<string> =>
  invoke<string>("default_start_dir");

export const openEntry = (path: string): Promise<void> =>
  invoke<void>("open_entry", { path });

export const directorySize = (path: string): Promise<number> =>
  invoke<number>("directory_size", { path });

export const cancelDirectorySize = (path: string): Promise<void> =>
  invoke<void>("cancel_directory_size", { path });

export const mkdir = (parentDir: string, name: string): Promise<FileEntry> =>
  invoke<FileEntry>("mkdir", { parentDir, name });

export const renameEntry = (path: string, newName: string): Promise<FileEntry> =>
  invoke<FileEntry>("rename", { path, newName });

export const copyEntries = (sources: string[], destinationDir: string): Promise<void> =>
  invoke<void>("copy_entries", { sources, destinationDir });

export const moveEntries = (sources: string[], destinationDir: string): Promise<void> =>
  invoke<void>("move_entries", { sources, destinationDir });

export const trashEntries = (paths: string[]): Promise<void> =>
  invoke<void>("trash_entries", { paths });
