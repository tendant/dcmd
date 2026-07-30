// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { ErrorBar } from "./ErrorBar";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { AppError } from "../errors";

const err = (over: Partial<AppError> = {}): AppError => ({
  kind: "permissionDenied",
  message: "Not allowed to access “secrets.txt”.",
  hint: "Check the file's permissions.",
  detail: "Permission denied (os error 13): /a/secrets.txt",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("ErrorBar", () => {
  it("leads with the readable message and its hint", () => {
    render(<ErrorBar error={err()} paneId="left" />);
    expect(screen.getByText(/not allowed to access/i)).toBeInTheDocument();
    expect(screen.getByText(/check the file's permissions/i)).toBeInTheDocument();
  });

  it("keeps raw backend text out of sight until asked for", async () => {
    render(<ErrorBar error={err()} paneId="left" />);
    expect(screen.queryByText(/os error 13/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(screen.getByText(/os error 13/)).toBeInTheDocument();
  });

  it("offers no details toggle when there is nothing extra to show", () => {
    render(<ErrorBar error={err({ detail: undefined })} paneId="left" />);
    expect(screen.queryByRole("button", { name: /details/i })).not.toBeInTheDocument();
  });

  it("can be dismissed", async () => {
    useFileManagerStore.setState({
      panes: {
        ...useFileManagerStore.getState().panes,
        left: { ...useFileManagerStore.getState().panes.left, error: err() },
      },
    });
    render(<ErrorBar error={err()} paneId="left" />);
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(useFileManagerStore.getState().panes.left.error).toBeNull();
  });
});
