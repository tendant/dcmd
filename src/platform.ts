/**
 * Which modifier this platform actually uses, so shortcut hints match the keys
 * that work. Showing "Ctrl+L" on a Mac sends people looking for the wrong key.
 */
export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Display symbol for the primary modifier. */
export const MOD = isMac ? "⌘" : "Ctrl+";

/** Display symbol for shift. */
export const SHIFT = isMac ? "⇧" : "Shift+";

/** Backspace/Delete, which differ in name between platforms. */
export const DEL = isMac ? "⌫" : "Backspace";
