import { beforeEach, describe, expect, it, vi } from "vitest";

// The shared mocks, so a command added to the app does not silently break this
// file — it has drifted before, and the failure names the mock rather than the
// change that caused it. Only the two returns these tests actually assert on
// are overridden.
vi.mock("../tauri/commands", async () => ({
  ...(await import("../test-utils")).commandMocks,
  trashEntries: vi.fn(async () => ({ completed: [], skipped: [], failed: [] })),
  previewFile: vi.fn(async () => ({ kind: "text", content: "hi", truncated: false })),
}));

import * as commands from "../tauri/commands";
import {
  carriedOverFields,
  entryAtCursor,
  initialCursor,
  parentPath,
  useFileManagerStore,
  visibleEntries,
} from "./fileManagerStore";
import type { FileEntry } from "../types/fileEntry";

const entry = (name: string): FileEntry => ({
  name,
  path: `/left/${name}`,
  kind: "file",
  size: 1,
  itemCount: null,
  modifiedAt: null,
  createdAt: null,
  hidden: false,
});

/** Seed a pane directly; navigate() would call the mocked listDirectory. */
function seedPane(cursor: number, selected: string[] = []) {
  const s = useFileManagerStore.getState();
  useFileManagerStore.setState({
    activePane: "left",
    panes: {
      ...s.panes,
      left: {
        ...s.panes.left,
        path: "/left",
        entries: [entry("a.txt"), entry("b.txt"), entry("c.txt")],
        cursor,
        selected: new Set(selected),
        error: null,
        // Reset every field a test could have dirtied: the store is module-level,
        // so anything left set here leaks into the next test.
        filter: "",
        dirSizes: {},
        renameMode: null,
        isEditingPath: false,
        rangeStart: null,
        loading: false,
        showHidden: false,
        sort: { key: "name", ascending: true },
      },
      right: { ...s.panes.right, path: "/right" },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useFileManagerStore.setState({ dialog: null, transfer: null });
});

describe("operations with no explicit selection", () => {
  // Regression: these previously returned early when nothing was Space-selected,
  // so the F5/F6/F8 keys silently did nothing in the common case.
  it("trashes the row under the cursor", async () => {
    seedPane(2); // cursor 1 is a.txt, since index 0 is the synthetic ".."
    await useFileManagerStore.getState().trashSelection("left");
    expect(commands.trashEntries).toHaveBeenCalledWith(["/left/b.txt"]);
  });

  it("copies the row under the cursor to the other pane", async () => {
    seedPane(1);
    await useFileManagerStore.getState().requestTransfer("copy");
    expect(commands.copyEntriesWith).toHaveBeenCalledWith(
      expect.any(String),
      ["/left/a.txt"],
      "/right",
      "fail",
    );
  });

  it("moves the row under the cursor to the other pane", async () => {
    seedPane(3);
    await useFileManagerStore.getState().requestTransfer("move");
    expect(commands.moveEntriesWith).toHaveBeenCalledWith(
      expect.any(String),
      ["/left/c.txt"],
      "/right",
      "fail",
    );
  });
});

describe("operations with an explicit selection", () => {
  it("prefers the selection over the cursor row", async () => {
    seedPane(1, ["/left/b.txt", "/left/c.txt"]);
    await useFileManagerStore.getState().trashSelection("left");
    const paths = (commands.trashEntries as any).mock.calls[0][0];
    expect([...paths].sort()).toEqual(["/left/b.txt", "/left/c.txt"]);
  });
});

describe("the synthetic parent entry", () => {
  it("is never a target, and reports why", async () => {
    seedPane(0); // cursor on ".."
    await useFileManagerStore.getState().trashSelection("left");
    expect(commands.trashEntries).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().panes.left.error?.message).toBe("Nothing to delete");
  });
});

describe("targetCount", () => {
  it("counts the cursor row when nothing is selected", () => {
    seedPane(2);
    expect(useFileManagerStore.getState().targetCount("left")).toBe(1);
  });

  it("counts the selection when there is one", () => {
    seedPane(1, ["/left/a.txt", "/left/b.txt"]);
    expect(useFileManagerStore.getState().targetCount("left")).toBe(2);
  });

  it("counts nothing on the parent entry", () => {
    seedPane(0);
    expect(useFileManagerStore.getState().targetCount("left")).toBe(0);
  });
});

describe("type-to-filter", () => {
  it("shows only matching entries", () => {
    seedPane(1);
    useFileManagerStore.getState().setFilter("left", "b");
    const s = useFileManagerStore.getState();
    expect(visibleEntries(s.panes.left).map((e) => e.name)).toEqual(["b.txt"]);
  });

  it("matches case-insensitively on a substring", () => {
    seedPane(1);
    useFileManagerStore.getState().setFilter("left", "TX");
    const s = useFileManagerStore.getState();
    expect(visibleEntries(s.panes.left)).toHaveLength(3);
  });

  // The critical one: with a filter active, display index 1 is the first *visible*
  // row. Resolving against the unfiltered array would target a different file,
  // which for F8 would mean trashing something the user cannot see.
  it("resolves operations against the visible row, not the unfiltered index", async () => {
    seedPane(1);
    useFileManagerStore.getState().setFilter("left", "c");
    await useFileManagerStore.getState().trashSelection("left");
    expect(commands.trashEntries).toHaveBeenCalledWith(["/left/c.txt"]);
  });

  it("clamps the cursor into the filtered range", () => {
    seedPane(3); // last of three rows
    useFileManagerStore.getState().setFilter("left", "a"); // only a.txt matches
    expect(useFileManagerStore.getState().panes.left.cursor).toBe(1);
  });

  it("parks the cursor on '..' when nothing matches", () => {
    seedPane(2);
    useFileManagerStore.getState().setFilter("left", "zzzz");
    const s = useFileManagerStore.getState();
    expect(visibleEntries(s.panes.left)).toHaveLength(0);
    expect(s.panes.left.cursor).toBe(0);
  });

  it("clearing the filter restores every entry", () => {
    seedPane(1);
    const store = useFileManagerStore.getState();
    store.setFilter("left", "b");
    store.clearFilter("left");
    expect(visibleEntries(useFileManagerStore.getState().panes.left)).toHaveLength(3);
  });
});

describe("refresh", () => {
  it("keeps the cursor on the same entry when rows shift above it", async () => {
    seedPane(2); // on b.txt
    // A new entry sorts in ahead of b.txt, pushing its index down.
    (commands.listDirectory as any).mockResolvedValueOnce([
      entry("a.txt"), entry("aa-new.txt"), entry("b.txt"), entry("c.txt"),
    ]);
    await useFileManagerStore.getState().refresh("left");
    const s = useFileManagerStore.getState().panes.left;
    expect(entryAtCursor(s)?.name).toBe("b.txt"); // followed the file, not the index
    expect(s.cursor).toBe(3);
  });

  it("preserves the selection, dropping entries that disappeared", async () => {
    seedPane(1, ["/left/a.txt", "/left/c.txt"]);
    (commands.listDirectory as any).mockResolvedValueOnce([entry("a.txt"), entry("b.txt")]);
    await useFileManagerStore.getState().refresh("left");
    const s = useFileManagerStore.getState().panes.left;
    expect([...s.selected]).toEqual(["/left/a.txt"]);
  });

  it("keeps an active filter", async () => {
    seedPane(1);
    useFileManagerStore.getState().setFilter("left", "b");
    (commands.listDirectory as any).mockResolvedValueOnce([
      entry("a.txt"), entry("b.txt"), entry("c.txt"),
    ]);
    await useFileManagerStore.getState().refresh("left");
    const s = useFileManagerStore.getState().panes.left;
    expect(s.filter).toBe("b");
    expect(visibleEntries(s).map((e) => e.name)).toEqual(["b.txt"]);
  });

  it("holds the same slot when the cursor's entry was deleted", async () => {
    seedPane(2); // on b.txt
    (commands.listDirectory as any).mockResolvedValueOnce([entry("a.txt"), entry("c.txt")]);
    await useFileManagerStore.getState().refresh("left");
    expect(useFileManagerStore.getState().panes.left.cursor).toBe(2);
  });

  it("surfaces a listing failure without wedging on loading", async () => {
    seedPane(1);
    (commands.listDirectory as any).mockRejectedValueOnce({ message: "boom" });
    await useFileManagerStore.getState().refresh("left");
    const s = useFileManagerStore.getState().panes.left;
    expect(s.loading).toBe(false);
    expect(s.error?.message).toBe("Boom.");
  });
});

describe("conflict handling", () => {
  it("asks before writing when names already exist", async () => {
    seedPane(1);
    (commands.checkConflicts as any).mockResolvedValueOnce(["a.txt"]);
    await useFileManagerStore.getState().requestTransfer("copy");

    const d = useFileManagerStore.getState().dialog;
    expect(d).toMatchObject({ kind: "conflict", op: "copy", names: ["a.txt"] });
    // Crucially, nothing was written while the question is outstanding.
    expect(commands.copyEntriesWith).not.toHaveBeenCalled();
  });

  it("transfers straight through when there is no clash", async () => {
    seedPane(1);
    (commands.checkConflicts as any).mockResolvedValueOnce([]);
    await useFileManagerStore.getState().requestTransfer("copy");

    expect(useFileManagerStore.getState().dialog).toBeNull();
    expect(commands.copyEntriesWith).toHaveBeenCalledWith(
      expect.any(String),
      ["/left/a.txt"],
      "/right",
      "fail",
    );
  });

  it("passes the chosen policy through and closes the dialog", async () => {
    seedPane(1);
    await useFileManagerStore
      .getState()
      .performTransfer("move", "left", ["/left/a.txt"], "/right", "keepBoth");

    expect(commands.moveEntriesWith).toHaveBeenCalledWith(
      expect.any(String),
      ["/left/a.txt"],
      "/right",
      "keepBoth",
    );
    expect(useFileManagerStore.getState().dialog).toBeNull();
  });

  it("reports a partial result instead of appearing to succeed", async () => {
    seedPane(1);
    (commands.copyEntriesWith as any).mockResolvedValueOnce({
      completed: ["/left/a.txt"],
      skipped: ["/left/b.txt"],
      failed: [
        { path: "/left/c.txt", kind: "permissionDenied", message: "permission denied" },
      ],
    });
    await useFileManagerStore
      .getState()
      .performTransfer("copy", "left", ["/left/a.txt"], "/right", "fail");

    const d = useFileManagerStore.getState().dialog as any;
    expect(d?.kind).toBe("transferOutcome");
    expect(d.failed).toHaveLength(1);
    expect(d.skipped).toHaveLength(1);
    expect(d.completed).toBe(1);
  });

  it("stays quiet when everything succeeded", async () => {
    seedPane(1);
    await useFileManagerStore
      .getState()
      .performTransfer("copy", "left", ["/left/a.txt"], "/right", "fail");
    expect(useFileManagerStore.getState().panes.left.error).toBeNull();
  });
});

describe("delete confirmation", () => {
  it("names what it will delete rather than only counting", () => {
    seedPane(1, ["/left/a.txt", "/left/b.txt"]);
    useFileManagerStore.getState().requestTrash("left");
    const d = useFileManagerStore.getState().dialog;
    expect(d).toMatchObject({ kind: "confirmTrash" });
    expect((d as any).paths.sort()).toEqual(["/left/a.txt", "/left/b.txt"]);
  });

  it("does not delete until confirmed", () => {
    seedPane(1);
    useFileManagerStore.getState().requestTrash("left");
    expect(commands.trashEntries).not.toHaveBeenCalled();
  });

  it("opens no dialog when there is nothing to delete", () => {
    seedPane(0);
    useFileManagerStore.getState().requestTrash("left");
    expect(useFileManagerStore.getState().dialog).toBeNull();
    expect(useFileManagerStore.getState().panes.left.error?.message).toBe("Nothing to delete");
  });
});

describe("transfer progress", () => {
  it("registers a running transfer so it can be shown and cancelled", async () => {
    seedPane(1);
    let observed: any = null;
    (commands.copyEntriesWith as any).mockImplementationOnce(async () => {
      observed = useFileManagerStore.getState().transfer;
      return { completed: [], skipped: [], failed: [] };
    });
    await useFileManagerStore
      .getState()
      .performTransfer("copy", "left", ["/left/a.txt"], "/right", "fail");

    expect(observed).toMatchObject({ op: "copy", pane: "left", total: 1 });
    // Cleared once finished, so no stale bar is left on screen.
    expect(useFileManagerStore.getState().transfer).toBeNull();
  });

  it("clears the transfer even when it fails", async () => {
    seedPane(1);
    (commands.copyEntriesWith as any).mockRejectedValueOnce({ message: "nope" });
    await useFileManagerStore
      .getState()
      .performTransfer("copy", "left", ["/left/a.txt"], "/right", "fail");
    expect(useFileManagerStore.getState().transfer).toBeNull();
    expect(useFileManagerStore.getState().panes.left.error?.message).toBe("Nope.");
  });

  it("applies progress events only to the matching transfer", () => {
    useFileManagerStore.setState({
      transfer: { id: "copy-1", op: "copy", pane: "left", current: 0, total: 10, name: "" },
    });
    const store = useFileManagerStore.getState();

    store.setTransferProgress({ id: "copy-1", current: 4, total: 10, name: "d.txt" });
    expect(useFileManagerStore.getState().transfer).toMatchObject({ current: 4, name: "d.txt" });

    // A late event from an earlier transfer must not rewind the bar.
    store.setTransferProgress({ id: "copy-0", current: 99, total: 99, name: "stale" });
    expect(useFileManagerStore.getState().transfer).toMatchObject({ current: 4, name: "d.txt" });
  });

  it("asks the backend to cancel the running transfer", () => {
    useFileManagerStore.setState({
      transfer: { id: "copy-7", op: "copy", pane: "left", current: 1, total: 5, name: "x" },
    });
    useFileManagerStore.getState().cancelTransfer();
    expect(commands.cancelTransfer).toHaveBeenCalledWith("copy-7");
  });
});

describe("error reporting", () => {
  it("does not show a user cancellation as a failure", () => {
    seedPane(1);
    useFileManagerStore.getState().reportError("left", { kind: "cancelled", message: "stopped" });
    expect(useFileManagerStore.getState().panes.left.error).toBeNull();
  });

  it("maps a backend error into a message with a hint", () => {
    seedPane(1);
    useFileManagerStore
      .getState()
      .reportError("left", { kind: "permissionDenied", message: "denied: /x/y.txt" }, "copy");
    const e = useFileManagerStore.getState().panes.left.error;
    expect(e?.kind).toBe("permissionDenied");
    expect(e?.hint).toBeTruthy();
    expect(e?.detail).toContain("/x/y.txt");
  });

  it("can be dismissed", () => {
    seedPane(1);
    const store = useFileManagerStore.getState();
    store.reportError("left", { kind: "io", message: "bad" });
    expect(useFileManagerStore.getState().panes.left.error).not.toBeNull();
    store.setPaneError("left", null);
    expect(useFileManagerStore.getState().panes.left.error).toBeNull();
  });
});

describe("same source and destination folder", () => {
  function bothPanesSameDir() {
    seedPane(1);
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: { ...s.panes, right: { ...s.panes.right, path: "/left" } },
    });
  }

  // The destructive path: a conflict dialog would offer Replace, and replacing
  // into the source's own folder deletes the source before copying from it.
  it("refuses a copy without ever asking about conflicts", async () => {
    bothPanesSameDir();
    await useFileManagerStore.getState().requestTransfer("copy");

    expect(commands.checkConflicts).not.toHaveBeenCalled();
    expect(commands.copyEntriesWith).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().dialog).toBeNull();
  });

  it("refuses a move the same way", async () => {
    bothPanesSameDir();
    await useFileManagerStore.getState().requestTransfer("move");
    expect(commands.moveEntriesWith).not.toHaveBeenCalled();
  });

  it("explains why, and what to do", async () => {
    bothPanesSameDir();
    await useFileManagerStore.getState().requestTransfer("copy");
    const e = useFileManagerStore.getState().panes.left.error;
    expect(e?.message).toMatch(/same folder/i);
    expect(e?.hint).toMatch(/other pane/i);
  });

  it("still allows a transfer between different folders", async () => {
    seedPane(1); // right pane is /right
    await useFileManagerStore.getState().requestTransfer("copy");
    expect(commands.checkConflicts).toHaveBeenCalled();
  });
});

