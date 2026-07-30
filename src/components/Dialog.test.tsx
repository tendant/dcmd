// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { Dialog } from "./Dialog";
import { useFileManagerStore } from "../state/fileManagerStore";

const performTransfer = vi.fn();
const trashSelection = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useFileManagerStore.setState({
    dialog: null,
    transfer: null,
    performTransfer,
    trashSelection,
  } as any);
});

describe("conflict dialog", () => {
  const open = () =>
    useFileManagerStore.setState({
      dialog: {
        kind: "conflict",
        op: "copy",
        pane: "left",
        sources: ["/l/notes.txt", "/l/img.png"],
        destination: "/r",
        names: ["notes.txt"],
      },
    });

  it("names what already exists rather than only counting", () => {
    open();
    render(<Dialog />);
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText(/1 item already exists/i)).toBeInTheDocument();
  });

  it.each([
    ["Skip these", "skip"],
    ["Replace", "overwrite"],
    ["Keep both", "keepBoth"],
  ])("%s applies the %s policy", async (label, policy) => {
    open();
    render(<Dialog />);
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(performTransfer).toHaveBeenCalledWith(
      "copy",
      "left",
      ["/l/notes.txt", "/l/img.png"],
      "/r",
      policy,
    );
  });

  it("cancelling writes nothing", async () => {
    open();
    render(<Dialog />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(performTransfer).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().dialog).toBeNull();
  });

  it("defaults focus to the non-destructive choice", () => {
    open();
    render(<Dialog />);
    expect(screen.getByRole("button", { name: "Keep both" })).toHaveFocus();
  });
});

describe("delete confirmation", () => {
  const open = (paths: string[]) =>
    useFileManagerStore.setState({ dialog: { kind: "confirmTrash", pane: "left", paths } });

  it("lists the files by name, not just a count", () => {
    open(["/l/a.txt", "/l/b.txt"]);
    render(<Dialog />);
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(screen.getByText("b.txt")).toBeInTheDocument();
  });

  it("summarises once the list gets long", () => {
    open(Array.from({ length: 12 }, (_, i) => `/l/f${i}.txt`));
    render(<Dialog />);
    expect(screen.getByText(/and 4 more/i)).toBeInTheDocument();
  });

  it("deletes nothing until confirmed", async () => {
    open(["/l/a.txt"]);
    render(<Dialog />);
    expect(trashSelection).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /move to trash/i }));
    expect(trashSelection).toHaveBeenCalledWith("left");
  });

  it("focuses Cancel, so a stray Enter does not delete", () => {
    open(["/l/a.txt"]);
    render(<Dialog />);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("says the items are recoverable", () => {
    open(["/l/a.txt"]);
    render(<Dialog />);
    expect(screen.getByText(/recoverable/i)).toBeInTheDocument();
  });
});

describe("transfer outcome", () => {
  it("explains every failure separately rather than sharing one message", () => {
    useFileManagerStore.setState({
      dialog: {
        kind: "transferOutcome",
        op: "copy",
        completed: 2,
        skipped: [],
        failed: [
          { path: "/l/a.txt", kind: "permissionDenied", message: "denied: /l/a.txt" },
          { path: "/l/b.txt", kind: "notFound", message: "path does not exist: /l/b.txt" },
        ],
      },
    });
    render(<Dialog />);

    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(screen.getByText("b.txt")).toBeInTheDocument();
    // Each maps to its own explanation, and neither shows raw backend text.
    expect(screen.getByText(/not allowed to access/i)).toBeInTheDocument();
    expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
    expect(screen.queryByText(/denied: \/l\/a\.txt/)).not.toBeInTheDocument();
  });

  it("reports skipped names too", () => {
    useFileManagerStore.setState({
      dialog: {
        kind: "transferOutcome",
        op: "move",
        completed: 1,
        skipped: ["/l/dup.txt"],
        failed: [],
      },
    });
    render(<Dialog />);
    // Both the summary line and the section heading mention skipping.
    expect(screen.getAllByText(/skipped/i).length).toBeGreaterThan(0);
    expect(screen.getByText("dup.txt")).toBeInTheDocument();
  });

  it("counts each outcome", () => {
    useFileManagerStore.setState({
      dialog: {
        kind: "transferOutcome",
        op: "copy",
        completed: 5,
        skipped: ["/l/s.txt"],
        failed: [{ path: "/l/f.txt", kind: "io", message: "boom" }],
      },
    });
    render(<Dialog />);
    const summary = screen.getByText(/succeeded/i);
    expect(summary.textContent).toMatch(/5 succeeded/);
    expect(summary.textContent).toMatch(/1 skipped/);
    expect(summary.textContent).toMatch(/1 failed/);
  });
});

describe("dismissal", () => {
  it("closes on Escape", async () => {
    useFileManagerStore.setState({
      dialog: { kind: "confirmTrash", pane: "left", paths: ["/l/a.txt"] },
    });
    render(<Dialog />);
    await userEvent.keyboard("{Escape}");
    expect(useFileManagerStore.getState().dialog).toBeNull();
  });

  it("renders nothing when there is no dialog", () => {
    const { container } = render(<Dialog />);
    expect(container).toBeEmptyDOMElement();
  });
});
