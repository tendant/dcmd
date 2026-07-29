export type EntryKind = "file" | "directory" | "symlink";

export interface FileEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size: number | null;
  modifiedAt: number | null;
  hidden: boolean;
}
