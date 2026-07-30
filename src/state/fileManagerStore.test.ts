import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri/commands", () => ({
  listDirectory: vi.fn(async () => []),
  defaultStartDir: vi.fn(async () => "/"),
  openEntry: vi.fn(async () => undefined),
  directorySize: vi.fn(async () => 0),
  cancelDirectorySize: vi.fn(async () => undefined),
  mkdir: vi.fn(),
  renameEntry: vi.fn(),
  trashEntries: vi.fn(async () => ({ completed: [], skipped: [], failed: [] })),
  checkConflicts: vi.fn(async () => []),
  copyEntriesWith: vi.fn(async () => ({ completed: [], skipped: [], failed: [] })),
  moveEntriesWith: vi.fn(async () => ({ completed: [], skipped: [], failed: [] })),
  cancelTransfer: vi.fn(async () => undefined),
}));

import * as commands from "../tauri/commands";
import { entryAtCursor, useFileManagerStore, visibleEntries } from "./fileManagerStore";
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
