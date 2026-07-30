import { describe, expect, it } from "vitest";
import { DEL, MOD, SHIFT, isMac } from "./platform";

describe("modifier hints", () => {
  // The toolbar and tooltips read from these; if they disagree with what the
  // keyboard handler accepts, the app documents keys that do nothing.
  it("resolves to symbols for the running platform", () => {
    expect(typeof MOD).toBe("string");
    expect(MOD.length).toBeGreaterThan(0);
    expect(isMac ? MOD : "Ctrl+").toBe(MOD);
  });

  it("uses macOS glyphs when on macOS", () => {
    if (!isMac) return;
    expect(MOD).toBe("⌘");
    expect(SHIFT).toBe("⇧");
    expect(DEL).toBe("⌫");
  });
});
