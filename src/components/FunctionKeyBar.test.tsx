// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { FunctionKeyBar } from "./FunctionKeyBar";
import { useFileManagerStore } from "../state/fileManagerStore";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the function key bar", () => {
  it("names every key that is bound, and none that is not", () => {
    render(<FunctionKeyBar />);
    for (const key of ["F2", "F3", "F5", "F6", "F7", "F8"]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
    // F1, F4, F9 and F10 do nothing in this app, so showing them would send
    // people pressing keys that are not there.
    for (const key of ["F1", "F4", "F9", "F10"]) {
      expect(screen.queryByText(key)).not.toBeInTheDocument();
    }
  });

  it("reaches the same action the key does", async () => {
    const requestTransfer = vi.fn();
    useFileManagerStore.setState({ requestTransfer } as any);

    render(<FunctionKeyBar />);
    await userEvent.click(screen.getByText("Copy"));

    expect(requestTransfer).toHaveBeenCalledWith("copy");
  });

  it("leaves focus where it was, so the list keeps Space and Enter", async () => {
    render(<FunctionKeyBar />);
    const before = document.activeElement;
    await userEvent.click(screen.getByText("Move"));
    expect(document.activeElement).toBe(before);
  });
});
