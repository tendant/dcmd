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

/**
 * The visible end of the arrow keys. Every other test here renders with
 * isCursor={false}, so the highlight itself — the only thing that tells you
 * where the cursor is — was drawn by code no test had ever exercised.
 */
describe("the cursor highlight", () => {
  const row = (over: { isCursor: boolean; isSelected?: boolean }) =>
    render(
      <FileRow
        entry={entry("a.txt")}
        paneId="left"
        isSelected={over.isSelected ?? false}
        isCursor={over.isCursor}
        isRenaming={false}
        index={1}
      />,
    ).container.firstElementChild as HTMLElement;

  it("marks the row under the cursor", () => {
    expect(row({ isCursor: true }).className).toContain("border-l-blue-600");
  });

  it("leaves other rows unmarked", () => {
    expect(row({ isCursor: false }).className).not.toContain("border-l-blue-600");
  });

  // A row can be both. The cursor has to stay visible on it, or moving through
  // a selection would look like the cursor had vanished.
  it("stays visible on a row that is also selected", () => {
    expect(row({ isCursor: true, isSelected: true }).className).toContain("border-l-blue-600");
  });

  it("styles a selected row differently from the cursor row", () => {
    const selected = row({ isCursor: false, isSelected: true }).className;
    expect(selected).toContain("bg-blue-100");
    expect(selected).not.toContain("border-l-blue-600");
  });
});

describe("dragging a row out to another app", () => {
  const row = (over: Partial<Record<string, unknown>> = {}, paneOver = {}) => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: { ...s.panes, left: { ...s.panes.left, remote: null, ...paneOver } },
    });
    return render(
      <FileRow
        entry={entry("a.txt")}
        paneId="left"
        isSelected={false}
        isCursor={false}
        isRenaming={false}
        index={1}
        {...over}
      />,
    ).container.firstElementChild as HTMLElement;
  };

  it("marks an ordinary row draggable", () => {
    expect(row().getAttribute("draggable")).toBe("true");
  });

  // ".." is not a file, so there is nothing to hand over.
  it("does not offer to drag the parent row", () => {
    expect(row({ isParentDirectory: true }).getAttribute("draggable")).toBe("false");
  });

  // A remote pane holds paths on the other machine; another app here would be
  // given a path that does not exist.
  it("does not offer to drag from a pane on a host", () => {
    expect(row({}, { remote: "build" }).getAttribute("draggable")).toBe("false");
  });

  // The webview's own drag cannot carry a file past the window. Letting it
  // proceed would show a drag that silently does nothing when dropped.
  it("cancels the webview drag so a native one can replace it", () => {
    const el = row();
    const ev = new Event("dragstart", { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
