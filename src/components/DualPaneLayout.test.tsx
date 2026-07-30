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
    expect(screen.getByRole("separator", { name: "Resize panes" })).toBeInTheDocument();
  });

  // Removed from the tree, not merely zero-width: a hidden pane must not be
  // focusable or reachable by Tab.
  it("removes the divider when a pane is collapsed", () => {
    useFileManagerStore.setState({ collapsed: "right" });
    render(<DualPaneLayout />);
    expect(screen.queryByRole("separator", { name: "Resize panes" })).not.toBeInTheDocument();
  });

  it("gives the remaining pane the full width", () => {
    useFileManagerStore.setState({ collapsed: "right", splitRatio: 0.2 });
    const { container } = render(<DualPaneLayout />);
    const panes = container.querySelectorAll("[data-pane]");
    expect(panes).toHaveLength(1);
    expect(panes[0].getAttribute("data-pane")).toBe("left");
    // No inline width, so it fills what is left rather than keeping its ratio.
    expect((panes[0] as HTMLElement).style.width).toBe("");
  });

  it("sizes the left pane by the ratio while both are shown", () => {
    useFileManagerStore.setState({ collapsed: null, splitRatio: 0.3 });
    const { container } = render(<DualPaneLayout />);
    const left = container.querySelector('[data-pane="left"]') as HTMLElement;
    expect(left.style.width).toBe("30%");
  });
});
