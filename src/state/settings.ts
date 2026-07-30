import type { Settings } from "../tauri/commands";
import * as commands from "../tauri/commands";
import type { FileManagerState } from "./fileManagerStore";

/** The parts of the store that outlive a session. */
export function settingsFrom(state: FileManagerState): Settings {
  return {
    version: 1,
    splitRatio: state.splitRatio,
    left: {
      sortKey: state.panes.left.sort.key,
      sortAscending: state.panes.left.sort.ascending,
      showHidden: state.panes.left.showHidden,
      columns: { ...state.panes.left.columnWidths },
    },
    right: {
      sortKey: state.panes.right.sort.key,
      sortAscending: state.panes.right.sort.ascending,
      showHidden: state.panes.right.showHidden,
      columns: { ...state.panes.right.columnWidths },
    },
  };
}

/**
 * Whether two settings differ in a way worth writing to disk. Compared by value
 * rather than tracking dirtiness, so a change that round-trips back to where it
 * started does not cause a write.
 */
export function settingsEqual(a: Settings, b: Settings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Saves at most once per interval, and only when something actually changed.
 *
 * Dragging the divider produces an update per frame; writing each one would mean
 * hundreds of file writes for one gesture.
 */
export function createSettingsSaver(intervalMs = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Settings | null = null;
  let lastSaved: Settings | null = null;

  const flush = () => {
    timer = null;
    const next = pending;
    pending = null;
    if (!next || (lastSaved && settingsEqual(next, lastSaved))) return;
    lastSaved = next;
    commands.saveSettings(next).catch((err) => {
      // Losing a preference is not worth interrupting the user for.
      console.error("Could not save settings:", err);
    });
  };

  return {
    /** Records the last-loaded state so an unchanged session writes nothing. */
    prime(settings: Settings) {
      lastSaved = settings;
    },
    schedule(settings: Settings) {
      pending = settings;
      if (timer === null) timer = setTimeout(flush, intervalMs);
    },
    flushNow() {
      if (timer !== null) clearTimeout(timer);
      flush();
    },
  };
}
