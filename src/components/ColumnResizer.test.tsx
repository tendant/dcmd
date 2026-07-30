// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { COLUMN_HANDLE_CLASS, ColumnResizer } from "./ColumnResizer";
import { ColumnHeaders } from "./ColumnHeaders";
import { FileRow } from "./FileRow";
import {
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  useFileManagerStore,
} from "../state/fileManagerStore";

const widths = () => useFileManagerStore.getState().panes.left.columnWidths;
const setWidths = (w: { size: number; modified: number }) => {
  const st = useFileManagerStore.getState();
  useFileManagerStore.setState({
    panes: { ...st.panes, left: { ...st.panes.left, columnWidths: w } },
  });
};

beforeEach(() => {
  const st = useFileManagerStore.getState();
  useFileManagerStore.setState({
    panes: {
      ...st.panes,
      left: {
        ...st.panes.left,
        columnWidths: { size: DEFAULT_COLUMN_WIDTH, modified: DEFAULT_COLUMN_WIDTH },
      },
      right: {
        ...st.panes.right,
        columnWidths: { size: DEFAULT_COLUMN_WIDTH, modified: DEFAULT_COLUMN_WIDTH },
      },
    },
  });
});

describe("ColumnResizer", () => {
  it("reports the current width to assistive technology", () => {
    setWidths({ size: 100, modified: 64 });
    render(<ColumnResizer column="size" paneId="left" />);
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "100");
  });

  it("widens with the left arrow and narrows with the right", async () => {
    render(<ColumnResizer column="size" paneId="left" />);
    const handle = screen.getByRole("separator");
    handle.focus();
    // The handle sits on the column's leading edge, so left grows it.
    await userEvent.keyboard("{ArrowLeft}");
    expect(widths().size).toBe(DEFAULT_COLUMN_WIDTH + 8);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(widths().size).toBe(DEFAULT_COLUMN_WIDTH - 8);
  });

  it("resets both columns on double-click", async () => {
    setWidths({ size: 200, modified: 150 });
    render(<ColumnResizer column="size" paneId="left" />);
    await userEvent.dblClick(screen.getByRole("separator"));
    expect(widths()).toEqual({
      size: DEFAULT_COLUMN_WIDTH,
      modified: DEFAULT_COLUMN_WIDTH,
    });
  });

  it("only touches the column it belongs to", async () => {
    render(<ColumnResizer column="modified" paneId="left" />);
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{ArrowLeft}");
    const w = widths();
    expect(w.modified).toBe(DEFAULT_COLUMN_WIDTH + 8);
    expect(w.size).toBe(DEFAULT_COLUMN_WIDTH);
  });

  it("is reachable by keyboard", () => {
    render(<ColumnResizer column="size" paneId="left" />);
    expect(screen.getByRole("separator")).toHaveAttribute("tabindex", "0");
  });
});

describe("width limits", () => {
  it("cannot be shrunk to nothing", () => {
    useFileManagerStore.getState().setColumnWidth("left", "size", -50);
    expect(widths().size).toBe(MIN_COLUMN_WIDTH);
  });

  // Otherwise a column could be dragged wide enough to squeeze out the name,
  // which is the thing people actually read.
  it("cannot be grown without limit", () => {
    useFileManagerStore.getState().setColumnWidth("left", "modified", 9999);
    expect(widths().modified).toBe(MAX_COLUMN_WIDTH);
  });

  it("rounds to whole pixels", () => {
    useFileManagerStore.getState().setColumnWidth("left", "size", 87.6);
    expect(widths().size).toBe(88);
  });
});

describe("visibility", () => {
  // Regression: the handle was bg-transparent until hover and 4px wide, so
  // there was nothing to see and almost nothing to aim at.
  it("draws a visible rule rather than relying on hover", () => {
    const { container } = render(<ColumnResizer column="size" paneId="left" />);
    const rule = container.querySelector("span[aria-hidden]") as HTMLElement;
    expect(rule).toBeTruthy();
    expect(rule.className).toMatch(/bg-gray-300/);
    expect(rule.className).not.toMatch(/bg-transparent/);
  });

  it("gives the pointer more to aim at than the rule itself", () => {
    const { container } = render(<ColumnResizer column="size" paneId="left" />);
    const handle = container.firstChild as HTMLElement;
    const rule = container.querySelector("span[aria-hidden]") as HTMLElement;
    // Grab area is several pixels wide; the rule inside it is hairline.
    expect(handle.className).toMatch(/w-2/);
    expect(rule.className).toMatch(/w-px/);
  });

  it("shows it is being dragged", async () => {
    const { container } = render(<ColumnResizer column="size" paneId="left" />);
    const handle = container.firstChild as HTMLElement;
    (handle as any).setPointerCapture = () => {};
    await userEvent.pointer({ target: handle, keys: "[MouseLeft>]" });
    const rule = container.querySelector("span[aria-hidden]") as HTMLElement;
    expect(rule.className).toMatch(/bg-blue-500/);
  });
});

describe("header and rows stay aligned", () => {
  // Both are flex children of lists that must line up. Rendering both and
  // comparing is the only way to catch a drift; asserting on the shared
  // constant would only prove the constant exists.
  it("puts the same-width element in the same slot in both", () => {
    const header = render(<ColumnHeaders paneId="left" />);
    const headerHandles = header.container.querySelectorAll('[role="separator"]');

    const row = render(
      <FileRow
        entry={{
          name: "a.txt",
          path: "/left/a.txt",
          kind: "file",
          size: 1,
          itemCount: null,
          modifiedAt: null,
          createdAt: null,
          hidden: false,
        }}
        paneId="left"
        isSelected={false}
        isCursor={false}
        isRenaming={false}
        index={1}
      />,
    );
    const rowSpacers = row.container.querySelectorAll(
      `span.${COLUMN_HANDLE_CLASS.split(" ").join(".")}`,
    );

    expect(headerHandles).toHaveLength(2);
    expect(rowSpacers).toHaveLength(2);
    for (const h of headerHandles) {
      for (const cls of COLUMN_HANDLE_CLASS.split(" ")) {
        expect(h.className).toContain(cls);
      }
    }
  });
});

describe("the panes size independently", () => {
  // The panes can be very different widths once the split is dragged, so a
  // narrow one needs narrower columns than a wide one.
  it("resizing one pane leaves the other alone", () => {
    const store = useFileManagerStore.getState();
    store.setColumnWidth("left", "size", 150);
    const s = useFileManagerStore.getState();
    expect(s.panes.left.columnWidths.size).toBe(150);
    expect(s.panes.right.columnWidths.size).toBe(DEFAULT_COLUMN_WIDTH);
  });

  it("resetting one pane leaves the other alone", () => {
    const store = useFileManagerStore.getState();
    store.setColumnWidth("left", "size", 150);
    store.setColumnWidth("right", "size", 200);
    useFileManagerStore.getState().resetColumnWidths("left");
    const s = useFileManagerStore.getState();
    expect(s.panes.left.columnWidths.size).toBe(DEFAULT_COLUMN_WIDTH);
    expect(s.panes.right.columnWidths.size).toBe(200);
  });

  it("a handle only drives the pane it was rendered for", async () => {
    render(<ColumnResizer column="size" paneId="right" />);
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{ArrowLeft}");
    const s = useFileManagerStore.getState();
    expect(s.panes.right.columnWidths.size).toBe(DEFAULT_COLUMN_WIDTH + 8);
    expect(s.panes.left.columnWidths.size).toBe(DEFAULT_COLUMN_WIDTH);
  });
});
