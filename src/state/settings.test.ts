import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import * as commands from "../tauri/commands";
import { createSettingsSaver, settingsEqual, settingsFrom } from "./settings";
import { useFileManagerStore } from "./fileManagerStore";
import type { Settings } from "../tauri/commands";

const base = (): Settings => ({
  version: 1,
  splitRatio: 0.5,
  left: { sortKey: "name", sortAscending: true, showHidden: false, columns: { size: 64, modified: 64 } },
  right: { sortKey: "name", sortAscending: true, showHidden: false, columns: { size: 64, modified: 64 } },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("settingsFrom", () => {
  it("captures the parts that outlive a session", () => {
    useFileManagerStore.setState({ splitRatio: 0.7 });
    const s = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: {
        ...s.panes,
        left: { ...s.panes.left, sort: { key: "size", ascending: false }, showHidden: true },
      },
    });
    const captured = settingsFrom(useFileManagerStore.getState());
    expect(captured.splitRatio).toBe(0.7);
    expect(captured.left).toMatchObject({ sortKey: "size", sortAscending: false, showHidden: true });
  });
});

describe("applySettings", () => {
  it("restores a saved layout", () => {
    useFileManagerStore.getState().applySettings({
      ...base(),
      splitRatio: 0.35,
      right: { sortKey: "modified", sortAscending: false, showHidden: true, columns: { size: 64, modified: 64 } },
    });
    const s = useFileManagerStore.getState();
    expect(s.splitRatio).toBe(0.35);
    expect(s.panes.right.sort).toEqual({ key: "modified", ascending: false });
    expect(s.panes.right.showHidden).toBe(true);
  });

  // The file is user-editable and can predate or postdate this build.
  it("falls back on a sort key this build does not know", () => {
    useFileManagerStore.getState().applySettings({
      ...base(),
      left: { sortKey: "colour", sortAscending: true, showHidden: false, columns: { size: 64, modified: 64 } },
    });
    expect(useFileManagerStore.getState().panes.left.sort.key).toBe("name");
  });
});

describe("the saver", () => {
  it("writes once for a burst of changes, not once per change", async () => {
    vi.useFakeTimers();
    const saver = createSettingsSaver(500);
    for (let i = 0; i < 50; i++) {
      saver.schedule({ ...base(), splitRatio: 0.3 + i / 1000 });
    }
    expect(commands.saveSettings).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(commands.saveSettings).toHaveBeenCalledTimes(1);
    // The last value wins, not the first.
    expect((commands.saveSettings as any).mock.calls[0][0].splitRatio).toBeCloseTo(0.349);
  });

  it("does not write when nothing actually changed", () => {
    vi.useFakeTimers();
    const saver = createSettingsSaver(500);
    saver.prime(base());
    saver.schedule(base());
    vi.advanceTimersByTime(600);
    expect(commands.saveSettings).not.toHaveBeenCalled();
  });

  it("writes a pending change immediately when asked to flush", () => {
    vi.useFakeTimers();
    const saver = createSettingsSaver(500);
    saver.schedule({ ...base(), splitRatio: 0.8 });
    saver.flushNow();
    expect(commands.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("survives a failed write without throwing", async () => {
    (commands.saveSettings as any).mockRejectedValueOnce(new Error("disk full"));
    const saver = createSettingsSaver(0);
    saver.schedule({ ...base(), splitRatio: 0.8 });
    saver.flushNow();
    await Promise.resolve();
    expect(commands.saveSettings).toHaveBeenCalled();
  });
});

describe("settingsEqual", () => {
  it("ignores a change that returns to where it started", () => {
    expect(settingsEqual(base(), base())).toBe(true);
  });

  it("notices a real difference", () => {
    expect(settingsEqual(base(), { ...base(), splitRatio: 0.6 })).toBe(false);
  });
});

describe("column widths persist per pane", () => {
  it("are captured separately for each pane", () => {
    const st = useFileManagerStore.getState();
    useFileManagerStore.setState({
      panes: {
        ...st.panes,
        left: { ...st.panes.left, columnWidths: { size: 90, modified: 120 } },
        right: { ...st.panes.right, columnWidths: { size: 45, modified: 200 } },
      },
    });
    const saved = settingsFrom(useFileManagerStore.getState());
    expect(saved.left.columns).toEqual({ size: 90, modified: 120 });
    expect(saved.right.columns).toEqual({ size: 45, modified: 200 });
  });

  it("are restored to the pane they belonged to", () => {
    useFileManagerStore.getState().applySettings({
      ...base(),
      left: { sortKey: "name", sortAscending: true, showHidden: false, columns: { size: 110, modified: 75 } },
      right: { sortKey: "name", sortAscending: true, showHidden: false, columns: { size: 55, modified: 180 } },
    });
    const s = useFileManagerStore.getState();
    expect(s.panes.left.columnWidths).toEqual({ size: 110, modified: 75 });
    expect(s.panes.right.columnWidths).toEqual({ size: 55, modified: 180 });
  });
});
