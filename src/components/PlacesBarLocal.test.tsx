// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { PlacesBar } from "./PlacesBar";
import { useFileManagerStore } from "../state/fileManagerStore";

const state = () => useFileManagerStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  const s = state();
  useFileManagerStore.setState({
    showPlaces: true,
    bookmarks: [],
    remotes: [{ name: "build", alias: "build", startPath: "/srv" }],
    activePane: "left",
    panes: {
      ...s.panes,
      left: { ...s.panes.left, remote: "build", path: "/srv" },
      right: { ...s.panes.right, remote: null, path: "/home" },
    },
  });
});

describe("coming back to this machine", () => {
  /**
   * The bar could send a pane to any host and had no entry for coming back, so
   * returning meant having saved a local bookmark first — and with none saved,
   * no route at all.
   */
  it("offers this machine even with no bookmarks saved", () => {
    render(<PlacesBar />);
    expect(screen.getByRole("button", { name: /This Mac/ })).toBeInTheDocument();
  });

  it("brings the active pane back when clicked", async () => {
    const user = userEvent.setup();
    render(<PlacesBar />);
    await user.click(screen.getByRole("button", { name: /This Mac/ }));
    await vi.waitFor(() => expect(state().panes.left.remote).toBeNull());
  });

  it("sends it to the other pane on Alt-click, like every other chip", async () => {
    const user = userEvent.setup();
    const s = state();
    useFileManagerStore.setState({
      panes: { ...s.panes, right: { ...s.panes.right, remote: "build", path: "/srv" } },
    });
    render(<PlacesBar />);
    await user.keyboard("{Alt>}");
    await user.click(screen.getByRole("button", { name: /This Mac/ }));
    await user.keyboard("{/Alt}");
    await vi.waitFor(() => expect(state().panes.right.remote).toBeNull());
  });

  it("marks itself when the active pane is already here", () => {
    const s = state();
    useFileManagerStore.setState({
      panes: { ...s.panes, left: { ...s.panes.left, remote: null } },
    });
    render(<PlacesBar />);
    expect(screen.getByRole("button", { name: /This Mac/ })).toHaveAttribute("aria-current", "true");
  });

  it("does not mark itself while the active pane is on a host", () => {
    render(<PlacesBar />);
    expect(screen.getByRole("button", { name: /This Mac/ })).not.toHaveAttribute("aria-current");
  });
});
