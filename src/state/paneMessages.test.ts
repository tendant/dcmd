import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { useFileManagerStore } from "./fileManagerStore";

const state = () => useFileManagerStore.getState();
const left = () => state().panes.left;

beforeEach(() => {
  vi.clearAllMocks();
  const { panes } = state();
  useFileManagerStore.setState({
    panes: { ...panes, left: { ...panes.left, error: null, notice: null } },
    activePane: "left",
  });
});

describe("the two tiers of message", () => {
  it("keeps a notice out of the error slot, so no banner appears", () => {
    state().setPaneNotice("left", "Nothing to copy");
    expect(left().notice).toBe("Nothing to copy");
    expect(left().error).toBeNull();
  });

  it("lets a real failure supersede a notice", () => {
    // Otherwise the quieter one sits under the louder one contradicting it.
    state().setPaneNotice("left", "Nothing to copy");
    state().setPaneError("left", "Could not read the directory");
    expect(left().error?.message).toBe("Could not read the directory");
    expect(left().notice).toBeNull();
  });

  it("clears both on dismiss, and says whether there was anything", () => {
    expect(state().dismissPaneMessages("left")).toBe(false);

    state().setPaneNotice("left", "Nothing to copy");
    expect(state().dismissPaneMessages("left")).toBe(true);
    expect(left().notice).toBeNull();

    state().setPaneError("left", "boom");
    expect(state().dismissPaneMessages("left")).toBe(true);
    expect(left().error).toBeNull();
  });
});

describe("routing", () => {
  it("treats an empty transfer as a notice rather than an error", async () => {
    const { panes } = state();
    useFileManagerStore.setState({
      panes: {
        ...panes,
        left: { ...panes.left, entries: [], selected: new Set(), cursor: 0 },
      },
      activePane: "left",
    });
    await state().requestTransfer("copy");

    // Nothing went wrong and nothing was lost: it does not deserve a banner.
    expect(left().notice).toBe("Nothing to copy");
    expect(left().error).toBeNull();
  });
});