describe("transfer outcome reporting", () => {
  it("itemises every failure instead of collapsing them into one line", async () => {
    seedPane(1);
    (commands.copyEntriesWith as any).mockResolvedValueOnce({
      completed: ["/left/ok.txt"],
      skipped: [],
      failed: [
        { path: "/left/a.txt", kind: "permissionDenied", message: "denied: /left/a.txt" },
        { path: "/left/b.txt", kind: "notFound", message: "path does not exist: /left/b.txt" },
        { path: "/left/c.txt", kind: "io", message: "disk full" },
      ],
    });
    await useFileManagerStore
      .getState()
      .performTransfer("copy", "left", ["/left/a.txt"], "/right", "fail");

    const d = useFileManagerStore.getState().dialog as any;
    expect(d?.kind).toBe("transferOutcome");
    expect(d.failed).toHaveLength(3);
    // Each carries its own kind, so each can be phrased for the user.
    expect(d.failed.map((f: any) => f.kind)).toEqual([
      "permissionDenied",
      "notFound",
      "io",
    ]);
    expect(d.completed).toBe(1);
  });

  it("reports skipped items by name", async () => {
    seedPane(1);
    (commands.copyEntriesWith as any).mockResolvedValueOnce({
      completed: ["/left/a.txt"],
      skipped: ["/left/dup.txt", "/left/dup2.txt"],
      failed: [],
    });
    await useFileManagerStore
      .getState()
      .performTransfer("copy", "left", ["/left/a.txt"], "/right", "skip");

    const d = useFileManagerStore.getState().dialog as any;
    expect(d?.kind).toBe("transferOutcome");
    expect(d.skipped).toEqual(["/left/dup.txt", "/left/dup2.txt"]);
  });

  it("stays silent when everything succeeded", async () => {
    seedPane(1);
    (commands.copyEntriesWith as any).mockResolvedValueOnce({
      completed: ["/left/a.txt"],
      skipped: [],
      failed: [],
    });
    await useFileManagerStore
      .getState()
      .performTransfer("copy", "left", ["/left/a.txt"], "/right", "fail");

    expect(useFileManagerStore.getState().dialog).toBeNull();
    expect(useFileManagerStore.getState().panes.left.error).toBeNull();
  });
});

