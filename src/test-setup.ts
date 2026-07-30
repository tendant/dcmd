import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest is configured without globals, so Testing Library's automatic cleanup
// never registers; without this, renders accumulate across tests and queries
// match elements left behind by earlier ones.
afterEach(() => cleanup());
