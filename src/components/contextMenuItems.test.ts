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
      },
      right: { ...s.panes.right, path: "/right" },
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
    const sub = items.find((i) => i.kind === "submenu") as any;
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
