// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { CommandPalette } from "./CommandPalette";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { FileEntry } from "../types/fileEntry";

const entry = (name: string, kind: "file" | "directory" = "file"): FileEntry => ({
  name,
  path: `/p/${name}`,
  kind,
  size: 1,
  itemCount: null,
  modifiedAt: null,
  createdAt: null,
  hidden: false,
});

/**
 * Cursor 0 is the synthetic "..", so a real row is index 1.
 *
 * Resets what these tests change rather than spreading whatever the last one
 * left behind — a command run in one test is otherwise still visible in the
 * next, which makes "did nothing" impossible to assert.
 */
function paneWithEntries(over: Record<string, unknown> = {}) {
  const { panes } = useFileManagerStore.getState();
  useFileManagerStore.setState({
    panes: {
      ...panes,
      left: {
        ...panes.left,
        path: "/p",
        entries: [entry("a.txt")],
        cursor: 1,
        renameMode: null,
        filter: "",
        selected: new Set<string>(),
        history: [],
        historyIndex: -1,
        ...over,
      },
    },
    activePane: "left",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useFileManagerStore.setState({ palette: null, transfer: null });
  paneWithEntries();
});

const open = () => useFileManagerStore.getState().openPalette();

describe("the command palette", () => {
  it("renders nothing until it is opened", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists every command when opened with no query", () => {
    open();
    render(<CommandPalette />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(30);
  });

  it("narrows as you type, and shows the shortcut alongside", async () => {
    const user = userEvent.setup();
    open();
    render(<CommandPalette />);
    await user.type(screen.getByRole("combobox"), "nf");

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("New folder");
    // The point of the row: it teaches the key, so the palette stops being needed.
    expect(options[0]).toHaveTextContent("F7");
  });

  it("says so plainly when nothing matches", async () => {
    const user = userEvent.setup();
    open();
    render(<CommandPalette />);
    await user.type(screen.getByRole("combobox"), "zzzz");
    expect(screen.getByText("No matching command")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("runs the highlighted command on Enter and closes", async () => {
    const user = userEvent.setup();
    open();
    render(<CommandPalette />);
    await user.type(screen.getByRole("combobox"), "new folder{Enter}");

    // new_folder puts the pane into create mode, which is observable state
    // rather than a mock — the command ran through the real MENU_ACTIONS path.
    expect(useFileManagerStore.getState().panes.left.renameMode).toEqual({ type: "creating" });
    expect(useFileManagerStore.getState().palette).toBeNull();
  });

  it("moves the highlight with the arrow keys", async () => {
    const user = userEvent.setup();
    open();
    render(<CommandPalette />);
    const input = screen.getByRole("combobox");
    await user.type(input, "sort by");

    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("wraps the highlight rather than sticking at the ends", async () => {
    const user = userEvent.setup();
    open();
    render(<CommandPalette />);
    await user.type(screen.getByRole("combobox"), "sort by");
    const count = screen.getAllByRole("option").length;

    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("option")[count - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("resets the highlight when the query changes", async () => {
    const user = userEvent.setup();
    open();
    render(<CommandPalette />);
    const input = screen.getByRole("combobox");
    await user.type(input, "sort by");
    await user.keyboard("{ArrowDown}");
    expect(useFileManagerStore.getState().palette?.index).toBe(1);

    // Otherwise Enter runs whatever happens to sit under a stale highlight.
    await user.type(input, " n");
    expect(useFileManagerStore.getState().palette?.index).toBe(0);
  });

  it("closes on Escape without running anything", async () => {
    const user = userEvent.setup();
    open();
    render(<CommandPalette />);
    await user.keyboard("{Escape}");

    expect(useFileManagerStore.getState().palette).toBeNull();
    expect(useFileManagerStore.getState().panes.left.renameMode).toBeNull();
  });

  it("shows a command that cannot run as disabled, and refuses to run it", async () => {
    const user = userEvent.setup();
    // Nothing to go back to, so Back is unavailable.
    open();
    render(<CommandPalette />);
    await user.type(screen.getByRole("combobox"), "back");

    const option = screen.getAllByRole("option")[0];
    expect(option).toHaveTextContent("Back");
    expect(option).toHaveAttribute("aria-disabled", "true");

    await user.keyboard("{Enter}");
    // Still open: a disabled row does nothing rather than closing pointlessly.
    expect(useFileManagerStore.getState().palette).not.toBeNull();
  });

  it("enables a command once its precondition holds", async () => {
    const user = userEvent.setup();
    paneWithEntries({ filter: "a" });
    open();
    render(<CommandPalette />);
    await user.type(screen.getByRole("combobox"), "clear filter");

    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-disabled", "false");
  });

  it("runs a command clicked with the mouse", async () => {
    const user = userEvent.setup();
    open();
    render(<CommandPalette />);
    await user.type(screen.getByRole("combobox"), "new folder");
    await user.click(screen.getAllByRole("option")[0]);

    expect(useFileManagerStore.getState().panes.left.renameMode).toEqual({ type: "creating" });
  });
});
