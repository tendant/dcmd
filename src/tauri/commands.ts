import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "../types/fileEntry";

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
