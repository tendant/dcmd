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
};
