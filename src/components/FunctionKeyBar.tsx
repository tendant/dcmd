import { MOD, SHIFT, DEL, isMac } from "../platform";
import { MENU_ACTIONS } from "../app/menuActions";
import { useFileManagerStore } from "../state/fileManagerStore";

/**
 * The function keys, along the foot of the window.
 *
 * Only the six that are actually bound, in their dual-pane order. A bar that
 * listed F1 or F10 because the convention has them there would be advertising
 * keys that do nothing, which is worse than not showing them.
 *
 * Each cell runs the same store action the key does — they are taken from
 * `MENU_ACTIONS`, so a command still has one implementation however it is
 * reached. That also makes the bar usable with the mouse, which matters on
 * macOS: F5-F8 are system media keys unless Fn is held or "Use F1, F2, etc.
 * keys as standard function keys" is on, so for a stock Mac the F-key printed
 * here is the one thing that will not work. The Cmd equivalent is in each
 * cell's tooltip for that reason.
 */
const KEYS: { key: string; label: string; action: string; also?: string }[] = [
  { key: "F2", label: "Rename", action: "rename", also: `${MOD}${SHIFT}R` },
  { key: "F3", label: "View", action: "preview" },
  { key: "F5", label: "Copy", action: "copy", also: `${MOD}${SHIFT}C` },
  { key: "F6", label: "Move", action: "move", also: `${MOD}${SHIFT}M` },
  { key: "F7", label: "New Folder", action: "new_folder", also: `${MOD}${SHIFT}N` },
  { key: "F8", label: "Delete", action: "trash", also: `${MOD}${DEL}` },
];

export function FunctionKeyBar() {
  return (
    <div className="flex shrink-0 gap-px border-t border-gray-300 bg-gray-300 text-[11px] dark:border-gray-700 dark:bg-gray-700">
      {KEYS.map(({ key, label, action, also }) => (
        <button
          key={key}
          type="button"
          // Not in the tab order, and focus never leaves what you were doing:
          // a focused button would swallow the Space and Enter the file list
          // needs, and this app's Tab means "other pane".
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => MENU_ACTIONS[action](useFileManagerStore.getState())}
          title={
            also
              ? `${label} (${key} or ${also}${isMac ? " — F-keys need Fn held" : ""})`
              : `${label} (${key})`
          }
          className="flex min-w-0 flex-1 items-baseline justify-center gap-1 bg-gray-200 px-1 py-1 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700"
        >
          <span className="shrink-0 font-mono text-gray-500 dark:text-gray-500">
            {key}
          </span>
          <span className="truncate text-gray-800 dark:text-gray-200">{label}</span>
        </button>
      ))}
    </div>
  );
}
