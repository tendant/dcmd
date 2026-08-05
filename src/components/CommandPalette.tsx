import { useEffect, useMemo, useRef } from "react";
import { COMMANDS, matchCommands, type Match } from "../app/commands";
import { MENU_ACTIONS } from "../app/menuActions";
import { useFileManagerStore } from "../state/fileManagerStore";

/**
 * Highlights the letters the query matched, so it is evident why a row is here
 * — "nf" landing on "New folder" looks arbitrary otherwise.
 */
function Label({ label, positions }: { label: string; positions: number[] }) {
  if (positions.length === 0) return <>{label}</>;
  const hit = new Set(positions);
  return (
    <>
      {[...label].map((ch, i) =>
        hit.has(i) ? (
          <mark key={i} className="bg-transparent font-semibold text-blue-600 dark:text-blue-400">
            {ch}
          </mark>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

/**
 * One search box over every command the menu can dispatch.
 *
 * This app puts most of what it does behind a key, which is fast once learned
 * and invisible until then. The palette is how it gets learned: each row shows
 * its shortcut, so using it three times teaches the key and stops being needed
 * — the same argument the context menu makes.
 *
 * Runs commands through `MENU_ACTIONS`, the same path the native menu uses, so
 * a command cannot behave differently depending on how it was reached.
 */
export function CommandPalette() {
  const palette = useFileManagerStore((s) => s.palette);
  const close = useFileManagerStore((s) => s.closePalette);
  const setQuery = useFileManagerStore((s) => s.setPaletteQuery);
  const moveIndex = useFileManagerStore((s) => s.movePaletteIndex);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = palette?.query ?? "";
  const matches: Match[] = useMemo(() => matchCommands(query, COMMANDS), [query]);

  // Availability is read at render rather than stored: it depends on the whole
  // state, and a palette open across a directory change should reflect it.
  const state = useFileManagerStore();
  const enabled = useMemo(
    () => matches.map((m) => (m.command.available ? m.command.available(state) : true)),
    [matches, state],
  );

  const index = Math.min(palette?.index ?? 0, Math.max(matches.length - 1, 0));

  useEffect(() => {
    if (palette) inputRef.current?.focus();
  }, [palette]);

  useEffect(() => {
    if (!palette) return;
    // Captured, like the preview overlay: Escape in the global handler cancels
    // a transfer and then clears a filter, and it must do neither while this is
    // the thing in front of you.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [palette, close]);

  if (!palette) return null;

  const run = (at: number) => {
    if (!enabled[at]) return;
    const command = matches[at]?.command;
    if (!command) return;
    // Closed first: a command that opens a dialog or starts a rename would
    // otherwise appear behind this, and the palette has served its purpose.
    close();
    MENU_ACTIONS[command.id]?.(useFileManagerStore.getState());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900 dark:text-gray-100"
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-label="Run a command"
          value={query}
          placeholder="Run a command…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              moveIndex(1, matches.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              moveIndex(-1, matches.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(index);
            }
          }}
          className="shrink-0 border-b border-gray-300 bg-transparent px-3 py-2.5 text-sm outline-none dark:border-gray-700"
        />

        <ul id="command-palette-list" role="listbox" className="overflow-y-auto py-1">
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-500">No matching command</li>
          )}
          {matches.map((m, i) => (
            <li
              key={m.command.id}
              role="option"
              aria-selected={i === index}
              aria-disabled={!enabled[i]}
              onMouseDown={(e) => {
                // mousedown, not click: click fires after the input has already
                // lost focus, and the blur would close this first.
                e.preventDefault();
                run(i);
              }}
              className={[
                "flex cursor-default items-center justify-between gap-4 px-3 py-1.5 text-sm",
                i === index ? "bg-blue-600 text-white" : "",
                enabled[i] ? "" : "opacity-40",
              ].join(" ")}
            >
              <span className="truncate">
                <Label label={m.command.label} positions={m.positions} />
              </span>
              <span
                className={[
                  "shrink-0 font-mono text-xs",
                  i === index ? "text-blue-100" : "text-gray-500",
                ].join(" ")}
              >
                {m.command.shortcut ?? ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
