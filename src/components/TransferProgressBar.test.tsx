// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { TransferProgressBar } from "./TransferProgressBar";
import { useFileManagerStore } from "../state/fileManagerStore";

const cancelTransfer = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useFileManagerStore.setState({ transfer: null, cancelTransfer } as any);
});

describe("TransferProgressBar", () => {
  const running = () =>
    useFileManagerStore.setState({
      transfer: { id: "copy-1", op: "copy", pane: "left", current: 3, total: 10, name: "big.bin" },
    });

  it("shows nothing when no transfer is running", () => {
    const { container } = render(<TransferProgressBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the operation, the current file and the count", () => {
    running();
    render(<TransferProgressBar />);
    expect(screen.getByText(/copying/i)).toBeInTheDocument();
    expect(screen.getByText("big.bin")).toBeInTheDocument();
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
  });

  it("offers a way out of a long transfer", async () => {
    running();
    render(<TransferProgressBar />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(cancelTransfer).toHaveBeenCalled();
  });

  it("does not divide by zero before the total is known", () => {
    useFileManagerStore.setState({
      transfer: { id: "x", op: "move", pane: "left", current: 0, total: 0, name: "" },
    });
    render(<TransferProgressBar />);
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
  });
});
