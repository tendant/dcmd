// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toolbar } from "./Toolbar";
import { MOD, isMac } from "../platform";

describe("Toolbar", () => {
  // Regression: the reference once listed only F5-F8, which macOS intercepts,
  // and once listed only the Cmd bindings, hiding the dual-pane convention.
  // Both are bound, so both must be shown.
  it.each(["F5", "F6", "F7", "F8", "F2"])("still lists %s", (key) => {
    render(<Toolbar />);
    expect(screen.getByText(key)).toBeInTheDocument();
  });

  it("lists the modifier equivalents alongside them", () => {
    render(<Toolbar />);
    expect(screen.getByText(`${MOD}L`)).toBeInTheDocument();
    expect(screen.getByText(`${MOD}R`)).toBeInTheDocument();
  });

  it("mentions type-to-filter, which has no key to guess", () => {
    render(<Toolbar />);
    expect(screen.getByText("type")).toBeInTheDocument();
  });

  it("explains the F-key caveat only where it applies", () => {
    render(<Toolbar />);
    const note = screen.queryByText(/standard function keys/i);
    if (isMac) expect(note).toBeInTheDocument();
    else expect(note).not.toBeInTheDocument();
  });
});
