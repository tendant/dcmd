import { describe, expect, it } from "vitest";
import { COMMANDS, COMMAND_IDS, matchCommands, scoreLabel, type Command } from "./commands";
import { MENU_IDS } from "./menuActions";

describe("the command registry", () => {
  /**
   * The same discipline `menu_ids.txt` applies across the language boundary,
   * applied across the two tables on this side. Without it a command added to
   * the menu is dispatchable and invisible, or one removed from it lingers in
   * the palette and does nothing.
   */
  it("describes exactly the commands the menu can dispatch", () => {
    expect([...COMMAND_IDS].sort()).toEqual([...MENU_IDS].sort());
  });

  it("has no duplicate ids", () => {
    expect(new Set(COMMAND_IDS).size).toBe(COMMAND_IDS.length);
  });

  it("gives every command a non-empty label", () => {
    for (const c of COMMANDS) expect(c.label.trim()).not.toBe("");
  });
});

describe("scoreLabel", () => {
  it("matches letters in order rather than as a substring", () => {
    expect(scoreLabel("New folder", "nf")).not.toBeNull();
    expect(scoreLabel("New folder", "newf")).not.toBeNull();
  });

  it("rejects letters that are not in order", () => {
    expect(scoreLabel("New folder", "fn")).toBeNull();
    expect(scoreLabel("New folder", "xyz")).toBeNull();
  });

  it("is case insensitive", () => {
    expect(scoreLabel("New folder", "NF")).not.toBeNull();
  });

  it("reports where it matched, so the caller can highlight it", () => {
    expect(scoreLabel("New folder", "nf")?.positions).toEqual([0, 4]);
  });

  it("treats an empty query as matching everything, unranked", () => {
    expect(scoreLabel("Anything", "")).toEqual({ positions: [], score: 0 });
  });
});

describe("matchCommands", () => {
  const find = (query: string) => matchCommands(query).map((m) => m.command.id);

  it("returns every command for an empty query, in registry order", () => {
    expect(matchCommands("")).toHaveLength(COMMANDS.length);
    expect(matchCommands("")[0]?.command.id).toBe(COMMANDS[0]?.id);
  });

  it("puts a prefix match first", () => {
    expect(find("rename")[0]).toBe("rename");
    expect(find("preview")[0]).toBe("preview");
  });

  it("finds a command by the initials of its words", () => {
    expect(find("nf")[0]).toBe("new_folder");
    expect(find("dup")[0]).toBe("duplicate");
  });

  it("offers both when a prefix is genuinely ambiguous", () => {
    // "Copy path" and "Copy to other pane" both begin with it. The shorter one
    // leads, per the tie-break, and the other is the next row rather than
    // buried — which is the whole reason this is a list and not a guess.
    expect(find("cop").slice(0, 2)).toEqual(["copy_path", "copy"]);
  });

  it("finds a command by a word in the middle of its label", () => {
    expect(find("term")[0]).toBe("open_terminal");
  });

  it("prefers the shorter of two labels that match equally well", () => {
    // "Refresh" and "Reveal in file browser" both begin "Re".
    expect(find("ref")[0]).toBe("refresh");
  });

  it("returns nothing when no command matches", () => {
    expect(find("zzzzz")).toEqual([]);
  });

  it("ranks deterministically for equal scores", () => {
    const commands: Command[] = [
      { id: "b", label: "Same", group: "View" },
      { id: "a", label: "Same", group: "View" },
    ];
    // Registry order decides, not the engine's sort stability.
    expect(matchCommands("same", commands).map((m) => m.command.id)).toEqual(["b", "a"]);
  });
});