describe("path editing", () => {
  it("can be started and cancelled from the store", () => {
    seedPane(1);
    const store = useFileManagerStore.getState();
    store.startEditingPath("left");
    expect(useFileManagerStore.getState().panes.left.isEditingPath).toBe(true);
    store.cancelPathEdit("left");
    expect(useFileManagerStore.getState().panes.left.isEditingPath).toBe(false);
  });
});

describe("hidden files", () => {
  function withDotfiles(cursor: number) {
    seedPane(cursor);
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: {
        ...s.panes,
        left: {
          ...s.panes.left,
          entries: [
            { ...entry("a.txt"), hidden: false },
            { ...entry(".env"), hidden: true },
            { ...entry("b.txt"), hidden: false },
          ],
        },
      },
    });
  }

  it("hides dotfiles by default", () => {
    withDotfiles(1);
    const names = visibleEntries(useFileManagerStore.getState().panes.left).map((e) => e.name);
    expect(names).toEqual(["a.txt", "b.txt"]);
  });

  it("shows them once toggled", () => {
    withDotfiles(1);
    useFileManagerStore.getState().toggleHidden("left");
    const names = visibleEntries(useFileManagerStore.getState().panes.left).map((e) => e.name);
    // Sorted, so ".env" leads rather than sitting where it was inserted.
    expect(names).toEqual([".env", "a.txt", "b.txt"]);
  });

  // The hazard: with dotfiles hidden, display index 2 is b.txt, not .env. An
  // operation resolving against the raw entries array would act on the wrong file.
  it("resolves the cursor against what is actually shown", async () => {
    withDotfiles(2);
    await useFileManagerStore.getState().trashSelection("left");
    expect(commands.trashEntries).toHaveBeenCalledWith(["/left/b.txt"]);
  });

  it("keeps the cursor in range when rows disappear", () => {
    withDotfiles(1);
    const store = useFileManagerStore.getState();
    store.toggleHidden("left"); // 3 rows shown
    useFileManagerStore.getState().setCursor("left", 3);
    store.toggleHidden("left"); // back to 2 rows
    expect(useFileManagerStore.getState().panes.left.cursor).toBeLessThanOrEqual(2);
  });

  it("is per pane", () => {
    withDotfiles(1);
    useFileManagerStore.getState().toggleHidden("left");
    expect(useFileManagerStore.getState().panes.left.showHidden).toBe(true);
    expect(useFileManagerStore.getState().panes.right.showHidden).toBe(false);
  });
});

