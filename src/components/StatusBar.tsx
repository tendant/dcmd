import { useFileManagerStore, visibleEntries, type PaneId } from "../state/fileManagerStore";
import { formatBytes } from "../format";

/**
 * What one pane is showing and what is selected in it.
 *
 * Per pane rather than one line for the active pane: in a dual-pane manager you
 * are usually comparing the two, and a count that moves as focus changes forces
 * you to switch panes to read the other one.
 *
 * This replaced a shortcut cheatsheet. Shortcuts now live in the menu, where
 * they are discoverable once and then remembered; a count of what you are about
 * to act on is worth showing permanently, which a list of keys is not.
 */
export function StatusBar({ paneId }: { paneId: PaneId }) {
  const pane = useFileManagerStore((s) => s.panes[paneId]);

  const visible = visibleEntries(pane);
  const hiddenByFilter = pane.entries.length - visible.length;

  // Directories carry no size, so a selection of folders would otherwise read
  // as "0 B" and look like an error rather than an unknown.
  const selected = pane.entries.filter((e) => pane.selected.has(e.path));
  const sized = selected.filter((e) => e.size !== null);
  const selectedBytes = sized.reduce((sum, e) => sum + (e.size ?? 0), 0);

  const parts: string[] = [
    `${visible.length} item${visible.length === 1 ? "" : "s"}`,
  ];
  if (hiddenByFilter > 0) parts.push(`${hiddenByFilter} hidden`);
  if (selected.length > 0) {
    const size =
      sized.length > 0
        ? `, ${formatBytes(selectedBytes)}${sized.length < selected.length ? " + folders" : ""}`
        : "";
    parts.push(`${selected.length} selected${size}`);
  }

  return (
    <div className="flex items-center justify-between gap-4 border-t border-gray-300 bg-gray-200 px-3 py-1 text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
      <span className="truncate tabular-nums">{parts.join(" · ")}</span>
      {pane.remote && (
        <span className="shrink-0 font-mono text-violet-700 dark:text-violet-300">
          {pane.remote}
        </span>
      )}
    </div>
  );
}
