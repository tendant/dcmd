export type FsErrorKind =
  | "notFound"
  | "alreadyExists"
  | "permissionDenied"
  | "invalidName"
  | "notADirectory"
  | "trash"
  | "io";

export interface FsError {
  kind: FsErrorKind;
  message: string;
}
