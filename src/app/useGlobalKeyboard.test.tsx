// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { useGlobalKeyboard } from "./useGlobalKeyboard";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { FileEntry } from "../types/fileEntry";

const entry = (name: string, over: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: `/p/${name}`,
  kind: "file",
  size: 1,
  itemCount: null,
  modifiedAt: null,
  createdAt: null,
  hidden: false,
  ...over,
});

function Harness() {
  useGlobalKeyboard();
  return null;
}

/** Reset everything the handler reads, so no test inherits another's state. */
function seed(over: Record<string, unknown> = {}, top: Record<string, unknown> = {}) {
  const s = useFileManagerStore.getState();
  useFileManagerStore.setState({
    activePane: "left",
    dialog: null,
    transfer: null,
    panes: {
      ...s.panes,
      left: {
        ...s.panes.left,
        path: "/p",
        remote: null,
        entries: [entry("a"), entry("b"), entry("c")],
        selected: new Set<string>(),
        filter: "",
        showHidden: true,
        cursor: 1,
        rangeStart: null,
        renameMode: null,
        ...over,
      },
    },
    ...top,
  });
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));

const cursor = () => useFileManagerStore.getState().panes.left.cursor;

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  render(<Harness />);
});

describe("arrow keys", () => {
  it("moves the cursor down", () => {
    press("ArrowDown");
    expect(cursor()).toBe(2);
  });

  it("moves the cursor up", () => {
    press("ArrowUp");
    expect(cursor()).toBe(0);
  });

  // Display index 0 is the ".." row and the last real row is visible.length,
  // so both ends are walls rather than wrapping or running off the list.
  it("stops at the top instead of going negative", () => {
    seed({ cursor: 0 });
    press("ArrowUp");
    expect(cursor()).toBe(0);
  });

  it("stops at the last row", () => {
    seed({ cursor: 3 });
    press("ArrowDown");
    expect(cursor()).toBe(3);
  });

  it("extends the selection with Shift", () => {
    seed({ cursor: 1 });
    press("ArrowDown", { shiftKey: true });
    expect(useFileManagerStore.getState().panes.left.selected.size).toBeGreaterThan(0);
  });

  // The menu owns every Cmd/Ctrl accelerator. If the handler acted on them too,
  // each command would run twice — so a modified arrow must do nothing here.
  it("ignores an arrow held with Cmd, which belongs to the menu", () => {
    press("ArrowDown", { metaKey: true });
    expect(cursor()).toBe(1);
  });

  it("does nothing while a dialog owns the keyboard", () => {
    seed({}, { dialog: { kind: "confirmTrash", pane: "left", paths: ["/p/a"] } });
    press("ArrowDown");
    expect(cursor()).toBe(1);
  });

  it("leaves arrows alone while typing in an input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(cursor()).toBe(1);
    input.remove();
  });
});

describe("the keys the menu must not have taken", () => {
  it("types a printable character into the filter", () => {
    press("b");
    expect(useFileManagerStore.getState().panes.left.filter).toBe("b");
  });

  it("switches panes on Tab", () => {
    press("Tab");
    expect(useFileManagerStore.getState().activePane).toBe("right");
  });

  it("edits the filter on Backspace rather than navigating away", () => {
    seed({ filter: "ab" });
    press("Backspace");
    expect(useFileManagerStore.getState().panes.left.filter).toBe("a");
  });

  it("clears the filter on Escape", () => {
    seed({ filter: "ab" });
    press("Escape");
    expect(useFileManagerStore.getState().panes.left.filter).toBe("");
  });

  it("toggles selection on Space", () => {
    press(" ");
    expect(useFileManagerStore.getState().panes.left.selected.has("/p/a")).toBe(true);
  });
});
