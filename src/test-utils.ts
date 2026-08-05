import { vi } from "vitest";

/**
 * Everything the store reaches for, stubbed. Component tests drive the real
 * store, so the Tauri boundary is the only thing that needs replacing.
 */
export const commandMocks = {
  listDirectory: vi.fn(async () => []),
  defaultStartDir: vi.fn(async () => "/"),
  openEntry: vi.fn(async () => undefined),
  directorySize: vi.fn(async () => 0),
  cancelDirectorySize: vi.fn(async () => undefined),
  mkdir: vi.fn(),
  renameEntry: vi.fn(),
  trashEntries: vi.fn(async () => undefined),
  checkConflicts: vi.fn(async () => [] as string[]),
  copyEntriesWith: vi.fn(async () => ({ completed: [], skipped: [], failed: [] })),
  moveEntriesWith: vi.fn(async () => ({ completed: [], skipped: [], failed: [] })),
  cancelTransfer: vi.fn(async () => undefined),
  openLog: vi.fn(async () => undefined),
  previewFile: vi.fn(async () => ({ kind: "text", content: "", truncated: false })),
  logMessage: vi.fn(async () => undefined),
  rsyncTransfer: vi.fn(async () => ({ changes: [], cancelled: false, errors: [] })),
  markStartup: vi.fn(async () => undefined),
  saveSettings: vi.fn(async () => undefined),
  listRemoteDirectory: vi.fn(async (_a: string, path: string) => ({ path, entries: [] })),
  sshConfigHosts: vi.fn(async () => ["alpha", "beta"]),
  revealEntry: vi.fn(async () => undefined),
  openTerminal: vi.fn(async () => undefined),
  cancelRemoteConnect: vi.fn(async () => undefined),
  disconnectRemote: vi.fn(async () => undefined),
  startupInfo: vi.fn(async () => ({ startDir: "/", settings: { version: 1, splitRatio: 0.5, showPlaces: true, left: { sortKey: "name", sortAscending: true, showHidden: false, columns: { size: 64, modified: 64 } }, right: { sortKey: "name", sortAscending: true, showHidden: false, columns: { size: 64, modified: 64 } }, bookmarks: [], remotes: [] } })),
};
