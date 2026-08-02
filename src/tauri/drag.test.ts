// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// The factory is hoisted above the file, so the mock cannot close over a
// variable declared here — it has to be reached through the mocked module.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  Channel: class {},
}));

import { invoke } from "@tauri-apps/api/core";
import { dragImage, dragLabel, pathsForDrag, startNativeDrag } from "./drag";

const invoked = vi.mocked(invoke);

describe("what a drag carries", () => {
  // Dragging a row inside the selection takes all of it; dragging one outside
  // takes only that row, so files the pointer never touched are not handed over.
  it("takes the whole selection when the dragged row is in it", () => {
    const selected = new Set(["/a", "/b"]);
    expect(pathsForDrag(selected, "/a").sort()).toEqual(["/a", "/b"]);
  });

  it("takes only the dragged row when it is outside the selection", () => {
    const selected = new Set(["/a", "/b"]);
    expect(pathsForDrag(selected, "/c")).toEqual(["/c"]);
  });

  it("takes the row when nothing is selected", () => {
    expect(pathsForDrag(new Set(), "/c")).toEqual(["/c"]);
  });
});

describe("the drag label", () => {
  it("names a single file", () => {
    expect(dragLabel(["/a/b/report.pdf"])).toBe("report.pdf");
  });

  it("counts several", () => {
    expect(dragLabel(["/a", "/b", "/c"])).toBe("3 items");
  });
});

describe("the drag image", () => {
  // The plugin rejects anything that is not a PNG data URL, so this is a
  // contract with the Rust side rather than a detail of appearance.
  it("is always a png data url, even with no canvas to draw on", () => {
    expect(dragImage("x")).toMatch(/^data:image\/png;base64,/);
  });
});

describe("starting the drag", () => {
  it("asks the plugin for the given paths", async () => {
    invoked.mockClear();
    await startNativeDrag(["/a/one.txt"]);

    expect(invoked).toHaveBeenCalledWith(
      "plugin:drag|start_drag",
      expect.objectContaining({
        // DragItem is untagged in the plugin: a bare array is the Files variant.
        item: ["/a/one.txt"],
        image: expect.stringMatching(/^data:image\/png;base64,/),
      }),
    );
  });

  // Starting a native drag with nothing in it would leave the pointer holding
  // an empty session that never resolves.
  it("does nothing when there is nothing to drag", async () => {
    invoked.mockClear();
    await startNativeDrag([]);
    expect(invoked).not.toHaveBeenCalled();
  });
});