describe("trash reporting", () => {
  it("names what could not be deleted", async () => {
    seedPane(1);
    (commands.trashEntries as any).mockResolvedValueOnce({
      completed: ["/left/a.txt"],
      skipped: [],
      failed: [{ path: "/left/locked.txt", kind: "trash", message: "locked.txt: in use" }],
    });
    await useFileManagerStore.getState().trashSelection("left");
    const d = useFileManagerStore.getState().dialog as any;
    expect(d?.kind).toBe("transferOutcome");
    expect(d.op).toBe("delete");
    expect(d.failed).toHaveLength(1);
  });

  it("stays quiet when everything was deleted", async () => {
    seedPane(1);
    (commands.trashEntries as any).mockResolvedValueOnce({
      completed: ["/left/a.txt"],
      skipped: [],
      failed: [],
    });
    await useFileManagerStore.getState().trashSelection("left");
    expect(useFileManagerStore.getState().dialog).toBeNull();
  });
});

describe("sorting", () => {
  const at = (name: string, over: Partial<FileEntry> = {}): FileEntry => ({
    ...entry(name),
    ...over,
  });

  function seedMixed() {
    seedPane(1);
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: {
        ...s.panes,
        left: {
          ...s.panes.left,
          entries: [
            at("file10.txt", { size: 10, modifiedAt: 300, createdAt: 30 }),
            at("dir-b", { kind: "directory", size: null, modifiedAt: 100 }),
            at("file2.txt", { size: 500, modifiedAt: 200, createdAt: 10 }),
            at("dir-a", { kind: "directory", size: null, modifiedAt: 400 }),
          ],
        },
      },
    });
  }
  const names = () =>
    visibleEntries(useFileManagerStore.getState().panes.left).map((e) => e.name);

  it("groups directories ahead of files", () => {
    seedMixed();
    expect(names().slice(0, 2)).toEqual(["dir-a", "dir-b"]);
  });

  it("keeps directories first even when sorting by size", () => {
    seedMixed();
    useFileManagerStore.getState().setSort("left", "size");
    expect(names().slice(0, 2).every((n) => n.startsWith("dir"))).toBe(true);
  });

  it("orders names the way a person reads them", () => {
    seedMixed();
    // Plain string comparison would put file10 before file2.
    expect(names().slice(2)).toEqual(["file2.txt", "file10.txt"]);
  });

  it("reverses when the active key is chosen again", () => {
    seedMixed();
    const store = useFileManagerStore.getState();
    store.setSort("left", "name");
    expect(useFileManagerStore.getState().panes.left.sort.ascending).toBe(false);
    expect(names().slice(0, 2)).toEqual(["dir-b", "dir-a"]);
  });

  it("starts ascending when a different key is chosen", () => {
    seedMixed();
    const store = useFileManagerStore.getState();
    store.setSort("left", "name"); // now descending
    store.setSort("left", "size");
    const s = useFileManagerStore.getState().panes.left.sort;
    expect(s).toEqual({ key: "size", ascending: true });
  });

  it("sorts by size, largest last when ascending", () => {
    seedMixed();
    useFileManagerStore.getState().setSort("left", "size");
    expect(names().slice(2)).toEqual(["file10.txt", "file2.txt"]);
  });

  it("sorts by modified time", () => {
    seedMixed();
    useFileManagerStore.getState().setSort("left", "modified");
    expect(names().slice(2)).toEqual(["file2.txt", "file10.txt"]);
  });

  // The documented trap: creation time is absent on some filesystems.
  it("puts entries with no creation time last, in both directions", () => {
    seedPane(1);
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: {
        ...s.panes,
        left: {
          ...s.panes.left,
          entries: [
            at("unknown.txt", { createdAt: null }),
            at("older.txt", { createdAt: 100 }),
            at("newer.txt", { createdAt: 900 }),
          ],
        },
      },
    });
    const store = useFileManagerStore.getState();
    store.setSort("left", "created");
    expect(names()).toEqual(["older.txt", "newer.txt", "unknown.txt"]);
    store.setSort("left", "created"); // descending
    expect(names()).toEqual(["newer.txt", "older.txt", "unknown.txt"]);
  });

  it("keeps the cursor on the same entry when the order changes", () => {
    seedMixed();
    const store = useFileManagerStore.getState();
    store.setCursor("left", 3); // file2.txt under the default name sort
    const before = entryAtCursor(useFileManagerStore.getState().panes.left)?.name;
    store.setSort("left", "size");
    const after = entryAtCursor(useFileManagerStore.getState().panes.left)?.name;
    expect(after).toBe(before);
  });

  // Sorting must not desynchronise the cursor from a filtered view.
  it("resolves operations against the sorted, filtered rows", async () => {
    seedMixed();
    const store = useFileManagerStore.getState();
    store.setFilter("left", "file");
    store.setSort("left", "size"); // file10 (10) then file2 (500)
    useFileManagerStore.getState().setCursor("left", 1);
    await useFileManagerStore.getState().trashSelection("left");
    expect(commands.trashEntries).toHaveBeenCalledWith(["/left/file10.txt"]);
  });

  it("is per pane", () => {
    seedMixed();
    useFileManagerStore.getState().setSort("left", "size");
    expect(useFileManagerStore.getState().panes.right.sort.key).toBe("name");
  });
});

