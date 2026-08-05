// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { StatusBar } from "./StatusBar";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { FileEntry } from "../types/fileEntry";

const entry = (name: string, over: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: `/p/${name}`,
  kind: "file",
  size: 1024,
  itemCount: null,
  modifiedAt: null,
  createdAt: null,
  hidden: false,
  ...over,
});

function seed(
  entries: FileEntry[],
  selected: string[] = [],
  over = {},
  pane: "left" | "right" = "left",
) {
  const s = useFileManagerStore.getState();
  useFileManagerStore.setState({
    activePane: "left",
    panes: {
      ...s.panes,
      [pane]: {
        ...s.panes[pane],
        path: "/p",
        remote: null,
        entries,
        selected: new Set(selected),
        filter: "",
        showHidden: true,
        ...over,
      },
    },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("StatusBar", () => {
  it("counts what the pane is showing", () => {
    seed([entry("a"), entry("b")]);
    render(<StatusBar paneId="left" />);
    expect(screen.getByText(/2 items/)).toBeInTheDocument();
  });

  it("uses the singular for one item", () => {
    seed([entry("a")]);
    render(<StatusBar paneId="left" />);
    expect(screen.getByText(/1 item(?!s)/)).toBeInTheDocument();
  });

  it("says how many a filter is holding back", () => {
    seed([entry("apple"), entry("banana")], [], { filter: "app" });
    render(<StatusBar paneId="left" />);
    expect(screen.getByText(/1 hidden/)).toBeInTheDocument();
  });

  it("reports the selection and its size", () => {
    seed([entry("a"), entry("b")], ["/p/a", "/p/b"]);
    render(<StatusBar paneId="left" />);
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
    expect(screen.getByText(/2 KB/)).toBeInTheDocument();
  });

  // A folder has no size, so summing it as zero would read as an error.
  it("does not claim a size it does not have", () => {
    seed([entry("d", { kind: "directory", size: null })], ["/p/d"]);
    render(<StatusBar paneId="left" />);
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
    expect(screen.queryByText(/0 B/)).not.toBeInTheDocument();
  });

  it("marks a mixed selection as partly unmeasured", () => {
    seed(
      [entry("f"), entry("d", { kind: "directory", size: null })],
      ["/p/f", "/p/d"],
    );
    render(<StatusBar paneId="left" />);
    expect(screen.getByText(/\+ folders/)).toBeInTheDocument();
  });

  it("says nothing about a selection when there is none", () => {
    seed([entry("a")]);
    render(<StatusBar paneId="left" />);
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("names the host on a remote pane", () => {
    // The path is already in the pane's own path bar directly above, so only
    // the host is worth repeating here.
    seed([entry("a")], [], { remote: "build", path: "/srv" });
    render(<StatusBar paneId="left" />);
    expect(screen.getByText("build")).toBeInTheDocument();
  });

  // The reason this is per-pane at all: comparing two directories should not
  // require switching focus back and forth to read each count.
  it("reports each pane independently of which one is active", () => {
    seed([entry("a"), entry("b")], ["/p/a"], {}, "left");
    seed([entry("c")], [], {}, "right");

    const { unmount } = render(<StatusBar paneId="right" />);
    expect(screen.getByText(/1 item(?!s)/)).toBeInTheDocument();
    // The inactive pane still shows its own count, not the active pane's.
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    unmount();

    render(<StatusBar paneId="left" />);
    expect(screen.getByText(/2 items · 1 selected/)).toBeInTheDocument();
  });
});

describe("a notice", () => {
  it("takes the counts' place rather than adding a row", () => {
    // Adding a row would shift the list, which is the thing the tier exists to
    // avoid — the banner already did that.
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: { ...s.panes, left: { ...s.panes.left, notice: "Nothing to copy" } },
    });
    render(<StatusBar paneId="left" />);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing to copy");
    expect(screen.queryByText(/items?$/)).toBeNull();
  });
});
