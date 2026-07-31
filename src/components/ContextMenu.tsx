import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFileManagerStore } from "../state/fileManagerStore";
import { buildMenuItems, type MenuItem } from "./contextMenuItems";

const ROW =
  "flex w-full items-center gap-4 px-3 py-1 text-left text-xs disabled:opacity-40 disabled:cursor-default";

function Items({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  const [openSub, setOpenSub] = useState<string | null>(null);

  return (
    <>
      {items.map((item, i) => {
        if (item.kind === "separator") {
          return <div key={i} className="my-1 border-t border-gray-200 dark:border-gray-700" />;
        }

        if (item.kind === "submenu") {
          const open = openSub === item.label;
          return (
            <div key={i} className="relative">
              <button
                className={`${ROW} justify-between hover:bg-blue-500 hover:text-white`}
                onClick={() => setOpenSub(open ? null : item.label)}
                aria-expanded={open}
                aria-haspopup="menu"
              >
                <span>{item.label}</span>
                <span aria-hidden>›</span>
              </button>
              {open && (
                <div
                  role="menu"
                  className="ml-2 border-l border-gray-200 py-1 dark:border-gray-700"
                >
                  <Items items={item.items} onDone={onDone} />
                </div>
              )}
            </div>
          );
        }

        const checked = item.kind === "check" ? item.checked : false;
        return (
          <button
            key={i}
            role="menuitem"
            disabled={item.kind === "action" && item.disabled}
            onClick={() => {
              item.run();
              onDone();
            }}
            className={`${ROW} justify-between ${
              item.kind === "action" && item.danger
                ? "text-red-700 hover:bg-red-600 hover:text-white dark:text-red-400"
                : "hover:bg-blue-500 hover:text-white"
            }`}
          >
            <span className="truncate">
              {item.kind === "check" && (
                <span aria-hidden className="mr-1 inline-block w-3">
                  {checked ? "✓" : ""}
                </span>
              )}
              {item.label}
            </span>
            {item.shortcut && (
              <span className="shrink-0 font-mono text-[10px] opacity-60">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </>
  );
}

/**
 * Right-click menu.
 *
 * Positioned against the viewport and flipped when it would overflow, since a
 * menu opened near the bottom-right of the window would otherwise be partly
 * unreachable.
 */
export function ContextMenu() {
  const menu = useFileManagerStore((s) => s.contextMenu);
  const close = useFileManagerStore((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measured before paint, so the menu never appears in the wrong place first.
  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const box = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - box.width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - box.height - 4)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menu, close]);

  useEffect(() => {
    if (!menu) return;
    // Anything that moves the ground under the menu dismisses it. It is placed
    // against the viewport at one instant, so after a resize it points at
    // whatever now happens to be there; and switching away to another app or to
    // the native menubar leaves it floating over an app that is no longer
    // listening to it.
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu, close]);

  if (!menu) return null;
  const items = buildMenuItems(useFileManagerStore.getState(), menu);

  return (
    <div
      className="fixed inset-0 z-40"
      // On press rather than click: pressing outside and releasing inside is
      // never a click, so the menu used to survive a press-and-drag dismissal.
      onPointerDown={close}
      onClick={close}
      // Right-clicking elsewhere has to dismiss it too. Suppressing the webview
      // menu without closing ours left it stuck, and because the overlay covers
      // the window, the next right-click could not reach anything either.
      onContextMenu={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div
        ref={ref}
        role="menu"
        aria-label="Actions"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          // Inside the menu, suppress the webview's menu but keep ours open.
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{
          left: pos?.left ?? menu.x,
          top: pos?.top ?? menu.y,
          // Hidden for the first frame while it is measured, rather than
          // flashing at the unclamped position.
          visibility: pos ? "visible" : "hidden",
        }}
        className="fixed min-w-56 max-w-80 rounded-md border border-gray-300 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        <Items items={items} onDone={close} />
      </div>
    </div>
  );
}
