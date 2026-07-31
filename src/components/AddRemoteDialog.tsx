import { useEffect, useMemo, useRef, useState } from "react";
import { useFileManagerStore } from "../state/fileManagerStore";

/**
 * Matches a host against a query, requiring every whitespace-separated term to
 * appear somewhere in the name.
 *
 * Terms rather than one substring because host names are usually structured —
 * `prod-web-01`, `staging-db-eu` — so "prod db" should find the production
 * database without needing the parts in order or remembering the separator.
 */
export function matchesHost(host: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const name = host.toLowerCase();
  return terms.every((t) => name.includes(t));
}

export function filterHosts(hosts: string[], query: string): string[] {
  return hosts.filter((h) => matchesHost(h, query));
}

/**
 * Picks a host from the ssh config.
 *
 * A config of any size makes a plain list unusable, so this filters as you type,
 * the way the file list does. Arrow keys and Enter work throughout: reaching for
 * the mouse to pick from a filtered list would defeat the point.
 */
export function AddRemoteDialog({
  available,
  onDone,
}: {
  available: string[];
  onDone: () => void;
}) {
  const addRemote = useFileManagerStore((s) => s.addRemote);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => filterHosts(available, query), [available, query]);

  useEffect(() => inputRef.current?.focus(), []);
  // A narrowing list would otherwise leave the highlight past the end.
  useEffect(() => setHighlight(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const host = matches[highlight];
      if (host) addRemote(host);
    }
  };

  return (
    <>
      <h2 className="text-base font-semibold">Add a host</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        {available.length === 0
          ? "No new hosts found in ~/.ssh/config."
          : "From your ~/.ssh/config. Whatever ssh already knows about the host — keys, port, ProxyJump — applies."}
      </p>

      {available.length > 0 && (
        <>
          <div className="mt-2 flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Filter hosts…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
            <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
              {matches.length} / {available.length}
            </span>
          </div>

          <div
            ref={listRef}
            role="listbox"
            aria-label="Hosts"
            className="my-2 max-h-60 overflow-y-auto rounded border border-gray-200 dark:border-gray-700"
          >
            {matches.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                No host matches “{query}”.
              </div>
            ) : (
              matches.map((h, i) => (
                <button
                  key={h}
                  role="option"
                  aria-selected={i === highlight}
                  data-index={i}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => addRemote(h)}
                  className={`block w-full truncate px-3 py-1.5 text-left font-mono text-xs ${
                    i === highlight ? "bg-blue-500 text-white" : "hover:bg-blue-500 hover:text-white"
                  }`}
                >
                  {h}
                </button>
              ))
            )}
          </div>
        </>
      )}

      <div className="mt-3 flex justify-end">
        <button
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
          onClick={onDone}
        >
          Close
        </button>
      </div>
    </>
  );
}
