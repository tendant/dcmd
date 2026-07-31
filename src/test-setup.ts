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
