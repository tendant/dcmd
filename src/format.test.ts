import { describe, expect, it } from "vitest";
import { formatBytes, formatTimestamp } from "./format";

// Fixed reference point so these never depend on when they run.
const NOW = new Date(2026, 6, 30, 14, 35); // 30 July 2026, 14:35 local
const at = (y: number, m: number, d: number, h = 9, min = 5) =>
  new Date(y, m, d, h, min).getTime();

describe("formatTimestamp", () => {
  it("shows only the time for today, since the date is implied", () => {
    expect(formatTimestamp(at(2026, 6, 30, 9, 5), NOW)).toBe("09:05");
  });

  it("uses 24-hour time, which is shorter than an am/pm suffix", () => {
    expect(formatTimestamp(at(2026, 6, 30, 14, 35), NOW)).toBe("14:35");
  });

  it("drops the year within the current year", () => {
    expect(formatTimestamp(at(2026, 0, 4), NOW)).toBe("01-04");
  });

  it("includes a two-digit year beyond it", () => {
    expect(formatTimestamp(at(2025, 11, 25), NOW)).toBe("25-12-25");
  });

  it("stays within eight characters", () => {
    const samples = [
      at(2026, 6, 30, 0, 0),
      at(2026, 0, 1),
      at(2025, 11, 31),
      at(1999, 5, 15),
    ];
    for (const s of samples) {
      expect(formatTimestamp(s, NOW).length).toBeLessThanOrEqual(8);
    }
  });

  it("renders nothing rather than a placeholder when there is no timestamp", () => {
    expect(formatTimestamp(null, NOW)).toBe("");
  });

  it("survives a nonsense value", () => {
    expect(formatTimestamp(Number.NaN, NOW)).toBe("");
  });

  it("does not treat the same day of a different year as today", () => {
    // Guards against comparing month and day without the year.
    expect(formatTimestamp(at(2025, 6, 30, 9, 5), NOW)).toBe("25-07-30");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024 * 9.4, "9.4 MB"],
  ])("formats %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("drops the decimal once the number is wide enough without it", () => {
    expect(formatBytes(1024 * 1024 * 24.3)).toBe("24 MB");
  });

  it("does not run out of units on very large files", () => {
    expect(formatBytes(1024 ** 5)).toContain("TB");
  });

  it("stays within eight characters", () => {
    for (const b of [0, 999, 1024, 1024 ** 2 * 1.5, 1024 ** 4 * 999]) {
      expect(formatBytes(b).length).toBeLessThanOrEqual(8);
    }
  });
});
