import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest is configured without globals, so Testing Library's automatic cleanup
// never registers; without this, renders accumulate across tests and queries
// match elements left behind by earlier ones.
afterEach(() => cleanup());

// jsdom implements no layout, so scrolling APIs simply do not exist. Stubbed
// here rather than guarded in components, which would add checks that are dead
// weight in the real browser.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Pointer capture is likewise absent. The drag handlers use it so a drag
// survives the pointer leaving a few-pixel-wide handle, which is real behaviour
// worth keeping rather than working around in the components.
if (typeof Element !== "undefined" && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

/**
 * Give elements a size, so the virtualized file list renders rows.
 *
 * The list is most of the app, and none of it could be tested through the
 * component that composes it: the virtualizer sizes its window from
 * `offsetWidth`/`offsetHeight` alone — see `getRect` in @tanstack/virtual-core —
 * and jsdom, which performs no layout, reports 0 for both. A window of zero
 * height holds no rows, so `FileList` rendered an empty list and every test of a
 * row had to render that row on its own, away from the indexing and composition
 * that put it there.
 *
 * An inline pixel height is honoured because that is how the virtualizer sizes
 * its own spacer, and reading it back is what makes the rendered range follow
 * the row count. Anything else reports a viewport-sized box.
 *
 * ResizeObserver is stubbed as a no-op rather than left undefined: the
 * virtualizer measures once up front and only needs the observer for a *change*
 * of size, which nothing in a test produces. Its absence is handled, but then
 * jsdom's missing constructor would be the reason resizing is untested — better
 * that the seam is visible here.
 */
const VIEWPORT_PX = 600;

if (typeof HTMLElement !== "undefined") {
  const inlinePx = (el: HTMLElement, dimension: "height" | "width"): number | null => {
    const value = el.style?.[dimension];
    return value?.endsWith("px") ? parseFloat(value) : null;
  };

  const sizes = [
    ["offsetHeight", "height"],
    ["offsetWidth", "width"],
  ] as const;

  for (const [property, dimension] of sizes) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        return inlinePx(this, dimension) ?? VIEWPORT_PX;
      },
    });
  }
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