describe("pane sizing", () => {
  beforeEach(() => {
    useFileManagerStore.setState({ splitRatio: 0.5, collapsed: null, activePane: "left" });
  });

  it("starts evenly split", () => {
    expect(useFileManagerStore.getState().splitRatio).toBe(0.5);
  });

  // A ratio, not a pixel width: resizing the window must not push a pane away.
  it("clamps so a pane cannot be squeezed to nothing", () => {
    const store = useFileManagerStore.getState();
    store.setSplitRatio(0);
    expect(useFileManagerStore.getState().splitRatio).toBeGreaterThan(0.1);
    store.setSplitRatio(1);
    expect(useFileManagerStore.getState().splitRatio).toBeLessThan(0.9);
  });

  it("clamps nudges the same way", () => {
    const store = useFileManagerStore.getState();
    for (let i = 0; i < 40; i++) store.nudgeSplit(-0.05);
    expect(useFileManagerStore.getState().splitRatio).toBeGreaterThan(0.1);
  });

  it("nudges by the requested amount within range", () => {
    useFileManagerStore.getState().nudgeSplit(0.1);
    expect(useFileManagerStore.getState().splitRatio).toBeCloseTo(0.6);
  });

  it("resets to even and restores a collapsed pane", () => {
    const store = useFileManagerStore.getState();
    store.setSplitRatio(0.8);
    store.toggleCollapse("right");
    store.resetSplit();
    const s = useFileManagerStore.getState();
    expect(s.splitRatio).toBe(0.5);
    expect(s.collapsed).toBeNull();
  });

  it("collapses and restores the same pane", () => {
    const store = useFileManagerStore.getState();
    store.toggleCollapse("right");
    expect(useFileManagerStore.getState().collapsed).toBe("right");
    useFileManagerStore.getState().toggleCollapse("right");
    expect(useFileManagerStore.getState().collapsed).toBeNull();
  });

  // Focus cannot remain on a pane that is no longer on screen.
  it("moves focus off a pane as it collapses", () => {
    useFileManagerStore.setState({ activePane: "left" });
    useFileManagerStore.getState().toggleCollapse("left");
    expect(useFileManagerStore.getState().activePane).toBe("right");
  });

  it("leaves focus alone when collapsing the other pane", () => {
    useFileManagerStore.setState({ activePane: "left" });
    useFileManagerStore.getState().toggleCollapse("right");
    expect(useFileManagerStore.getState().activePane).toBe("left");
  });
});

describe("parentPath", () => {
  it("returns the directory above", () => {
    expect(parentPath("/a/b/c")).toBe("/a/b");
    expect(parentPath("/a")).toBe("/");
  });

  // The context menu decides whether to offer "Go up" from this, so the two
  // must agree about where the top is.
  it("returns null at the root", () => {
    expect(parentPath("/")).toBeNull();
  });
});

describe("navigation history", () => {
  beforeEach(() => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: { ...s.panes, left: { ...s.panes.left, path: "", history: [], historyIndex: -1 } },
    });
  });

  const go = (p: string) => useFileManagerStore.getState().navigate("left", p);
  const at = () => useFileManagerStore.getState().panes.left.path;

  it("records each directory visited", async () => {
    await go("/a");
    await go("/a/b");
    const s = useFileManagerStore.getState().panes.left;
    expect(s.history).toEqual(["/a", "/a/b"]);
    expect(s.historyIndex).toBe(1);
  });

  it("goes back and forward", async () => {
    await go("/a");
    await go("/a/b");
    await useFileManagerStore.getState().goBack("left");
    expect(at()).toBe("/a");
    await useFileManagerStore.getState().goForward("left");
    expect(at()).toBe("/a/b");
  });

  // Recording while replaying would push a new entry and never actually move.
  it("does not record the entries it replays", async () => {
    await go("/a");
    await go("/a/b");
    await useFileManagerStore.getState().goBack("left");
    expect(useFileManagerStore.getState().panes.left.history).toEqual(["/a", "/a/b"]);
  });

  it("discards the forward stack when going somewhere new", async () => {
    await go("/a");
    await go("/a/b");
    await useFileManagerStore.getState().goBack("left");
    await go("/c");
    const s = useFileManagerStore.getState().panes.left;
    expect(s.history).toEqual(["/a", "/c"]);
    expect(useFileManagerStore.getState().canGoForward("left")).toBe(false);
  });

  it("does nothing at either end", async () => {
    await go("/a");
    expect(useFileManagerStore.getState().canGoBack("left")).toBe(false);
    await useFileManagerStore.getState().goBack("left");
    expect(at()).toBe("/a");
    await useFileManagerStore.getState().goForward("left");
    expect(at()).toBe("/a");
  });

  it("does not record navigating to where it already is", async () => {
    await go("/a");
    await go("/a");
    expect(useFileManagerStore.getState().panes.left.history).toEqual(["/a"]);
  });

  it("records going up as a normal move", async () => {
    await go("/a/b");
    await useFileManagerStore.getState().goToParent("left");
    expect(at()).toBe("/a");
    await useFileManagerStore.getState().goBack("left");
    expect(at()).toBe("/a/b");
  });

  it("is per pane", async () => {
    await go("/a");
    await go("/a/b");
    expect(useFileManagerStore.getState().canGoBack("right")).toBe(false);
  });

  it("does not grow without bound", async () => {
    for (let i = 0; i < 250; i++) await go(`/d${i}`);
    const s = useFileManagerStore.getState().panes.left;
    expect(s.history.length).toBeLessThanOrEqual(200);
    expect(s.history[s.history.length - 1]).toBe("/d249");
    expect(s.historyIndex).toBe(s.history.length - 1);
  });
});

describe("bookmarks", () => {
  beforeEach(() => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      bookmarks: [],
      panes: { ...s.panes, left: { ...s.panes.left, path: "/Users/x/code" } },
    });
  });

  it("names a bookmark after its folder", () => {
    useFileManagerStore.getState().addBookmark("left");
    expect(useFileManagerStore.getState().bookmarks).toEqual([
      // remote is null for a folder on this machine, which is what makes
      // opening it later come back here.
      { name: "code", path: "/Users/x/code", remote: null },
    ]);
  });

  it("does not add the same folder twice", () => {
    const store = useFileManagerStore.getState();
    store.addBookmark("left");
    useFileManagerStore.getState().addBookmark("left");
    expect(useFileManagerStore.getState().bookmarks).toHaveLength(1);
  });

  it("reports whether a folder is bookmarked", () => {
    expect(useFileManagerStore.getState().isBookmarked("/Users/x/code")).toBe(false);
    useFileManagerStore.getState().addBookmark("left");
    expect(useFileManagerStore.getState().isBookmarked("/Users/x/code")).toBe(true);
  });

  it("removes by path", () => {
    useFileManagerStore.getState().addBookmark("left");
    useFileManagerStore.getState().removeBookmark("/Users/x/code");
    expect(useFileManagerStore.getState().bookmarks).toEqual([]);
  });

  it("ignores a pane that has no path yet", () => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({ panes: { ...s.panes, left: { ...s.panes.left, path: "" } } });
    useFileManagerStore.getState().addBookmark("left");
    expect(useFileManagerStore.getState().bookmarks).toEqual([]);
  });
});

