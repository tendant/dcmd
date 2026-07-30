import { describe, expect, it } from "vitest";
import { buildDisplayRows } from "./FileList";
import type { FileEntry } from "../types/fileEntry";

const file = (name: string): FileEntry => ({
  name,
  path: `/d/${name}`,
  kind: "file",
  size: 1,
  itemCount: null,
  modifiedAt: null,
  hidden: false,
});

describe("buildDisplayRows", () => {
  it("keeps the '..' row in an empty directory so there is a way back", () => {
    const { rows } = buildDisplayRows([], false);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("..");
  });

  it("puts '..' first when there are entries", () => {
    const { rows, newFolderIndex } = buildDisplayRows([file("a"), file("b")], false);
    expect(rows.map((r) => r.name)).toEqual(["..", "a", "b"]);
    expect(newFolderIndex).toBe(-1);
  });

  describe("while creating a folder", () => {
    // Regression: the input index used to be the last *existing* entry, which
    // replaced that row and prefilled the input with its name.
    it("adds a trailing row instead of consuming the last entry", () => {
      const { rows, newFolderIndex } = buildDisplayRows([file("a"), file("b")], true);
      expect(rows.map((r) => r.name)).toEqual(["..", "a", "b", ""]);
      expect(newFolderIndex).toBe(3);
    });

    // Regression: in an empty directory length-1 was 0, i.e. the ".." row, which
    // the isParent guard rejected, so no input rendered at all.
    it("never targets the '..' row in an empty directory", () => {
      const { rows, newFolderIndex } = buildDisplayRows([], true);
      expect(newFolderIndex).toBe(1);
      expect(newFolderIndex).not.toBe(0);
      expect(rows[newFolderIndex].name).toBe("");
    });

    it("places the input past every real entry", () => {
      const entries = [file("a"), file("b"), file("c")];
      const { rows, newFolderIndex } = buildDisplayRows(entries, true);
      expect(newFolderIndex).toBe(rows.length - 1);
      for (const e of entries) {
        expect(rows.some((r) => r.name === e.name)).toBe(true);
      }
    });
  });
});
