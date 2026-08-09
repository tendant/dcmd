import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { buildMenuItems, type MenuItem } from "./contextMenuItems";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { FileEntry } from "../types/fileEntry";

const entry = (name: string, over: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: `/left/${name}`,
  kind: "file",
  size: 1,
  itemCount: null,
  modifiedAt: null,
  createdAt: null,
  hidden: false,
  ...over,
});

function seed(selected: string[] = []) {
  const s = useFileManagerStore.getState();
  useFileManagerStore.setState({
    activePane: "left",
    contextMenu: null,
    panes: {
      ...s.panes,
      left: {
        ...s.panes.left,
        path: "/left",
        entries: [entry("a.txt"), entry("docs", { kind: "directory", size: null })],
        selected: new Set(selected),
        cursor: 1,
        filter: "",
        showHidden: false,
        sort: { key: "name", ascending: true },
        dirSizes: {},
        // Reset every field a test could dirty: the store is module-level, so
        // anything left set here leaks into the next test.
        remote: null,
        history: [],
        historyIndex: -1,
      },
      right: { ...s.panes.right, path: "/right", remote: null },
    },
  });
}

const labels = (items: MenuItem[]) =>
  items.flatMap((i) =>
    i.kind === "separator" ? [] : i.kind === "submenu" ? [i.label] : [i.label],
  );

const find = (items: MenuItem[], startsWith: string) =>
  items.find((i) => i.kind !== "separator" && i.label.startsWith(startsWith));

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe("menu for a row", () => {
  const menu = () =>
    buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: "/left/a.txt",
    });

  it("offers the file operations", () => {
    const l = labels(menu()).join("|");
    for (const expected of ["Open", "Copy", "Move", "Rename", "Trash"]) {
      expect(l).toContain(expected);
    }
  });

  // The menu is as much a way of learning the keyboard interface as avoiding it.
  it("shows the keyboard shortcut for each action", () => {
    for (const label of ["Copy", "Move", "Rename", "Move “a.txt” to Trash"]) {
      const item = find(menu(), label) as any;
      expect(item?.shortcut, `${label} should show a shortcut`).toBeTruthy();
    }
  });

  it("marks deleting as destructive", () => {
    const trash = find(menu(), "Move “a.txt” to Trash") as any;
    expect(trash.danger).toBe(true);
  });

  it("offers reveal and copy path", () => {
    const l = labels(menu()).join("|");
    expect(l).toContain("Reveal");
    expect(l).toContain("Copy path");
  });

  it("does not offer calculating a size for a file", () => {
    expect(labels(menu()).join("|")).not.toContain("Calculate size");
  });

  it("offers calculating a size for a folder", () => {
    const items = buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: "/left/docs",
    });
    expect(labels(items).join("|")).toContain("Calculate size");
  });

  it("says a size is already running rather than offering it again", () => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: {
        ...s.panes,
        left: { ...s.panes.left, dirSizes: { "/left/docs": "pending" } },
      },
    });
    const items = buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: "/left/docs",
    });
    const item = find(items, "Calculating") as any;
    expect(item?.disabled).toBe(true);
  });
});

describe("acting on a multi-item selection", () => {
  // A menu that says "Copy a.txt" while about to copy twelve files is lying.
  it("names the count rather than one file", () => {
    seed(["/left/a.txt", "/left/docs"]);
    const items = buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: "/left/a.txt",
    });
    expect(labels(items).join("|")).toContain("Copy 2 items to other pane");
    expect(labels(items).join("|")).toContain("Move 2 items to Trash");
  });

  it("disables rename, which can only act on one", () => {
    seed(["/left/a.txt", "/left/docs"]);
    const items = buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: "/left/a.txt",
    });
    expect((find(items, "Rename") as any).disabled).toBe(true);
  });
});

describe("menu for empty space", () => {
  const menu = () =>
    buildMenuItems(useFileManagerStore.getState(), { x: 0, y: 0, pane: "left", path: null });

  it("offers what applies to the folder rather than to a file", () => {
    const l = labels(menu()).join("|");
    expect(l).toContain("New folder");
    expect(l).toContain("Refresh");
    expect(l).toContain("Sort by");
    expect(l).toContain("Show hidden files");
  });

  it("offers nothing that needs a target", () => {
    const l = labels(menu()).join("|");
    for (const absent of ["Rename", "Trash", "Reveal", "Copy path", "Open"]) {
      expect(l, `${absent} should not appear`).not.toContain(absent);
    }
  });

  it("does not open with a leading separator", () => {
    expect(menu()[0].kind).not.toBe("separator");
  });
});

