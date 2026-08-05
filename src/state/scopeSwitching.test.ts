import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { useFileManagerStore } from "./fileManagerStore";
import * as commands from "../tauri/commands";

const state = () => useFileManagerStore.getState();
const left = () => state().panes.left;

beforeEach(() => {
  vi.clearAllMocks();
  const s = state();
  useFileManagerStore.setState({
    activePane: "left",
    remotes: [{ name: "build", alias: "build", startPath: "/srv" }],
    panes: {
      ...s.panes,
      left: { ...s.panes.left, path: "/srv/app", remote: "build", isEditingPath: true },
    },
  });
});

describe("getting back to this machine", () => {
  it("goes local when the path is typed with the local: scope", async () => {
    await state().commitPathEdit("left", "local:/var/log");
    expect(left().remote).toBeNull();
    expect(left().path).toBe("/var/log");
  });

  it("goes local for a bare path, since removing the host is how you say so", async () => {
    // Safe only because Cmd+L selects the path and leaves the prefix, so a
    // typed path stays on the host and losing the prefix is deliberate. The
    // two behaviours are a pair — see the note in location.ts.
    await state().commitPathEdit("left", "/var/log");
    expect(left().remote).toBeNull();
    expect(left().path).toBe("/var/log");
  });

  it("switches hosts when another known alias is typed", async () => {
    useFileManagerStore.setState({
      remotes: [
        { name: "build", alias: "build", startPath: "/srv" },
        { name: "web", alias: "web", startPath: "/var/www" },
      ],
    });
    await state().commitPathEdit("left", "web:/var/www");
    expect(left().remote).toBe("web");
    expect(left().path).toBe("/var/www");
  });

  it("does not read an unknown prefix as a host", async () => {
    await state().commitPathEdit("left", "staging:/srv");
    expect(left().remote).toBeNull();
    expect(left().path).toBe("staging:/srv");
  });
});

describe("the disconnect command", () => {
  it("returns the pane to this machine", async () => {
    await state().disconnectPane("left");
    expect(left().remote).toBeNull();
  });

  it("keeps the same path when it exists here too", async () => {
    vi.mocked(commands.listDirectory).mockResolvedValueOnce([]);
    await state().disconnectPane("left");
    expect(left().path).toBe("/srv/app");
  });

  it("falls back to home when the path means nothing here", async () => {
    // /config on a container, /srv on a build host: usually meaningless
    // locally, and landing on an error would be a poor way to arrive.
    vi.mocked(commands.listDirectory).mockRejectedValueOnce(new Error("no such directory"));
    vi.mocked(commands.defaultStartDir).mockResolvedValueOnce("/Users/someone");
    await state().disconnectPane("left");
    expect(left().remote).toBeNull();
    expect(left().path).toBe("/Users/someone");
  });

  it("does nothing on a pane already local", async () => {
    const s = state();
    useFileManagerStore.setState({
      panes: { ...s.panes, left: { ...s.panes.left, remote: null, path: "/home" } },
    });
    await state().disconnectPane("left");
    expect(left().path).toBe("/home");
    expect(commands.defaultStartDir).not.toHaveBeenCalled();
  });
});

describe("a tilde on this machine", () => {
  it("goes home, as it already did on a host", async () => {
    // The same input worked on a server — resolve_path handles it there — and
    // failed at home, where nothing expanded it.
    useFileManagerStore.setState({ homeDir: "/Users/someone" });
    await state().commitPathEdit("left", "~");
    expect(left().remote).toBeNull();
    expect(left().path).toBe("/Users/someone");
  });

  it("keeps what follows it", async () => {
    useFileManagerStore.setState({ homeDir: "/Users/someone" });
    await state().commitPathEdit("left", "~/Documents");
    expect(left().path).toBe("/Users/someone/Documents");
  });

  it("leaves a host's tilde for the host to resolve", async () => {
    // The far side knows its own home; this machine does not, and expanding
    // here would send the wrong path across.
    useFileManagerStore.setState({ homeDir: "/Users/someone" });
    await state().commitPathEdit("left", "build:~");
    expect(left().remote).toBe("build");
    expect(left().path).toBe("~");
  });
});
