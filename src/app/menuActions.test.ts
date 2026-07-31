import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { MENU_ACTIONS, MENU_IDS } from "./menuActions";
import { useFileManagerStore } from "../state/fileManagerStore";

// The same file the Rust menu is checked against, read rather than copied: a
// hand-kept duplicate cannot catch a rename on the other side, which is the
// whole failure this is meant to prevent.
import canonical from "../../src-tauri/menu_ids.txt?raw";

const RUST_MENU_IDS = canonical
  .split("\n")
  .map((l: string) => l.trim())
  .filter((l: string) => l && !l.startsWith("#"));

beforeEach(() => {
  vi.clearAllMocks();
  useFileManagerStore.setState({ dialog: null, showPlaces: true, collapsed: null });
});

describe("the menu contract", () => {
  it("handles every id the menu can emit", () => {
    const unhandled = RUST_MENU_IDS.filter((id) => !MENU_ACTIONS[id]);
    expect(unhandled).toEqual([]);
  });

  it("has no handler for an id the menu never sends", () => {
    const orphaned = MENU_IDS.filter((id) => !RUST_MENU_IDS.includes(id));
    expect(orphaned).toEqual([]);
  });

  it("survives an id it does not know", () => {
    expect(() => MENU_ACTIONS["nonsense"]?.(useFileManagerStore.getState())).not.toThrow();
  });
});

describe("menu items reach the same actions as the keyboard", () => {
  it.each([
    ["toggle_places", () => useFileManagerStore.getState().showPlaces],
    ["toggle_collapse", () => useFileManagerStore.getState().collapsed !== null],
  ])("%s changes state", (id, read) => {
    const before = read();
    MENU_ACTIONS[id](useFileManagerStore.getState());
    expect(read()).not.toBe(before);
  });

  it.each(["name", "size", "modified", "created", "kind"])("sorts by %s", (key) => {
    MENU_ACTIONS[`sort_${key}`](useFileManagerStore.getState());
    const pane = useFileManagerStore.getState().activePane;
    expect(useFileManagerStore.getState().panes[pane].sort.key).toBe(key);
  });

  it("copies through the same request path as F5", () => {
    const spy = vi.fn();
    useFileManagerStore.setState({ requestTransfer: spy } as any);
    MENU_ACTIONS["copy"](useFileManagerStore.getState());
    expect(spy).toHaveBeenCalledWith("copy");
  });

  it("deletes by opening the confirmation, never directly", () => {
    const spy = vi.fn();
    useFileManagerStore.setState({ requestTrash: spy } as any);
    MENU_ACTIONS["trash"](useFileManagerStore.getState());
    expect(spy).toHaveBeenCalled();
  });

  it("resets the split", () => {
    useFileManagerStore.getState().setSplitRatio(0.8);
    MENU_ACTIONS["split_even"](useFileManagerStore.getState());
    expect(useFileManagerStore.getState().splitRatio).toBe(0.5);
  });
});

describe("commands that must not be menu accelerators", () => {
  // Their meaning depends on state, so a fixed accelerator cannot express them
  // and they stay in the keyboard handler. A menu item claiming one of these
  // would double-fire against the handler, or worse, do the wrong one.
  it.each(["escape", "backspace", "space", "tab", "enter", "filter"])(
    "%s has no menu handler",
    (id) => {
      expect(MENU_ACTIONS[id]).toBeUndefined();
    },
  );
});
