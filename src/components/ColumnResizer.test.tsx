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

beforeEach(() => {
  useFileManagerStore.setState({
    columnWidths: { size: DEFAULT_COLUMN_WIDTH, modified: DEFAULT_COLUMN_WIDTH },
  });
});

describe("ColumnResizer", () => {
  it("reports the current width to assistive technology", () => {
    useFileManagerStore.setState({ columnWidths: { size: 100, modified: 64 } });
    render(<ColumnResizer column="size" />);
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "100");
  });

  it("widens with the left arrow and narrows with the right", async () => {
    render(<ColumnResizer column="size" />);
    const handle = screen.getByRole("separator");
    handle.focus();
    // The handle sits on the column's leading edge, so left grows it.
    await userEvent.keyboard("{ArrowLeft}");
    expect(useFileManagerStore.getState().columnWidths.size).toBe(DEFAULT_COLUMN_WIDTH + 8);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(useFileManagerStore.getState().columnWidths.size).toBe(DEFAULT_COLUMN_WIDTH - 8);
  });

  it("resets both columns on double-click", async () => {
    useFileManagerStore.setState({ columnWidths: { size: 200, modified: 150 } });
    render(<ColumnResizer column="size" />);
    await userEvent.dblClick(screen.getByRole("separator"));
    expect(useFileManagerStore.getState().columnWidths).toEqual({
      size: DEFAULT_COLUMN_WIDTH,
      modified: DEFAULT_COLUMN_WIDTH,
    });
  });

  it("only touches the column it belongs to", async () => {
    render(<ColumnResizer column="modified" />);
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{ArrowLeft}");
    const w = useFileManagerStore.getState().columnWidths;
    expect(w.modified).toBe(DEFAULT_COLUMN_WIDTH + 8);
    expect(w.size).toBe(DEFAULT_COLUMN_WIDTH);
  });

  it("is reachable by keyboard", () => {
    render(<ColumnResizer column="size" />);
    expect(screen.getByRole("separator")).toHaveAttribute("tabindex", "0");
  });
});

describe("width limits", () => {
  it("cannot be shrunk to nothing", () => {
    useFileManagerStore.getState().setColumnWidth("size", -50);
    expect(useFileManagerStore.getState().columnWidths.size).toBe(MIN_COLUMN_WIDTH);
  });

  // Otherwise a column could be dragged wide enough to squeeze out the name,
  // which is the thing people actually read.
  it("cannot be grown without limit", () => {
    useFileManagerStore.getState().setColumnWidth("modified", 9999);
    expect(useFileManagerStore.getState().columnWidths.modified).toBe(MAX_COLUMN_WIDTH);
  });

  it("rounds to whole pixels", () => {
    useFileManagerStore.getState().setColumnWidth("size", 87.6);
    expect(useFileManagerStore.getState().columnWidths.size).toBe(88);
  });
});

describe("visibility", () => {
  // Regression: the handle was bg-transparent until hover and 4px wide, so
  // there was nothing to see and almost nothing to aim at.
  it("draws a visible rule rather than relying on hover", () => {
    const { container } = render(<ColumnResizer column="size" />);
    const rule = container.querySelector("span[aria-hidden]") as HTMLElement;
    expect(rule).toBeTruthy();
    expect(rule.className).toMatch(/bg-gray-300/);
    expect(rule.className).not.toMatch(/bg-transparent/);
  });

  it("gives the pointer more to aim at than the rule itself", () => {
    const { container } = render(<ColumnResizer column="size" />);
    const handle = container.firstChild as HTMLElement;
    const rule = container.querySelector("span[aria-hidden]") as HTMLElement;
    // Grab area is several pixels wide; the rule inside it is hairline.
    expect(handle.className).toMatch(/w-2/);
    expect(rule.className).toMatch(/w-px/);
  });

  it("shows it is being dragged", async () => {
    const { container } = render(<ColumnResizer column="size" />);
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
