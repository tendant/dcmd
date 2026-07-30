export type EntryKind = "file" | "directory" | "symlink";

export interface FileEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size: number | null;
  /** Direct child count, directories only. Recursive byte size is opt-in (Space). */
  itemCount: number | null;
  modifiedAt: number | null;
  /** Absent on filesystems that do not record one; the UI must not assume it. */
  createdAt: number | null;
  hidden: boolean;
}
