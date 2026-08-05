// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { Pane } from "./Pane";
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

function seed(over: Record<string, unknown> = {}) {
  const s = useFileManagerStore.getState();
  useFileManagerStore.setState({
    activePane: "left",
    panes: {
      ...s.panes,
      left: {
        ...s.panes.left,
        path: "/p",
        entries: [entry("a"), entry("b")],
        selected: new Set<string>(),
        loading: false,
        filter: "",
        error: null,
        notice: null,
        renameMode: null,
        isEditingPath: false,
        ...over,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe("where a pane puts its messages", () => {
  /**
   * The whole reason the bar moved. Above the list, its appearance pushed every
   * row down — moving the cursor row out from under a keypress already on its
   * way. Below, the list loses height from the bottom and nothing you were
   * looking at moves.
   */
  it("renders the error bar after the file list, not before it", () => {
    seed({ error: { kind: "io", message: "Could not read the directory." } });
    render(<Pane paneId="left" />);

    const bar = screen.getByText("Could not read the directory.");
    // The rows are virtualised and do not render at zero height in jsdom, so
    // the column headers stand in for the top of the listing.
    const listTop = screen.getByRole("button", { name: /Name/ });
    // DOCUMENT_POSITION_FOLLOWING: the bar comes after the listing, not before.
    expect(
      listTop.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps both tiers of message at the foot, together", () => {
    seed({ error: { kind: "io", message: "Could not read the directory." } });
    const { container } = render(<Pane paneId="left" />);

    const bar = screen.getByText("Could not read the directory.");
    // The status bar is the last child of the pane; the error bar is next to it.
    const pane = container.firstElementChild!;
    const last = pane.lastElementChild!;
    expect(last.contains(bar)).toBe(false);
    expect(pane.children[pane.children.length - 2].contains(bar)).toBe(true);
  });

  it("shows a notice without rendering the bar at all", () => {
    seed({ notice: "Nothing to copy" });
    render(<Pane paneId="left" />);

    expect(screen.getByRole("status")).toHaveTextContent("Nothing to copy");
    expect(screen.queryByLabelText("Dismiss")).toBeNull();
  });
});
