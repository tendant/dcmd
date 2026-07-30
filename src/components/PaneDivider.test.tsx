// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { PaneDivider } from "./PaneDivider";
import { useFileManagerStore } from "../state/fileManagerStore";

function renderDivider() {
  const ref = createRef<HTMLElement>();
  const result = render(<PaneDivider containerRef={ref} />);
  return { ...result, ref };
}

beforeEach(() => {
  useFileManagerStore.setState({ splitRatio: 0.5, collapsed: null });
});

describe("PaneDivider", () => {
  it("reports its position to assistive technology", () => {
    useFileManagerStore.setState({ splitRatio: 0.7 });
    renderDivider();
    const sep = screen.getByRole("separator");
    expect(sep).toHaveAttribute("aria-valuenow", "70");
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
  });

  it("evens the split on double-click", async () => {
    useFileManagerStore.setState({ splitRatio: 0.8 });
    renderDivider();
    await userEvent.dblClick(screen.getByRole("separator"));
    expect(useFileManagerStore.getState().splitRatio).toBe(0.5);
  });

  it("resizes with the arrow keys once focused", async () => {
    renderDivider();
    const sep = screen.getByRole("separator");
    sep.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(useFileManagerStore.getState().splitRatio).toBeCloseTo(0.55);
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(useFileManagerStore.getState().splitRatio).toBeCloseTo(0.45);
  });

  it("is reachable by keyboard at all", () => {
    renderDivider();
    expect(screen.getByRole("separator")).toHaveAttribute("tabindex", "0");
  });

  it("does not resize on arrow keys while unfocused", async () => {
    renderDivider();
    await userEvent.keyboard("{ArrowRight}");
    expect(useFileManagerStore.getState().splitRatio).toBe(0.5);
  });
});
