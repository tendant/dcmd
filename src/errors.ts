/**
 * Turns backend errors into something a person can act on.
 *
 * The Rust layer tags every error with a `kind` precisely so the UI can say
 * something useful, but the raw `message` is developer-facing: it carries absolute
 * paths, OS error numbers, and internal detail like "task join error". Showing it
 * verbatim tells the user what broke but not what to do, so each kind is mapped to
 * a plain sentence plus a hint where there is a real next step. The raw text is
 * kept in `detail` so nothing is lost for diagnosis.
 */

/** Wire names produced by FsError. Pinned by a Rust test (kind_contract). */
export type FsErrorKind =
  | "notFound"
  | "alreadyExists"
  | "permissionDenied"
  | "invalidName"
  | "notADirectory"
  | "trash"
  | "io"
  | "cancelled";

export interface AppError {
  kind: FsErrorKind | "unknown";
  /** One sentence, safe to show as-is. */
  message: string;
  /** What the user can do about it, when there is something. */
  hint?: string;
  /** Raw backend text, for diagnosis rather than display. */
  detail?: string;
}

/** What the failing operation was, used to phrase the message. */
export type ErrorContext =
  | "list"
  | "open"
  | "copy"
  | "move"
  | "delete"
  | "create folder"
  | "rename"
  | "size";

interface RawError {
  kind?: string;
  message: string;
}

/** Pulls `{kind, message}` out of whatever crossed the Tauri boundary. */
function raw(err: unknown): RawError {
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") {
      return { kind: typeof o.kind === "string" ? o.kind : undefined, message: o.message };
    }
    if (err instanceof Error) return { message: err.message };
    return { message: JSON.stringify(err) };
  }
  return { message: String(err) };
}

/** Trailing path component, which is what the user recognises. */
function name(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/**
 * Backend messages are mostly "context: /some/path". Recovers the path so it can
 * be shortened to a filename, returning null when there is nothing path-like.
 */
function pathFrom(message: string): string | null {
  const m = message.match(/(\/[^\s:]+)/);
  return m ? m[1] : null;
}

export function toAppError(err: unknown, context?: ErrorContext): AppError {
  const { kind, message } = raw(err);
  const p = pathFrom(message);
  const subject = p ? `“${name(p)}”` : "the item";
  const doing = context ? ` while trying to ${context}` : "";

  switch (kind) {
    case "notFound":
      return {
        kind: "notFound",
        message: `${subject} no longer exists.`,
        hint: "It may have been moved or deleted elsewhere. Press ⌘R to refresh.",
        detail: message,
      };

    case "alreadyExists":
      return {
        kind: "alreadyExists",
        message: `Something named ${subject} is already there.`,
        hint: "Choose Keep both or Replace, or rename first.",
        detail: message,
      };

    case "permissionDenied":
      return {
        kind: "permissionDenied",
        message: `Not allowed to access ${subject}.`,
        hint: "Check the file's permissions, or grant dcmd access in System Settings › Privacy & Security.",
        detail: message,
      };

    case "invalidName":
      // These messages are already written for the user.
      return { kind: "invalidName", message: capitalise(message), detail: message };

    case "notADirectory":
      return {
        kind: "notADirectory",
        message: `${subject} is not a folder.`,
        detail: message,
      };

    case "trash":
      return {
        kind: "trash",
        message: `Could not move ${subject} to the Trash.`,
        hint: "Items on some volumes cannot be trashed.",
        detail: message,
      };

    case "cancelled":
      // Not a failure; callers should normally drop this rather than display it.
      return { kind: "cancelled", message: "Cancelled.", detail: message };

    case "io":
    default: {
      // Never surface internal plumbing as if it were a filesystem problem.
      if (/task join error/i.test(message)) {
        return {
          kind: "unknown",
          message: `Something went wrong${doing}.`,
          hint: "Please try again.",
          detail: message,
        };
      }
      return {
        kind: kind === "io" ? "io" : "unknown",
        message: capitalise(stripOsNoise(message)),
        detail: message,
      };
    }
  }
}

/** "Permission denied (os error 13)" reads better without the parenthetical. */
function stripOsNoise(message: string): string {
  return message.replace(/\s*\(os error \d+\)/gi, "").trim();
}

function capitalise(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
}

/** True when an error represents the user's own cancellation. */
export function isCancellation(err: unknown): boolean {
  return raw(err).kind === "cancelled";
}
