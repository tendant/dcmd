// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { ContextMenu } from "./ContextMenu";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { FileEntry } from "../types/fileEntry";

const entry = (name: string, over: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: `/left/${name}`,
  kind: "file",
  size: 1,
  itemCount: null,
  modifiedAt: null,
  createdAt: null,
  hidden: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  const s = useFileManagerStore.getState();
  useFileManagerStore.setState({
    contextMenu: null,
    panes: {
      ...s.panes,
      left: {
        ...s.panes.left,
        path: "/left",
        entries: [entry("a.txt")],
        selected: new Set(),
        filter: "",
        showHidden: false,
        sort: { key: "name", ascending: true },
        dirSizes: {},
      },
    },
  });
});

const openAt = (x = 10, y = 10, path: string | null = "/left/a.txt") =>
  useFileManagerStore.setState({ contextMenu: { x, y, pane: "left", path } });

describe("ContextMenu", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ContextMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the actions for the row it was opened on", () => {
    openAt();
    render(<ContextMenu />);
    expect(screen.getByRole("menu", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("closes after running an action, so it cannot be clicked twice", async () => {
    const spy = vi.fn();
    useFileManagerStore.setState({ requestTransfer: spy } as any);
    openAt();
    render(<ContextMenu />);
    await userEvent.click(screen.getByText(/Copy “a.txt”/));
    expect(spy).toHaveBeenCalledWith("copy");
    expect(useFileManagerStore.getState().contextMenu).toBeNull();
  });

  it("closes on Escape", async () => {
    openAt();
    render(<ContextMenu />);
    await userEvent.keyboard("{Escape}");
    expect(useFileManagerStore.getState().contextMenu).toBeNull();
  });

  it("closes when clicking away", async () => {
    openAt();
    const { container } = render(<ContextMenu />);
    await userEvent.click(container.firstChild as HTMLElement);
    expect(useFileManagerStore.getState().contextMenu).toBeNull();
  });

  it("does not run a disabled action", async () => {
    const spy = vi.fn();
    useFileManagerStore.setState({ startRenaming: spy } as any);
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: {
        ...s.panes,
        left: { ...s.panes.left, selected: new Set(["/left/a.txt", "/left/b.txt"]) },
      },
    });
    openAt();
    render(<ContextMenu />);
    await userEvent.click(screen.getByText("Rename…"));
    expect(spy).not.toHaveBeenCalled();
    expect(useFileManagerStore.getState().contextMenu).not.toBeNull();
  });

  it("opens a submenu on request", async () => {
    openAt(10, 10, null);
    render(<ContextMenu />);
    expect(screen.queryByText("Date modified")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Sort by"));
    expect(screen.getByText("Date modified")).toBeInTheDocument();
  });

  // A menu opened near the edge would otherwise be partly off-screen.
  it("keeps itself inside the viewport", () => {
    openAt(99999, 99999);
    render(<ContextMenu />);
    const menu = screen.getByRole("menu", { name: "Actions" }) as HTMLElement;
    expect(parseFloat(menu.style.left)).toBeLessThan(99999);
    expect(parseFloat(menu.style.top)).toBeLessThan(99999);
  });

  it("suppresses the webview menu on top of itself", () => {
    openAt();
    const { container } = render(<ContextMenu />);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    (container.firstChild as HTMLElement).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
