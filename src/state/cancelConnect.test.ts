import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { useFileManagerStore } from "./fileManagerStore";
import * as commands from "../tauri/commands";

function setPane(over: Record<string, unknown>) {
  const { panes } = useFileManagerStore.getState();
  useFileManagerStore.setState({
    panes: { ...panes, left: { ...panes.left, remote: null, loading: false, ...over } },
    activePane: "left",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useFileManagerStore.setState({ transfer: null });
  setPane({});
});

describe("cancelling a pending remote connection", () => {
  it("cancels by alias while the pane is still waiting", () => {
    setPane({ remote: "build", loading: true });
    expect(useFileManagerStore.getState().cancelRemoteConnect("left")).toBe(true);
    expect(commands.cancelRemoteConnect).toHaveBeenCalledWith("build");
  });

  it("does nothing on a local pane", () => {
    setPane({ remote: null, loading: true });
    expect(useFileManagerStore.getState().cancelRemoteConnect("left")).toBe(false);
    expect(commands.cancelRemoteConnect).not.toHaveBeenCalled();
  });

  it("does nothing once the listing has arrived", () => {
    // Nothing is in flight, so Escape should fall through to what it otherwise
    // means rather than being swallowed here.
    setPane({ remote: "build", loading: false });
    expect(useFileManagerStore.getState().cancelRemoteConnect("left")).toBe(false);
    expect(commands.cancelRemoteConnect).not.toHaveBeenCalled();
  });

  it("reports false so Escape can move on to the transfer", () => {
    setPane({ remote: null, loading: false });
    const store = useFileManagerStore.getState();
    expect(store.cancelRemoteConnect("left")).toBe(false);
  });
});
