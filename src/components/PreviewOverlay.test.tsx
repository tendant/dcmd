// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { PreviewOverlay, renderMarkdown } from "./PreviewOverlay";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { Preview } from "../tauri/commands";

const open = (content: Preview | null, over: Record<string, unknown> = {}) =>
  useFileManagerStore.setState({
    preview: { path: "/p/a.txt", name: "a.txt", content, error: null, ...over },
  });

beforeEach(() => {
  vi.clearAllMocks();
  useFileManagerStore.setState({ preview: null });
});

/**
 * The security boundary this feature introduces. A previewed file is arbitrary
 * content from anywhere, and this window can call IPC — so script surviving
 * into the page would be running with the app's reach over the filesystem.
 * These must fail loudly if the sanitiser is ever dropped or misconfigured.
 */
describe("markdown sanitising", () => {
  it("strips a script tag", () => {
    const html = renderMarkdown("# hi\n\n<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  it("strips an inline event handler", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html.toLowerCase()).not.toContain("onerror");
  });

  it("does not let a javascript: link through", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("keeps an iframe out", () => {
    expect(renderMarkdown('<iframe src="http://x"></iframe>')).not.toContain("<iframe");
  });

  // It has to still render Markdown, or the sanitiser could "pass" by
  // discarding everything.
  it("still renders ordinary markdown", () => {
    const html = renderMarkdown("# Title\n\n**bold**");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>");
  });
});

describe("PreviewOverlay", () => {
  it("shows nothing when no file is open", () => {
    const { container } = render(<PreviewOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the file it is showing", () => {
    open({ kind: "text", content: "hello", truncated: false });
    render(<PreviewOverlay />);
    expect(screen.getByText("a.txt")).toBeInTheDocument();
  });

  // The overlay appears before the read finishes, so a large file does not look
  // like a dead keypress.
  it("says it is reading while the file loads", () => {
    open(null);
    render(<PreviewOverlay />);
    expect(screen.getByText(/Reading/)).toBeInTheDocument();
  });

  it("renders text as it was written", () => {
    open({ kind: "text", content: "line one", truncated: false });
    render(<PreviewOverlay />);
    expect(screen.getByText("line one")).toBeInTheDocument();
  });

  it("warns when only part of the file is shown", () => {
    open({ kind: "text", content: "start", truncated: true });
    render(<PreviewOverlay />);
    expect(screen.getByText(/first part of this file/)).toBeInTheDocument();
  });

  it("renders markdown rather than showing its source", () => {
    open({ kind: "markdown", content: "# Title", truncated: false });
    const { container } = render(<PreviewOverlay />);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
  });

  it("shows an image from its data", () => {
    open({ kind: "image", mime: "image/png", data: "AAAA" });
    const { container } = render(<PreviewOverlay />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("hands a pdf to an embed", () => {
    open({ kind: "pdf", data: "AAAA" });
    const { container } = render(<PreviewOverlay />);
    expect(container.querySelector("embed")?.getAttribute("type")).toBe("application/pdf");
  });

  // A file dcmd cannot show is still a file the system might open, so the
  // unsupported case is a route onward rather than a dead end.
  it("offers to open an unsupported file elsewhere", () => {
    open({ kind: "unsupported", reason: "binary file, 40.0 MB" });
    render(<PreviewOverlay />);
    expect(screen.getByText(/binary file, 40.0 MB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open in default app/ })).toBeInTheDocument();
  });

  it("shows why a preview failed", () => {
    open(null, { error: "Preview is not available for files on a host yet." });
    render(<PreviewOverlay />);
    expect(screen.getByText(/not available for files on a host/)).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    open({ kind: "text", content: "x", truncated: false });
    render(<PreviewOverlay />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(useFileManagerStore.getState().preview).toBeNull();
  });
});
