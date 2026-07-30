import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri/commands", () => ({
  listDirectory: vi.fn(async () => []),
  defaultStartDir: vi.fn(async () => "/"),
  openEntry: vi.fn(async () => undefined),
  directorySize: vi.fn(async () => 0),
  cancelDirectorySize: vi.fn(async () => undefined),
  mkdir: vi.fn(),
  renameEntry: vi.fn(),
  copyEntries: vi.fn(async () => undefined),
  moveEntries: vi.fn(async () => undefined),
  trashEntries: vi.fn(async () => undefined),
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
      },
      right: { ...s.panes.right, path: "/right" },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
    await useFileManagerStore.getState().copySelection();
    expect(commands.copyEntries).toHaveBeenCalledWith(["/left/a.txt"], "/right");
  });

  it("moves the row under the cursor to the other pane", async () => {
    seedPane(3);
    await useFileManagerStore.getState().moveSelection();
    expect(commands.moveEntries).toHaveBeenCalledWith(["/left/c.txt"], "/right");
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
    expect(useFileManagerStore.getState().panes.left.error).toBe("Nothing to delete");
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
    expect(s.error).toBe("boom");
  });
});
