import { describe, expect, it } from "vitest";
import { formatLocation, parseLocation } from "./location";

const known = ["build", "web"];

describe("parseLocation", () => {
  it("reads a known alias as a host", () => {
    expect(parseLocation("build:/srv/app", known)).toEqual({
      scope: "remote",
      alias: "build",
      path: "/srv/app",
    });
  });

  it("reads local: as this machine", () => {
    expect(parseLocation("local:/var/log", known)).toEqual({
      scope: "local",
      path: "/var/log",
    });
  });

  it("treats a bare path as this machine", () => {
    // What is in the field is the whole location, so removing the host from it
    // is how you say "not that host". Safe only because editing the field
    // leaves the prefix alone — see the note in location.ts.
    expect(parseLocation("/var/log", known)).toEqual({
      scope: "local",
      path: "/var/log",
    });
  });

  it("does not invent a host from an unknown prefix", () => {
    expect(parseLocation("staging:/srv", known)).toEqual({
      scope: "local",
      path: "staging:/srv",
    });
  });

  it("leaves a Windows drive letter alone", () => {
    // A pane called "C" is not a thing, and treating it as one would make every
    // Windows path unusable.
    expect(parseLocation("C:\\Users\\lei", known)).toEqual({
      scope: "local",
      path: "C:\\Users\\lei",
    });
  });

  it("leaves a path that merely contains a colon alone", () => {
    expect(parseLocation("./notes:draft", known)).toEqual({
      scope: "local",
      path: "./notes:draft",
    });
  });

  it("ignores a leading colon rather than reading an empty alias", () => {
    expect(parseLocation(":/srv", known)).toEqual({ scope: "local", path: ":/srv" });
  });

  it("takes local: with nothing after it as the root", () => {
    expect(parseLocation("local:", known)).toEqual({ scope: "local", path: "/" });
  });

  it("trims what was typed", () => {
    expect(parseLocation("  build:/srv  ", known)).toEqual({
      scope: "remote",
      alias: "build",
      path: "/srv",
    });
  });

  it("allows a host path to be relative, which sftp resolves", () => {
    expect(parseLocation("build:~/logs", known)).toEqual({
      scope: "remote",
      alias: "build",
      path: "~/logs",
    });
  });
});

describe("formatLocation", () => {
  it("prefixes a host path with its alias", () => {
    expect(formatLocation("build", "/srv")).toBe("build:/srv");
  });

  it("leaves a local path bare, since that is the ordinary case", () => {
    expect(formatLocation(null, "/var/log")).toBe("/var/log");
  });
});
