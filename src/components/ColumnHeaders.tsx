import { useFileManagerStore, type PaneId, type SortKey } from "../state/fileManagerStore";

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: "name", label: "Name", className: "flex-1 text-left" },
  { key: "size", label: "Size", className: "w-16 text-right" },
  { key: "modified", label: "Modified", className: "w-16 text-right" },
];

/**
 * Clickable sort headers. Clicking the active column reverses it, which is the
 * convention everywhere else and avoids needing a separate direction control.
 */
export function ColumnHeaders({ paneId }: { paneId: PaneId }) {
  const sort = useFileManagerStore((s) => s.panes[paneId].sort);
  const setSort = useFileManagerStore((s) => s.setSort);

  return (
    <div className="flex items-center gap-2 border-b border-gray-300 bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
      {/* Matches the icon column in each row so the labels line up. */}
      <span className="w-4" aria-hidden />
      {COLUMNS.map(({ key, label, className }) => {
        const active = sort.key === key;
        return (
          <button
            key={key}
            onClick={() => setSort(paneId, key)}
            aria-sort={active ? (sort.ascending ? "ascending" : "descending") : "none"}
            className={`${className} truncate hover:text-gray-900 dark:hover:text-gray-100 ${
              active ? "font-semibold text-gray-900 dark:text-gray-100" : ""
            }`}
          >
            {label}
            {active && <span aria-hidden> {sort.ascending ? "▲" : "▼"}</span>}
          </button>
        );
      })}
    </div>
  );
}