describe("toggles reflect current state", () => {
  it("ticks the active sort key", () => {
    useFileManagerStore.getState().setSort("left", "size");
    const items = buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: null,
    });
    const sub = items.find((i) => i.kind === "submenu" && i.label === "Sort by") as any;
    const checked = sub.items.filter((i: any) => i.checked).map((i: any) => i.label);
    expect(checked).toEqual(["Size"]);
  });

  it("ticks hidden files when they are shown", () => {
    useFileManagerStore.getState().toggleHidden("left");
    const items = buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: null,
    });
    expect((find(items, "Show hidden") as any).checked).toBe(true);
  });
});

describe("actions are wired to the real store", () => {
  it("copying goes through the same path as the shortcut", () => {
    const spy = vi.fn();
    useFileManagerStore.setState({ requestTransfer: spy } as any);
    const items = buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: "/left/a.txt",
    });
    (find(items, "Copy") as any).run();
    expect(spy).toHaveBeenCalledWith("copy");
  });

  it("deleting opens the confirmation rather than deleting directly", () => {
    const spy = vi.fn();
    useFileManagerStore.setState({ requestTrash: spy } as any);
    const items = buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: "/left/a.txt",
    });
    (find(items, "Move “a.txt” to Trash") as any).run();
    expect(spy).toHaveBeenCalledWith("left");
  });
});

describe("going up", () => {
  const folderMenu = () =>
    buildMenuItems(useFileManagerStore.getState(), { x: 0, y: 0, pane: "left", path: null });

  it("is offered from the folder menu", () => {
    expect(find(folderMenu(), "Go up")).toBeTruthy();
  });

  it("is disabled at the root, where there is nowhere to go", () => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: { ...s.panes, left: { ...s.panes.left, path: "/" } },
    });
    expect((find(folderMenu(), "Go up") as any).disabled).toBe(true);
  });

  it("is enabled below the root", () => {
    expect((find(folderMenu(), "Go up") as any).disabled).toBe(false);
  });
});

describe("bookmarks in the menu", () => {
  const folderMenu = () =>
    buildMenuItems(useFileManagerStore.getState(), { x: 0, y: 0, pane: "left", path: null });
  const bookmarksSub = () =>
    folderMenu().find((i) => i.kind === "submenu" && i.label === "Bookmarks") as any;

  it("offers to bookmark the current folder", () => {
    useFileManagerStore.setState({ bookmarks: [] });
    expect(bookmarksSub().items[0].label).toBe("Bookmark this folder");
  });

  it("offers to remove it once bookmarked", () => {
    useFileManagerStore.setState({ bookmarks: [{ name: "left", path: "/left" }] });
    expect(bookmarksSub().items[0].label).toBe("Remove this folder");
  });

  it("lists the saved bookmarks", () => {
    useFileManagerStore.setState({
      bookmarks: [
        { name: "Code", path: "/c" },
        { name: "Docs", path: "/d" },
      ],
    });
    const labels = bookmarksSub().items.map((i: any) => i.label);
    expect(labels).toContain("Code");
    expect(labels).toContain("Docs");
  });

  it("navigates to a bookmark", () => {
    const spy = vi.fn();
    useFileManagerStore.setState({
      bookmarks: [{ name: "Code", path: "/c" }],
      navigate: spy as any,
    });
    bookmarksSub().items.find((i: any) => i.label === "Code").run();
    expect(spy).toHaveBeenCalledWith("left", "/c");
  });
});

describe("history in the menu", () => {
  const folderMenu = () =>
    buildMenuItems(useFileManagerStore.getState(), { x: 0, y: 0, pane: "left", path: null });

  it("disables back and forward with nowhere to go", () => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: { ...s.panes, left: { ...s.panes.left, history: [], historyIndex: -1 } },
    });
    expect((find(folderMenu(), "Back") as any).disabled).toBe(true);
    expect((find(folderMenu(), "Forward") as any).disabled).toBe(true);
  });

  it("enables back once there is somewhere to return to", () => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: {
        ...s.panes,
        left: { ...s.panes.left, history: ["/a", "/b"], historyIndex: 1 },
      },
    });
    expect((find(folderMenu(), "Back") as any).disabled).toBe(false);
  });
});