describe("remote panes", () => {
  beforeEach(() => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      remoteCache: {},
      remotes: [{ name: "Build", alias: "build", startPath: "/home/ci" }],
      panes: {
        ...s.panes,
        left: { ...s.panes.left, remote: null, path: "/local", history: [], historyIndex: -1 },
      },
    });
  });

  it("lists through the remote command once connected", async () => {
    await useFileManagerStore.getState().connectPane("left", "build");
    expect(commands.listRemoteDirectory).toHaveBeenCalledWith("build", "/home/ci");
    expect(commands.listDirectory).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().panes.left.remote).toBe("build");
  });

  it("opens at the host's configured start path", async () => {
    await useFileManagerStore.getState().connectPane("left", "build");
    expect(useFileManagerStore.getState().panes.left.path).toBe("/home/ci");
  });

  it("goes back to the local machine", async () => {
    await useFileManagerStore.getState().connectPane("left", "build");
    await useFileManagerStore.getState().connectPane("left", null, "/local");
    expect(useFileManagerStore.getState().panes.left.remote).toBeNull();
    expect(commands.listDirectory).toHaveBeenCalledWith("/local");
  });

  // History belongs to a machine; offering to go "back" to a path that does not
  // exist on the new one would be worse than useless.
  it("clears history when switching machines", async () => {
    await useFileManagerStore.getState().navigate("left", "/local/a");
    await useFileManagerStore.getState().connectPane("left", "build");
    expect(useFileManagerStore.getState().canGoBack("left")).toBe(false);
  });

  describe("the session cache", () => {
    it("serves a revisited directory without another round trip", async () => {
      await useFileManagerStore.getState().connectPane("left", "build");
      await useFileManagerStore.getState().navigate("left", "/home/ci/sub");
      await useFileManagerStore.getState().navigate("left", "/home/ci");
      // Two distinct directories, three navigations.
      expect((commands.listRemoteDirectory as any).mock.calls.length).toBe(2);
    });

    it("reports how old a cached listing is", async () => {
      await useFileManagerStore.getState().connectPane("left", "build");
      const age = useFileManagerStore.getState().listingAge("left");
      expect(age).not.toBeNull();
      expect(age).toBeLessThan(1000);
    });

    it("has no age for a local pane", () => {
      expect(useFileManagerStore.getState().listingAge("left")).toBeNull();
    });

    // Refresh is how the user says they do not trust the cache.
    it("refetches on refresh rather than serving the cache", async () => {
      await useFileManagerStore.getState().connectPane("left", "build");
      const before = (commands.listRemoteDirectory as any).mock.calls.length;
      await useFileManagerStore.getState().refresh("left");
      expect((commands.listRemoteDirectory as any).mock.calls.length).toBe(before + 1);
    });
  });
});

describe("transfers involving a host", () => {
  beforeEach(() => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      dialog: null,
      remoteCache: {},
      panes: {
        left: { ...s.panes.left, remote: null, path: "/local", entries: [entry("a.txt")], cursor: 1, selected: new Set(), filter: "", showHidden: false },
        right: { ...s.panes.right, remote: "build", path: "/srv" },
      },
    });
  });

  // rsync can say exactly what it would do, so the user agrees to a list rather
  // than to the idea of a transfer.
  it("previews with a dry run before writing anything", async () => {
    (commands.rsyncTransfer as any).mockResolvedValueOnce({
      changes: ["a.txt"], cancelled: false, errors: [],
    });
    await useFileManagerStore.getState().requestTransfer("copy");

    const call = (commands.rsyncTransfer as any).mock.calls[0];
    expect(call[3]).toBe(true); // dryRun
    const d = useFileManagerStore.getState().dialog as any;
    expect(d.kind).toBe("rsyncPreview");
    expect(d.changes).toEqual(["a.txt"]);
  });

  it("sends the destination host on the destination endpoint", async () => {
    await useFileManagerStore.getState().requestTransfer("copy");
    const [, sources, destination] = (commands.rsyncTransfer as any).mock.calls[0];
    expect(sources).toEqual([{ alias: null, path: "/left/a.txt" }]);
    expect(destination).toEqual({ alias: "build", path: "/srv" });
  });

  it("only transfers once the preview is accepted", async () => {
    await useFileManagerStore.getState().requestTransfer("copy");
    const afterPreview = (commands.rsyncTransfer as any).mock.calls.length;
    const d = useFileManagerStore.getState().dialog as any;
    await useFileManagerStore.getState().runRsync(d.pane, d.sources, d.destination);
    const calls = (commands.rsyncTransfer as any).mock.calls;
    expect(calls.length).toBe(afterPreview + 1);
    expect(calls[calls.length - 1][3]).toBe(false); // not a dry run
  });

  it("refuses to move to or from a host, and says why", async () => {
    await useFileManagerStore.getState().requestTransfer("move");
    expect(commands.rsyncTransfer).not.toHaveBeenCalled();
    const err = useFileManagerStore.getState().panes.left.error;
    expect(err?.message).toMatch(/not supported/i);
    expect(err?.hint).toMatch(/copy/i);
  });

  it("uses the local path when neither pane is remote", async () => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: { ...s.panes, right: { ...s.panes.right, remote: null } },
    });
    await useFileManagerStore.getState().requestTransfer("copy");
    expect(commands.rsyncTransfer).not.toHaveBeenCalled();
    expect(commands.checkConflicts).toHaveBeenCalled();
  });

  it("shows the transfer in the progress bar while it runs", async () => {
    let seen: any = null;
    (commands.rsyncTransfer as any).mockImplementationOnce(async () => {
      seen = useFileManagerStore.getState().transfer;
      return { changes: [], cancelled: false, errors: [] };
    });
    await useFileManagerStore
      .getState()
      .runRsync("left", [{ alias: null, path: "/local/a.txt" }], { alias: "build", path: "/srv" });
    expect(seen).toMatchObject({ pane: "left", total: 1 });
    expect(useFileManagerStore.getState().transfer).toBeNull();
  });
});

describe("adding a host", () => {
  beforeEach(() => useFileManagerStore.setState({ remotes: [], dialog: null }));

  // Typing an alias by hand is error-prone, and ssh already knows them all.
  it("offers the hosts from the ssh config", async () => {
    await useFileManagerStore.getState().requestAddRemote("left");
    const d = useFileManagerStore.getState().dialog as any;
    expect(d.kind).toBe("addRemote");
    expect(d.available).toEqual(["alpha", "beta"]);
  });

  it("does not offer a host already added", async () => {
    useFileManagerStore.setState({ remotes: [{ name: "alpha", alias: "alpha", startPath: "~" }] });
    await useFileManagerStore.getState().requestAddRemote("left");
    expect((useFileManagerStore.getState().dialog as any).available).toEqual(["beta"]);
  });

  it("adds one and closes the dialog", async () => {
    await useFileManagerStore.getState().requestAddRemote("left");
    useFileManagerStore.getState().addRemote("alpha");
    const s = useFileManagerStore.getState();
    expect(s.remotes).toEqual([{ name: "alpha", alias: "alpha", startPath: "." }]);
    expect(s.dialog).toBeNull();
  });

  it("ignores a duplicate or an empty alias", () => {
    const store = useFileManagerStore.getState();
    store.addRemote("alpha");
    useFileManagerStore.getState().addRemote("alpha");
    useFileManagerStore.getState().addRemote("   ");
    expect(useFileManagerStore.getState().remotes).toHaveLength(1);
  });

  it("forgets one", () => {
    useFileManagerStore.getState().addRemote("alpha");
    useFileManagerStore.getState().removeRemote("alpha");
    expect(useFileManagerStore.getState().remotes).toEqual([]);
  });
});

