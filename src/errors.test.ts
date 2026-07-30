import { describe, expect, it } from "vitest";
import { isCancellation, toAppError } from "./errors";

/** Shape the Tauri boundary actually delivers; pinned by the Rust kind_contract test. */
const fsErr = (kind: string, message: string) => ({ kind, message });

describe("toAppError", () => {
  it("keeps the structured kind instead of discarding it", () => {
    expect(toAppError(fsErr("notFound", "path does not exist: /a/b.txt")).kind).toBe("notFound");
  });

  it("names the file rather than echoing the absolute path", () => {
    const e = toAppError(fsErr("notFound", "path does not exist: /Users/lei/deep/b.txt"));
    expect(e.message).toContain("b.txt");
    expect(e.message).not.toContain("/Users/lei");
  });

  it("keeps the raw text for diagnosis", () => {
    const raw = "path does not exist: /Users/lei/b.txt";
    expect(toAppError(fsErr("notFound", raw)).detail).toBe(raw);
  });

  it("suggests a next step for a name clash", () => {
    const e = toAppError(fsErr("alreadyExists", "destination already exists: /d/x.txt"));
    expect(e.hint).toMatch(/keep both|replace/i);
  });

  it("suggests where to grant access on a permission failure", () => {
    const e = toAppError(fsErr("permissionDenied", "Permission denied: /priv/x"));
    expect(e.hint).toMatch(/permission|privacy/i);
  });

  it("passes invalid-name messages through, since they are already user-facing", () => {
    const e = toAppError(fsErr("invalidName", '".." is not a usable name'));
    expect(e.message).toContain("not a usable name");
  });

  describe("does not leak internals", () => {
    // "task join error" is a thread-plumbing detail; showing it tells the user
    // nothing and looks like a filesystem fault.
    it("replaces task join errors with something generic", () => {
      const e = toAppError(fsErr("io", "task join error: panicked"), "copy");
      expect(e.message).not.toMatch(/task join/i);
      expect(e.message).toMatch(/went wrong/i);
      expect(e.message).toContain("copy");
      expect(e.detail).toMatch(/task join/i); // still recoverable
    });

    it("strips OS error numbers from the sentence", () => {
      const e = toAppError(fsErr("io", "Permission denied (os error 13)"));
      expect(e.message).not.toContain("os error");
      expect(e.detail).toContain("os error 13");
    });
  });

  describe("odd inputs", () => {
    it("handles a bare string", () => {
      expect(toAppError("boom").message).toBe("Boom.");
    });

    it("handles an Error instance", () => {
      expect(toAppError(new Error("kaboom")).message).toBe("Kaboom.");
    });

    it("handles an object with no message", () => {
      expect(toAppError({ weird: true }).kind).toBe("unknown");
    });

    it("does not double up terminal punctuation", () => {
      expect(toAppError("already ended.").message).toBe("Already ended.");
    });
  });

  it("treats an unrecognised kind as unknown rather than crashing", () => {
    expect(toAppError(fsErr("somethingNew", "hmm")).kind).toBe("unknown");
  });
});

describe("isCancellation", () => {
  it("recognises a user cancellation so it is not shown as a failure", () => {
    expect(isCancellation(fsErr("cancelled", "transfer cancelled"))).toBe(true);
  });

  it("does not mistake other errors for cancellation", () => {
    expect(isCancellation(fsErr("io", "disk on fire"))).toBe(false);
    expect(isCancellation("cancelled")).toBe(false);
  });
});
