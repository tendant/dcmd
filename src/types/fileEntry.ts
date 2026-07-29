export type EntryKind = "file" | "directory" | "symlink";

export interface FileEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size: number | null;
  /** Direct child count, directories only. Recursive byte size is opt-in (Space). */
  itemCount: number | null;
  modifiedAt: number | null;
  hidden: boolean;
}
