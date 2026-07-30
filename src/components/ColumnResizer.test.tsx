// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { ColumnResizer } from "./ColumnResizer";
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
