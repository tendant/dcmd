// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { AddRemoteDialog, filterHosts, matchesHost } from "./AddRemoteDialog";
import { useFileManagerStore } from "../state/fileManagerStore";

const HOSTS = ["prod-web-01", "prod-db-eu", "staging-web", "dev-box", "BUILD-01"];

beforeEach(() => {
  vi.clearAllMocks();
  useFileManagerStore.setState({ remotes: [], dialog: null });
});

describe("matching", () => {
  it("matches on any part of the name", () => {
    expect(matchesHost("prod-web-01", "web")).toBe(true);
    expect(matchesHost("prod-web-01", "01")).toBe(true);
  });

  it("ignores case", () => {
    expect(matchesHost("BUILD-01", "build")).toBe(true);
    expect(matchesHost("dev-box", "DEV")).toBe(true);
  });

  // Host names are structured, so the parts should not have to be given in
  // order or with the right separator remembered.
  it("takes several terms in any order", () => {
    expect(matchesHost("prod-db-eu", "db prod")).toBe(true);
    expect(matchesHost("prod-db-eu", "prod eu")).toBe(true);
  });

  it("requires every term to appear", () => {
    expect(matchesHost("prod-web-01", "prod db")).toBe(false);
  });

  it("treats an empty query as matching everything", () => {
    expect(filterHosts(HOSTS, "")).toEqual(HOSTS);
    expect(filterHosts(HOSTS, "   ")).toEqual(HOSTS);
  });

  it("narrows a long list to the few that matter", () => {
    expect(filterHosts(HOSTS, "prod")).toEqual(["prod-web-01", "prod-db-eu"]);
    expect(filterHosts(HOSTS, "web")).toEqual(["prod-web-01", "staging-web"]);
  });
});

describe("AddRemoteDialog", () => {
  const open = (hosts = HOSTS) =>
    render(<AddRemoteDialog available={hosts} onDone={() => {}} />);

  it("focuses the filter so typing works immediately", () => {
    open();
    expect(screen.getByPlaceholderText(/filter hosts/i)).toHaveFocus();
  });

  it("narrows as you type and says how many are left", async () => {
    open();
    await userEvent.type(screen.getByPlaceholderText(/filter hosts/i), "prod");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    open();
    await userEvent.type(screen.getByPlaceholderText(/filter hosts/i), "zzz");
    expect(screen.getByText(/no host matches/i)).toBeInTheDocument();
  });

  // Reaching for the mouse to pick from a filtered list defeats the point.
  it("adds the highlighted host on Enter", async () => {
    open();
    await userEvent.type(screen.getByPlaceholderText(/filter hosts/i), "db{Enter}");
    expect(useFileManagerStore.getState().remotes.map((r) => r.alias)).toEqual(["prod-db-eu"]);
  });

  it("moves the highlight with the arrow keys", async () => {
    open();
    const input = screen.getByPlaceholderText(/filter hosts/i);
    await userEvent.type(input, "prod");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(useFileManagerStore.getState().remotes.map((r) => r.alias)).toEqual(["prod-db-eu"]);
  });

  it("does not run past either end of the list", async () => {
    open();
    const input = screen.getByPlaceholderText(/filter hosts/i);
    await userEvent.type(input, "prod");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{Enter}");
    expect(useFileManagerStore.getState().remotes.map((r) => r.alias)).toEqual(["prod-web-01"]);
  });

  // A narrowing list would otherwise leave the highlight past the end, and
  // Enter would add nothing or the wrong host.
  it("resets the highlight when the query changes", async () => {
    open();
    const input = screen.getByPlaceholderText(/filter hosts/i);
    await userEvent.type(input, "prod");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.clear(input);
    await userEvent.type(input, "staging{Enter}");
    expect(useFileManagerStore.getState().remotes.map((r) => r.alias)).toEqual(["staging-web"]);
  });

  it("can still be clicked", async () => {
    open();
    await userEvent.click(screen.getByRole("option", { name: "dev-box" }));
    expect(useFileManagerStore.getState().remotes.map((r) => r.alias)).toEqual(["dev-box"]);
  });

  it("shows no filter when there is nothing to add", () => {
    open([]);
    expect(screen.queryByPlaceholderText(/filter hosts/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no new hosts/i)).toBeInTheDocument();
  });
});
