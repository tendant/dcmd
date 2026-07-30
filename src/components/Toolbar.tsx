import { DEL, MOD, SHIFT, isMac } from "../platform";

/**
 * The shortcut reference.
 *
 * File operations carry two bindings and both are listed. The F-keys are the
 * dual-pane convention and remain bound; the Cmd equivalents exist because macOS
 * reserves F5-F8 for system functions, so on a stock Mac the F-keys never reach
 * the app unless Fn is held or standard function keys are enabled. Listing only
 * one of the two either hides the convention or advertises keys that do nothing.
 */
const GROUPS: { label: string; keys: { keys: string[]; what: string }[] }[] = [
  {
    label: "Files",
    keys: [
      { keys: ["F5", `${MOD}${SHIFT}C`], what: "Copy" },
      { keys: ["F6", `${MOD}${SHIFT}M`], what: "Move" },
      { keys: ["F7", `${MOD}${SHIFT}N`], what: "New folder" },
      { keys: ["F2", `${MOD}${SHIFT}R`], what: "Rename" },
      { keys: ["F8", `${MOD}${DEL}`], what: "Trash" },
    ],
  },
  {
    label: "Navigate",
    keys: [
      { keys: ["Tab"], what: "Other pane" },
      { keys: ["⏎"], what: "Open" },
      { keys: [DEL], what: "Up" },
      { keys: [`${MOD}L`], what: "Edit path" },
      { keys: [`${MOD}R`], what: "Refresh" },
    ],
  },
  {
    label: "Select",
    keys: [
      { keys: ["Space"], what: "Select / size" },
      { keys: [`${SHIFT}↑↓`], what: "Range" },
      { keys: [`${MOD}1-5`], what: "Sort" },
      { keys: ["type"], what: "Filter" },
      { keys: ["Esc"], what: "Clear / cancel" },
      { keys: [isMac ? `${MOD}${SHIFT}.` : "Ctrl+H"], what: "Hidden files" },
    ],
  },
];

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-gray-400 bg-gray-100 px-1 font-mono dark:border-gray-600 dark:bg-gray-900">
      {children}
    </kbd>
  );
}

export function Toolbar() {
  return (
    <div className="border-t border-gray-300 bg-gray-200 px-3 py-1.5 text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {GROUPS.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
              {g.label}
            </span>
            {g.keys.map(({ keys, what }) => (
              <span key={what} className="whitespace-nowrap">
                {keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && <span className="mx-0.5 text-gray-400">/</span>}
                    <Key>{k}</Key>
                  </span>
                ))}{" "}
                {what}
              </span>
            ))}
          </div>
        ))}
      </div>
      {isMac && (
        <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-500">
          F-keys need Fn held, or “Use F1, F2, etc. keys as standard function
          keys” enabled in System Settings › Keyboard.
        </div>
      )}
    </div>
  );
}
