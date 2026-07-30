// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);
import { DualPaneLayout } from "./DualPaneLayout";
import { useFileManagerStore } from "../state/fileManagerStore";

beforeEach(() => {
  useFileManagerStore.setState({ splitRatio: 0.5, collapsed: null, activePane: "left" });
});

describe("DualPaneLayout", () => {
  it("shows a divider between two panes", () => {
    render(<DualPaneLayout />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  // Removed from the tree, not merely zero-width: a hidden pane must not be
  // focusable or reachable by Tab.
  it("removes the divider when a pane is collapsed", () => {
    useFileManagerStore.setState({ collapsed: "right" });
    render(<DualPaneLayout />);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("gives the remaining pane the full width", () => {
    useFileManagerStore.setState({ collapsed: "right", splitRatio: 0.2 });
    const { container } = render(<DualPaneLayout />);
    const panes = container.querySelectorAll(".min-w-0");
    expect(panes).toHaveLength(1);
    expect((panes[0] as HTMLElement).style.width).toBe("");
  });
});
