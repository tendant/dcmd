import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { FileEntry } from "../types/fileEntry";

// Wrapper to handle cases where Tauri might not be ready
const invoke = async <T,>(command: string, args?: any): Promise<T> => {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (err: any) {
    // If Tauri isn't ready, throw a more helpful error
    if (err?.message?.includes("invoke") || err?.message?.includes("undefined")) {
      throw new Error(`Tauri command '${command}' failed - Tauri runtime may not be ready yet. ${err?.message}`);
    }
    throw err;
  }
};

export const listDirectory = (path: string): Promise<FileEntry[]> =>
  invoke<FileEntry[]>("list_directory", { path });

export const defaultStartDir = (): Promise<string> =>
  invoke<string>("default_start_dir");

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
