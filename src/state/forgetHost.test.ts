import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { useFileManagerStore } from "./fileManagerStore";
import * as commands from "../tauri/commands";

const state = () => useFileManagerStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  const s = state();
  useFileManagerStore.setState({
    activePane: "left",
    remotes: [
      { name: "build", alias: "build", startPath: "/srv" },
      { name: "web", alias: "web", startPath: "/var/www" },
    ],
    remoteCache: {
      "build:/srv": { entries: [], fetchedAt: 1 },
      "build:/srv/app": { entries: [], fetchedAt: 2 },
      "web:/var/www": { entries: [], fetchedAt: 3 },
    },
    panes: {
      ...s.panes,
      left: { ...s.panes.left, remote: "build", path: "/srv" },
      right: { ...s.panes.right, remote: "web", path: "/var/www" },
    },
  });
});

describe("forgetting a host", () => {
  it("takes it out of the list", () => {
    state().removeRemote("build");
    expect(state().remotes.map((r) => r.alias)).toEqual(["web"]);
  });

  it("brings a pane sitting on it back to this machine", async () => {
    // The bug: the pane kept its alias and carried on listing over SFTP to a
    // host the app had been told to forget — and could no longer be reached by
    // name to leave, since the alias the path bar needs is the one just removed.
    state().removeRemote("build");
    await vi.waitFor(() => expect(state().panes.left.remote).toBeNull());
  });

  it("leaves a pane on a different host alone", async () => {
    state().removeRemote("build");
    await vi.waitFor(() => expect(state().panes.left.remote).toBeNull());
    expect(state().panes.right.remote).toBe("web");
  });

  it("drops its cached listings and keeps everyone else's", () => {
    state().removeRemote("build");
    expect(Object.keys(state().remoteCache)).toEqual(["web:/var/www"]);
  });

  it("closes the connection, so it does not outlive the configuration", () => {
    state().removeRemote("build");
    expect(commands.disconnectRemote).toHaveBeenCalledWith("build");
  });

  it("does not disturb the panes when the host was not in use", () => {
    const s = state();
    useFileManagerStore.setState({
      panes: {
        ...s.panes,
        left: { ...s.panes.left, remote: null, path: "/home" },
        right: { ...s.panes.right, remote: null, path: "/home" },
      },
    });
    state().removeRemote("build");
    expect(state().panes.left.path).toBe("/home");
    expect(state().panes.right.path).toBe("/home");
  });
});
