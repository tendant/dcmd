// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { MENU_ACTIONS } from "./menuActions";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { FileEntry } from "../types/fileEntry";

const entry = (name: string): FileEntry => ({
  name,
  path: `/p/${name}`,
  kind: "file",
  size: 1,
  itemCount: null,
  modifiedAt: null,
  createdAt: null,
  hidden: false,
});

const writeText = vi.fn(async () => undefined);
const state = () => useFileManagerStore.getState();
const left = () => state().panes.left;
const run = () => MENU_ACTIONS.copy_path(state());

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  const s = state();
  useFileManagerStore.setState({
    activePane: "left",
    panes: {
      ...s.panes,
      // Cursor 1: row 0 is the synthetic ".." entry.
      left: { ...s.panes.left, entries: [entry("a"), entry("b")], cursor: 1, error: null, notice: null },
    },
  });
});

describe("copying a path", () => {
  it("copies the row under the cursor", async () => {
    run();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("/p/a"));
  });

  it("says it happened", async () => {
    // There was no confirmation at all, which is what made a write that never
    // happened indistinguishable from one that did.
    run();
    await vi.waitFor(() => expect(left().notice).toBe("Copied /p/a"));
  });

  it("says so on the parent row, rather than doing nothing", async () => {
    const s = state();
    useFileManagerStore.setState({
      panes: { ...s.panes, left: { ...s.panes.left, cursor: 0 } },
    });
    run();
    expect(writeText).not.toHaveBeenCalled();
    expect(left().notice).toBe("No row to copy the path of");
  });

  it("reports a clipboard failure instead of swallowing it", async () => {
    // The rejection used to be caught and discarded, so a clipboard that
    // refused the write left no trace anywhere.
    writeText.mockRejectedValueOnce(new Error("denied"));
    run();
    await vi.waitFor(() =>
      expect(left().error?.message).toBe("Could not copy the path to the clipboard."),
    );
    expect(left().error?.detail).toContain("denied");
  });
});
