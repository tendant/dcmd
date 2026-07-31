// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { PlacesBar } from "./PlacesBar";
import { useFileManagerStore } from "../state/fileManagerStore";

const navigate = vi.fn();
const connectPane = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  const s = useFileManagerStore.getState();
  useFileManagerStore.setState({
    showPlaces: true,
    activePane: "left",
    bookmarks: [{ name: "Code", path: "/c" }],
    remotes: [{ name: "Build", alias: "build", startPath: "/ci" }],
    navigate,
    connectPane,
    panes: {
      left: { ...s.panes.left, remote: null },
      right: { ...s.panes.right, remote: null },
    },
  } as any);
});

describe("PlacesBar", () => {
  it("shows bookmarks and hosts together", () => {
    render(<PlacesBar />);
    expect(screen.getByRole("button", { name: /Code/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Build/ })).toBeInTheDocument();
  });

  it("opens a bookmark in the active pane", async () => {
    render(<PlacesBar />);
    await userEvent.click(screen.getByRole("button", { name: /Code/ }));
    expect(connectPane).toHaveBeenCalledWith("left", null, "/c");
  });

  it("connects a host in the active pane", async () => {
    render(<PlacesBar />);
    await userEvent.click(screen.getByRole("button", { name: /Build/ }));
    expect(connectPane).toHaveBeenCalledWith("left", "build");
  });

  // Lining up a source and a destination is most of the point of two panes.
  it("alt-click sends the place to the other pane", () => {
    render(<PlacesBar />);
    fireEvent.click(screen.getByRole("button", { name: /Code/ }), { altKey: true });
    expect(connectPane).toHaveBeenCalledWith("right", null, "/c");
  });

  // The reported bug: with a pane connected to a server, a bookmark for a
  // folder on this machine was looked up on the server instead.
  it("returns to this machine when the pane is on a host", async () => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: { ...s.panes, left: { ...s.panes.left, remote: "build" } },
    });
    render(<PlacesBar />);
    await userEvent.click(screen.getByRole("button", { name: /Code/ }));
    // null is the whole point: it clears the pane's host before listing.
    expect(connectPane).toHaveBeenCalledWith("left", null, "/c");
  });

  it("opens a bookmark taken on a host back on that host", async () => {
    useFileManagerStore.setState({
      bookmarks: [{ name: "Src", path: "/srv/src", remote: "build" }],
    });
    render(<PlacesBar />);
    await userEvent.click(screen.getByRole("button", { name: /Src/ }));
    expect(connectPane).toHaveBeenCalledWith("left", "build", "/srv/src");
  });

  it("marks a host a pane is already on", () => {
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: { ...s.panes, right: { ...s.panes.right, remote: "build" } },
    });
    render(<PlacesBar />);
    expect(screen.getByRole("button", { name: /Build/ }).className).toMatch(/violet/);
  });

  it("stays out of the way when hidden", () => {
    useFileManagerStore.setState({ showPlaces: false });
    const { container } = render(<PlacesBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stays out of the way when there is nothing to show", () => {
    useFileManagerStore.setState({ bookmarks: [], remotes: [] });
    const { container } = render(<PlacesBar />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("opening a place by number", () => {
  it("counts bookmarks first, then hosts", () => {
    const store = useFileManagerStore.getState();
    store.openPlace(0, "left");
    expect(connectPane).toHaveBeenCalledWith("left", null, "/c");
    store.openPlace(1, "left");
    expect(connectPane).toHaveBeenCalledWith("left", "build");
  });

  it("ignores a number past the end", () => {
    useFileManagerStore.getState().openPlace(8, "left");
    expect(navigate).not.toHaveBeenCalled();
    expect(connectPane).not.toHaveBeenCalled();
  });
});

describe("right-clicking a chip", () => {
  const openContextMenu = vi.fn();
  beforeEach(() => useFileManagerStore.setState({ openContextMenu } as any));

  it("opens a menu for a bookmark", () => {
    render(<PlacesBar />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Code/ }));
    expect(openContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ place: { kind: "bookmark", id: "/c" } }),
    );
  });

  it("opens a menu for a host", () => {
    render(<PlacesBar />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Build/ }));
    expect(openContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ place: { kind: "remote", id: "build" } }),
    );
  });

  // Otherwise the webview's own menu appears on top of ours.
  it("suppresses the browser menu", () => {
    render(<PlacesBar />);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    screen.getByRole("button", { name: /Code/ }).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("does not navigate on a right-click", () => {
    render(<PlacesBar />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Code/ }));
    expect(navigate).not.toHaveBeenCalled();
  });
});