describe("remote paths the server resolves", () => {
  beforeEach(() => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      remoteCache: {},
      remotes: [{ name: "Build", alias: "build", startPath: "." }],
      panes: { ...s.panes, left: { ...s.panes.left, remote: null, history: [], historyIndex: -1 } },
    });
  });

  // Regression: the default was "~", which SFTP looks up as a directory with
  // that literal name, so connecting failed with "does not exist".
  it("shows where the server said it landed, not what was asked for", async () => {
    (commands.listRemoteDirectory as any).mockResolvedValueOnce({
      path: "/home/ci",
      entries: [],
    });
    await useFileManagerStore.getState().connectPane("left", "build");
    expect(useFileManagerStore.getState().panes.left.path).toBe("/home/ci");
  });

  it("caches under the resolved path so returning to it is a hit", async () => {
    (commands.listRemoteDirectory as any).mockResolvedValueOnce({
      path: "/home/ci",
      entries: [],
    });
    await useFileManagerStore.getState().connectPane("left", "build");
    const before = (commands.listRemoteDirectory as any).mock.calls.length;
    await useFileManagerStore.getState().navigate("left", "/home/ci");
    expect((commands.listRemoteDirectory as any).mock.calls.length).toBe(before);
  });

  it("defaults a new host to a path SFTP understands", () => {
    useFileManagerStore.setState({ remotes: [] });
    useFileManagerStore.getState().addRemote("newhost");
    const added = useFileManagerStore.getState().remotes[0];
    expect(added.startPath).not.toContain("~");
  });
});

describe("the cursor in a freshly listed directory", () => {
  const listed = (names: string[]) =>
    names.map((n) => ({
      name: n,
      path: `/d/${n}`,
      kind: "file" as const,
      size: 1,
      itemCount: null,
      modifiedAt: null,
      createdAt: null,
      hidden: n.startsWith("."),
    }));

  it("starts on the first entry, not on ..", async () => {
    vi.mocked(commands.listDirectory).mockResolvedValueOnce(listed(["a", "b"]));
    await useFileManagerStore.getState().navigate("left", "/d");

    const pane = useFileManagerStore.getState().panes.left;
    expect(pane.cursor).toBe(1);
    // The point of it: an operation now has something to act on immediately.
    expect(entryAtCursor(pane)?.name).toBe("a");
  });

  it("falls back to .. when the directory is empty", async () => {
    vi.mocked(commands.listDirectory).mockResolvedValueOnce([]);
    await useFileManagerStore.getState().navigate("left", "/d");

    const pane = useFileManagerStore.getState().panes.left;
    expect(pane.cursor).toBe(0);
    expect(entryAtCursor(pane)).toBeNull();
  });

  // Every entry hidden is the same situation as an empty directory: there is no
  // row to sit on, and pointing at one that is not rendered would be worse.
  it("falls back to .. when everything is filtered out of view", () => {
    const s = useFileManagerStore.getState();
    const pane = {
      ...s.panes.left,
      entries: listed([".a", ".b"]),
      showHidden: false,
      filter: "",
    };
    expect(initialCursor(pane)).toBe(0);
  });

  it("counts the first visible row, not the first listed one", () => {
    const s = useFileManagerStore.getState();
    const pane = {
      ...s.panes.left,
      entries: listed([".hidden", "visible"]),
      showHidden: false,
      filter: "",
    };
    expect(initialCursor(pane)).toBe(1);
    expect(entryAtCursor({ ...pane, cursor: 1 })?.name).toBe("visible");
  });
});

describe("the places bar while a pane is on a remote", () => {
  beforeEach(() => {
    // Both panes reset explicitly: the shared beforeEach does not clear
    // `remote`, so an earlier test leaving a pane connected would make these
    // pass or fail for reasons that have nothing to do with the places bar.
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      remotes: [{ alias: "build", name: "build", startPath: "/srv" }],
      bookmarks: [{ name: "docs", path: "/home/me/docs" }],
      panes: {
        left: { ...s.panes.left, remote: null, path: "/home/me" },
        right: { ...s.panes.right, remote: null, path: "/home/me" },
      },
    });
  });

  it("connects only the pane that was clicked", async () => {
    await useFileManagerStore.getState().connectPane("left", "build");
    const { panes } = useFileManagerStore.getState();
    expect(panes.left.remote).toBe("build");
    expect(panes.right.remote).toBeNull();
  });

  // A bookmark is a path on a particular machine. Opening a local one from a
  // pane that is connected to a server has to come back to this machine, not
  // look for that path over there.
  it("opens a local bookmark locally, not on the connected host", async () => {
    const store = useFileManagerStore.getState();
    await store.connectPane("left", "build");
    expect(useFileManagerStore.getState().panes.left.remote).toBe("build");

    vi.mocked(commands.listDirectory).mockClear();
    vi.mocked(commands.listRemoteDirectory).mockClear();

    await store.connectPane("left", null, "/home/me/docs");

    expect(commands.listDirectory).toHaveBeenCalledWith("/home/me/docs");
    expect(commands.listRemoteDirectory).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().panes.left.remote).toBeNull();
  });

  it("opens a remote bookmark on the host it was taken from", async () => {
    const store = useFileManagerStore.getState();
    vi.mocked(commands.listRemoteDirectory).mockClear();

    await store.connectPane("right", "build", "/srv/code");

    expect(commands.listRemoteDirectory).toHaveBeenCalledWith("build", "/srv/code");
    expect(useFileManagerStore.getState().panes.right.remote).toBe("build");
  });

  it("records the host when bookmarking a remote folder", async () => {
    const store = useFileManagerStore.getState();
    await store.connectPane("left", "build", "/srv/code");
    useFileManagerStore.getState().addBookmark("left");

    const list = useFileManagerStore.getState().bookmarks;
    const added = list[list.length - 1];
    expect(added).toMatchObject({ path: "/srv/code", remote: "build" });
  });

  // The same path string on two machines is two different places, so one must
  // not mask the other in the bar.
  it("treats the same path on a different host as a separate bookmark", async () => {
    const store = useFileManagerStore.getState();
    useFileManagerStore.setState({ bookmarks: [{ name: "code", path: "/srv/code", remote: null }] });

    await store.connectPane("left", "build", "/srv/code");
    useFileManagerStore.getState().addBookmark("left");

    expect(useFileManagerStore.getState().bookmarks).toHaveLength(2);
  });
});

