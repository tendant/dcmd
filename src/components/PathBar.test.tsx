// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { PathBar } from "./PathBar";
import { useFileManagerStore } from "../state/fileManagerStore";

function seed(remote: string | null) {
  const s = useFileManagerStore.getState();
  useFileManagerStore.setState({
    panes: { ...s.panes, left: { ...s.panes.left, remote, path: "/srv/app" } },
  });
}

beforeEach(() => vi.clearAllMocks());

/**
 * The half of the pair that makes a bare path safely mean "this machine".
 *
 * If editing selected the whole field, the first keystroke would replace the
 * host as well as the path — and with a bare path meaning local, typing any
 * path on a remote pane would silently jump you home.
 */
describe("editing the location", () => {
  it("shows the host as part of the location", () => {
    seed("build");
    render(<PathBar path="/srv/app" paneId="left" isEditing />);
    expect(screen.getByRole("textbox")).toHaveValue("build:/srv/app");
  });

  it("selects the path and leaves the host prefix", () => {
    seed("build");
    render(<PathBar path="/srv/app" paneId="left" isEditing />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    // "build:" is 6 characters; the selection starts after it.
    expect(input.selectionStart).toBe("build:".length);
    expect(input.selectionEnd).toBe("build:/srv/app".length);
  });

  it("selects the whole thing on a local pane, which has no prefix", () => {
    seed(null);
    render(<PathBar path="/srv/app" paneId="left" isEditing />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("/srv/app");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("/srv/app".length);
  });
});
