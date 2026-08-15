// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { FileList } from "./FileList";
import { useFileManagerStore } from "../state/fileManagerStore";
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

const entries = [entry("a.txt"), entry("b.txt"), entry("c.txt"), entry("d.txt")];

const left = () => useFileManagerStore.getState().panes.left;
const marked = () => Array.from(left().selected).sort();

const seed = (over: Partial<ReturnType<typeof left>> = {}) => {
  const s = useFileManagerStore.getState();
  useFileManagerStore.setState({
    panes: {
      ...s.panes,
      left: {
        ...s.panes.left,
        path: "/left",
        entries,
        selected: new Set<string>(),
        cursor: 1,
        rangeStart: null,
        filter: "",
        showHidden: false,
        renameMode: null,
        sort: { key: "name", ascending: true },
        ...over,
      },
    },
  });
};

/** Renders the list against whatever the store currently holds. */
const list = () => {
  const pane = left();
  return render(
    <FileList
      entries={pane.entries}
      selected={pane.selected}
      cursor={pane.cursor}
      paneId="left"
      renameMode={null}
      filter=""
    />,
  ).container.firstElementChild as HTMLElement;
};

beforeEach(() => seed());

/**
 * These exercise the list as a whole rather than a row rendered on its own,
 * which is where the display-index offset lives: row 0 is the synthetic ".."
 * and the entries begin at 1. A row tested in isolation is handed its index by
 * the test, so it can only ever agree with itself.
 */
describe("the rows the list composes", () => {
  it("renders the parent row ahead of the entries", () => {
    list();
    expect(screen.getByText("..")).toBeInTheDocument();
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(screen.getByText("d.txt")).toBeInTheDocument();
  });

  it("puts the cursor on the entry that was clicked, not the row above it", () => {
    list();
    fireEvent.click(screen.getByText("c.txt"));

    // Display index 3: "..", a, b, c.
    expect(left().cursor).toBe(3);
  });

  it("never puts a mark on the parent row", () => {
    list();
    fireEvent.click(screen.getByText(".."));

    expect(marked()).toEqual([]);
    expect(left().cursor).toBe(0);
  });
});

describe("selecting with the mouse, through the list", () => {
  it("runs a Shift+Click range between the two rows clicked", () => {
    list();
    fireEvent.click(screen.getByText("b.txt"));
    fireEvent.click(screen.getByText("d.txt"), { shiftKey: true });

    expect(marked()).toEqual(["/left/b.txt", "/left/c.txt", "/left/d.txt"]);
  });

  it("builds a scattered set with Cmd+Click", () => {
    list();
    fireEvent.click(screen.getByText("a.txt"), { ctrlKey: true });
    fireEvent.click(screen.getByText("d.txt"), { ctrlKey: true });

    expect(marked()).toEqual(["/left/a.txt", "/left/d.txt"]);
  });

  // The fix in "Let a plain click mean this row and nothing else": marks left
  // behind are what F5 would act on, while having scrolled out of sight.
  it("drops the marks on a plain click", () => {
    seed({ selected: new Set(["/left/a.txt", "/left/b.txt"]) });
    list();
    fireEvent.click(screen.getByText("d.txt"));

    expect(marked()).toEqual([]);
    expect(left().cursor).toBe(4);
  });
});

describe("clicking the empty space below the rows", () => {
  // Pointing at nothing is how you say "nothing", and with a plain click on a
  // row now narrowing to that row, this is the only way to reach an empty
  // selection with the mouse alone.
  it("drops the marks", () => {
    seed({ selected: new Set(["/left/a.txt", "/left/b.txt"]) });
    const scroller = list();
    fireEvent.click(scroller);

    expect(marked()).toEqual([]);
  });

  // The rows sit inside this element, so their clicks bubble through it. If it
  // cleared on those too, Cmd+Click could never add a second row: the toggle
  // would be undone by the same click on its way out.
  it("leaves the marks alone when the click came from a row", () => {
    seed({ selected: new Set(["/left/a.txt"]) });
    list();
    fireEvent.click(screen.getByText("b.txt"), { ctrlKey: true });

    expect(marked()).toEqual(["/left/a.txt", "/left/b.txt"]);
  });
});
