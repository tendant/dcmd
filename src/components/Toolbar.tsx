import { DEL, MOD, SHIFT } from "../platform";

/**
 * The shortcut reference. It has to list the bindings that actually work on this
 * platform: macOS reserves F5-F8 for system functions, so advertising them alone
 * sent people pressing keys the app never receives.
 */
const GROUPS: { label: string; keys: [string, string][] }[] = [
  {
    label: "Files",
    keys: [
      [`${MOD}${SHIFT}C`, "Copy"],
      [`${MOD}${SHIFT}M`, "Move"],
      [`${MOD}${SHIFT}N`, "New folder"],
      [`${MOD}${SHIFT}R`, "Rename"],
      [`${MOD}${DEL}`, "Trash"],
    ],
  },
  {
    label: "Navigate",
    keys: [
      ["Tab", "Other pane"],
      ["⏎", "Open"],
      [DEL, "Up"],
      [`${MOD}L`, "Edit path"],
      [`${MOD}R`, "Refresh"],
    ],
  },
  {
    label: "Select",
    keys: [
      ["Space", "Select / size"],
      [`${SHIFT}↑↓`, "Range"],
      ["type", "Filter"],
      ["Esc", "Clear / cancel"],
    ],
  },
];

export function Toolbar() {
  return (
    <div className="border-t border-gray-300 bg-gray-200 px-3 py-1.5 text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {GROUPS.map((g) => (
          <div key={g.label} className="flex items-center gap-x-3">
            <span className="font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
              {g.label}
            </span>
            {g.keys.map(([key, what]) => (
              <span key={key} className="whitespace-nowrap">
                <kbd className="rounded border border-gray-400 bg-gray-100 px-1 font-mono dark:border-gray-600 dark:bg-gray-900">
                  {key}
                </kbd>{" "}
                {what}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