describe("menus for a places-bar chip", () => {
  const menuFor = (kind: "bookmark" | "remote", id: string) =>
    buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: null,
      place: { kind, id },
    });

  beforeEach(() => {
    seed();
    useFileManagerStore.setState({
      bookmarks: [{ name: "Code", path: "/c" }],
      remotes: [{ name: "Build", alias: "build", startPath: "." }],
    });
  });

  describe("a bookmark", () => {
    it("offers to open it in either pane", () => {
      const l = labels(menuFor("bookmark", "/c"));
      expect(l).toContain("Open here");
      expect(l).toContain("Open in other pane");
    });

    it("opens in the other pane on request", () => {
      const spy = vi.fn();
      useFileManagerStore.setState({ navigate: spy as any });
      (find(menuFor("bookmark", "/c"), "Open in other") as any).run();
      expect(spy).toHaveBeenCalledWith("right", "/c", expect.anything());
    });

    it("offers removal, marked as destructive", () => {
      const item = find(menuFor("bookmark", "/c"), "Remove bookmark") as any;
      expect(item.danger).toBe(true);
      item.run();
      expect(useFileManagerStore.getState().bookmarks).toEqual([]);
    });

    // A bookmark is not a file; renaming or trashing one is meaningless.
    it("offers nothing that belongs to a file", () => {
      const l = labels(menuFor("bookmark", "/c")).join("|");
      for (const absent of ["Rename", "Trash", "Copy path", "Calculate size"]) {
        expect(l).not.toContain(absent);
      }
    });
  });

  describe("a host", () => {
    it("offers to connect either pane", () => {
      const l = labels(menuFor("remote", "build"));
      expect(l).toContain("Connect here");
      expect(l).toContain("Connect in other pane");
    });

    it("disables connecting where it is already connected", () => {
      const s = useFileManagerStore.getState();
      useFileManagerStore.setState({
        panes: { ...s.panes, left: { ...s.panes.left, remote: "build" } },
      });
      expect((find(menuFor("remote", "build"), "Connect here") as any).disabled).toBe(true);
    });

    it("offers a way back to the local machine only when connected", () => {
      expect(labels(menuFor("remote", "build")).join("|")).not.toContain("Back to this machine");
      const s = useFileManagerStore.getState();
      useFileManagerStore.setState({
        panes: { ...s.panes, left: { ...s.panes.left, remote: "build" } },
      });
      expect(labels(menuFor("remote", "build")).join("|")).toContain("Back to this machine");
    });

    it("forgets the saved host without touching anything on it", () => {
      const item = find(menuFor("remote", "build"), "Forget") as any;
      expect(item.danger).toBe(true);
      item.run();
      expect(useFileManagerStore.getState().remotes).toEqual([]);
    });
  });

  it("shows nothing for a chip that has since gone", () => {
    expect(menuFor("bookmark", "/vanished")).toEqual([]);
    expect(menuFor("remote", "vanished")).toEqual([]);
  });
});

describe("the places bar's own menu", () => {
  const barMenu = () =>
    buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: null,
      place: { kind: "bar", id: "" },
    });

  it("offers to add a host, next to where hosts are shown", () => {
    expect(barMenu().map((i) => ("label" in i ? i.label : "—"))).toContain("Add host…");
  });

  it("offers to bookmark the folder the pane is on", () => {
    expect(barMenu().map((i) => ("label" in i ? i.label : "—"))).toContain(
      "Bookmark this folder",
    );
  });

  // Nothing about a chip, because no chip was clicked.
  it("says nothing about removing or connecting", () => {
    const labels = barMenu().map((i) => ("label" in i ? i.label : "—"));
    expect(labels).not.toContain("Remove bookmark");
    expect(labels).not.toContain("Connect here");
  });
});

describe("opening a bookmark from its chip menu", () => {
  const connectPane = vi.fn();

  beforeEach(() => {
    useFileManagerStore.setState({
      connectPane,
      bookmarks: [
        { name: "docs", path: "/home/me/docs", remote: null },
        { name: "src", path: "/srv/src", remote: "build" },
      ],
    } as any);
  });

  // The third place this bug lived: the chip, the number shortcut, and here.
  it("returns to this machine for a local bookmark", () => {
    const items = buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: null,
      place: { kind: "bookmark", id: "/home/me/docs" },
    });
    const open = items.find((i) => "label" in i && i.label === "Open here");
    (open as { run: () => void }).run();
    expect(connectPane).toHaveBeenCalledWith("left", null, "/home/me/docs");
  });

  it("goes back to the host a remote bookmark was taken on", () => {
    const items = buildMenuItems(useFileManagerStore.getState(), {
      x: 0,
      y: 0,
      pane: "left",
      path: null,
      place: { kind: "bookmark", id: "/srv/src" },
    });
    const open = items.find((i) => "label" in i && i.label === "Open in other pane");
    (open as { run: () => void }).run();
    expect(connectPane).toHaveBeenCalledWith("right", "build", "/srv/src");
  });
});