describe("opening a preview", () => {
  const file = (name: string, kind: "file" | "directory" = "file") => ({
    name,
    path: `/p/${name}`,
    kind,
    size: 1,
    itemCount: null,
    modifiedAt: null,
    createdAt: null,
    hidden: false,
  });

  const seedFor = (cursor: number, entries = [file("a.txt"), file("sub", "directory")]) => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      preview: null,
      activePane: "left",
      panes: {
        ...s.panes,
        left: {
          ...s.panes.left,
          path: "/p",
          remote: null,
          entries,
          filter: "",
          showHidden: true,
          sort: { key: "name", ascending: true },
          cursor,
        },
      },
    });
  };

  // Directories sort first, so display index 1 is "sub" and 2 is "a.txt".
  it("previews the file under the cursor", async () => {
    seedFor(2);
    await useFileManagerStore.getState().openPreview("left");
    expect(commands.previewFile).toHaveBeenCalledWith("/p/a.txt");
    expect(useFileManagerStore.getState().preview).toMatchObject({
      name: "a.txt",
      content: { kind: "text" },
    });
  });

  // Both are ordinary things to press F3 on by accident, so neither is an
  // error — nothing should happen at all.
  it("does nothing on the .. row", async () => {
    seedFor(0);
    await useFileManagerStore.getState().openPreview("left");
    expect(commands.previewFile).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().preview).toBeNull();
  });

  it("does nothing on a folder", async () => {
    seedFor(1);
    await useFileManagerStore.getState().openPreview("left");
    expect(commands.previewFile).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().preview).toBeNull();
  });

  it("says so plainly for a pane on a host", async () => {
    seedFor(2);
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: { ...s.panes, left: { ...s.panes.left, remote: "build" } },
    });
    await useFileManagerStore.getState().openPreview("left");
    expect(commands.previewFile).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().preview?.error).toMatch(/not available/);
  });

  it("reports a failed read instead of hanging on “Reading”", async () => {
    seedFor(2);
    vi.mocked(commands.previewFile).mockRejectedValueOnce({
      kind: "permissionDenied",
      message: "nope",
    });
    await useFileManagerStore.getState().openPreview("left");
    const p = useFileManagerStore.getState().preview;
    expect(p?.error).toBeTruthy();
    expect(p?.content).toBeNull();
  });

  // A big file can still be arriving after the overlay is closed or the cursor
  // has moved on; applying it then would reopen something nobody asked for.
  it("drops a result that is no longer wanted", async () => {
    seedFor(2);
    const pending = useFileManagerStore.getState().openPreview("left");
    useFileManagerStore.getState().closePreview();
    await pending;
    expect(useFileManagerStore.getState().preview).toBeNull();
  });
});

describe("duplicating in place", () => {
  const entryAt = (name: string) => ({
    name,
    path: `/p/${name}`,
    kind: "file" as const,
    size: 1,
    itemCount: null,
    modifiedAt: null,
    createdAt: null,
    hidden: false,
  });

  const seedDup = (over = {}) => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      activePane: "left",
      dialog: null,
      panes: {
        ...s.panes,
        left: {
          ...s.panes.left,
          path: "/p",
          remote: null,
          entries: [entryAt("a.txt"), entryAt("b.txt")],
          selected: new Set<string>(),
          filter: "",
          showHidden: true,
          cursor: 1,
          error: null,
          ...over,
        },
      },
    });
  };

  // The point of the feature: the destination is the folder it is already in,
  // which requestTransfer refuses outright.
  it("copies into the same folder, asking to keep both", async () => {
    seedDup();
    await useFileManagerStore.getState().duplicateSelection("left");
    expect(commands.copyEntriesWith).toHaveBeenCalledWith(
      expect.any(String),
      ["/p/a.txt"],
      "/p",
      "keepBoth",
    );
  });

  it("duplicates the whole selection, not just the cursor row", async () => {
    seedDup({ selected: new Set(["/p/a.txt", "/p/b.txt"]) });
    await useFileManagerStore.getState().duplicateSelection("left");
    expect(commands.copyEntriesWith).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["/p/a.txt", "/p/b.txt"]),
      "/p",
      "keepBoth",
    );
  });

  // keepBoth is what makes duplicating safe: no conflict dialog, and nothing
  // can be overwritten by a command whose whole purpose is a second copy.
  it("never asks about conflicts", async () => {
    seedDup();
    await useFileManagerStore.getState().duplicateSelection("left");
    expect(commands.checkConflicts).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().dialog).toBeNull();
  });

  it("says so on an empty folder rather than doing nothing", async () => {
    seedDup({ entries: [], cursor: 0 });
    await useFileManagerStore.getState().duplicateSelection("left");
    expect(commands.copyEntriesWith).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().panes.left.error?.message).toMatch(/Nothing to/);
  });

  it("declines on a pane connected to a host", async () => {
    seedDup({ remote: "build" });
    await useFileManagerStore.getState().duplicateSelection("left");
    expect(commands.copyEntriesWith).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().panes.left.error?.message).toMatch(/not available/);
  });
});

/**
 * What survives a hot update of this module.
 *
 * Editing the store re-executes it and hands the components a fresh, empty one,
 * which is why the window used to go blank mid-session. The data is carried
 * across; the actions deliberately are not, or the edit being made would be
 * overwritten by the implementations it replaced.
 */
describe("carrying state across a hot update", () => {
  it("keeps the data", () => {
    const kept = carriedOverFields({
      activePane: "right",
      splitRatio: 0.7,
      bookmarks: [{ name: "a", path: "/a", remote: null }],
    });
    expect(kept).toEqual({
      activePane: "right",
      splitRatio: 0.7,
      bookmarks: [{ name: "a", path: "/a", remote: null }],
    });
  });

  // The whole reason for filtering. Restoring an action would put the previous
  // implementation back, so the edit that triggered the update would appear to
  // do nothing — worse than the blank window, because it looks like the code
  // is wrong rather than the reload.
  it("drops the actions so edits to them take effect", () => {
    const kept = carriedOverFields({ panes: {}, navigate: () => {}, refresh: async () => {} });
    expect(Object.keys(kept)).toEqual(["panes"]);
  });

  // Listing field names instead would silently drop any state added later by
  // someone who did not know the list existed.
  it("carries a field nobody thought to list", () => {
    const kept = carriedOverFields({ somethingAddedLater: 42 });
    expect(kept).toMatchObject({ somethingAddedLater: 42 });
  });

  // Sets and Maps are passed by reference within the same realm, so selection
  // and the remote cache survive rather than arriving as empty objects.
  it("keeps a Set intact", () => {
    const selected = new Set(["/a"]);
    const kept = carriedOverFields({ selected }) as { selected: Set<string> };
    expect(kept.selected.has("/a")).toBe(true);
  });
});
