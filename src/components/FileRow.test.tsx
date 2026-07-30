// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { FileRow } from "./FileRow";
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

const PARENT: FileEntry = {
  name: "..",
  path: "",
  kind: "directory",
  size: null,
  itemCount: null,
  modifiedAt: null,
  createdAt: null,
  hidden: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  const s = useFileManagerStore.getState();
  useFileManagerStore.setState({
    contextMenu: null,
    activePane: "right",
    panes: {
      ...s.panes,
      left: {
        ...s.panes.left,
        path: "/left",
        entries: [entry("a.txt"), entry("b.txt")],
        selected: new Set(),
        cursor: 1,
        filter: "",
        showHidden: false,
        sort: { key: "name", ascending: true },
      },
    },
  });
});

const rightClick = (el: Element) => userEvent.pointer({ target: el, keys: "[MouseRight]" });

describe("right-clicking a row", () => {
  it("opens the menu for that row", async () => {
    render(
      <FileRow
        entry={entry("a.txt")}
        paneId="left"
        isSelected={false}
        isCursor={false}
        isRenaming={false}
        index={1}
      />,
    );
    await rightClick(screen.getByText("a.txt"));
    expect(useFileManagerStore.getState().contextMenu).toMatchObject({
      pane: "left",
      path: "/left/a.txt",
    });
  });

  it("focuses the pane it was clicked in", async () => {
    render(
      <FileRow
        entry={entry("a.txt")}
        paneId="left"
        isSelected={false}
        isCursor={false}
        isRenaming={false}
        index={1}
      />,
    );
    await rightClick(screen.getByText("a.txt"));
    expect(useFileManagerStore.getState().activePane).toBe("left");
  });

  it("moves the cursor onto a row outside the selection", async () => {
    render(
      <FileRow
        entry={entry("b.txt")}
        paneId="left"
        isSelected={false}
        isCursor={false}
        isRenaming={false}
        index={2}
      />,
    );
    await rightClick(screen.getByText("b.txt"));
    expect(useFileManagerStore.getState().panes.left.cursor).toBe(2);
  });

  it("leaves an existing selection alone when clicking inside it", async () => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: {
        ...s.panes,
        left: { ...s.panes.left, selected: new Set(["/left/a.txt", "/left/b.txt"]) },
      },
    });
    render(
      <FileRow
        entry={entry("a.txt")}
        paneId="left"
        isSelected
        isCursor={false}
        isRenaming={false}
        index={1}
      />,
    );
    await rightClick(screen.getByText("a.txt"));
    expect(useFileManagerStore.getState().panes.left.selected.size).toBe(2);
  });
});

describe("right-clicking the '..' row", () => {
  // Regression: this used to preventDefault and stopPropagation then return,
  // producing no menu *and* blocking the pane's empty-space handler. In a
  // directory with no blank space below the rows that left no way at all to
  // reach the folder actions from the list.
  it("opens the folder menu rather than nothing", async () => {
    render(
      <FileRow
        entry={PARENT}
        paneId="left"
        isSelected={false}
        isCursor={false}
        isRenaming={false}
        index={0}
        isParentDirectory
      />,
    );
    await rightClick(screen.getByText(".."));
    const menu = useFileManagerStore.getState().contextMenu;
    expect(menu).not.toBeNull();
    expect(menu?.path).toBeNull();
  });
});
