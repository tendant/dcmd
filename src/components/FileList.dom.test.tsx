// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { FileList } from "./FileList";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { FileEntry } from "../types/fileEntry";

const entry = (name: string): FileEntry => ({
  name,
  path: `/left/${name}`,
  kind: "file",
  size: 1,
  itemCount: null,
  modifiedAt: null,
  createdAt: null,
  hidden: false,
});

const entries = [entry("a.txt"), entry("b.txt")];

const left = () => useFileManagerStore.getState().panes.left;

beforeEach(() => {
  const s = useFileManagerStore.getState();
  useFileManagerStore.setState({
    panes: {
      ...s.panes,
      left: {
        ...s.panes.left,
        path: "/left",
        entries,
        selected: new Set(["/left/a.txt", "/left/b.txt"]),
        cursor: 1,
        filter: "",
        showHidden: false,
        renameMode: null,
        sort: { key: "name", ascending: true },
      },
    },
  });
});

const list = () =>
  render(
    <FileList
      entries={entries}
      selected={left().selected}
      cursor={left().cursor}
      paneId="left"
      renameMode={null}
      filter=""
    />,
  ).container.firstElementChild as HTMLElement;

describe("clicking the empty space below the rows", () => {
  // Pointing at nothing is how you say "nothing", and with a plain click on a
  // row now narrowing to that row, this is the only way to reach an empty
  // selection with the mouse alone.
  it("drops the marks", () => {
    const scroller = list();
    fireEvent.click(scroller);

    expect(left().selected.size).toBe(0);
  });

  // The rows sit inside this element, so their clicks bubble through it. If it
  // cleared on those too, Cmd+click could never add a second row: the toggle
  // would be undone by the same click on its way out. jsdom has no layout, so
  // the virtualizer renders no rows to click — the sized container they would
  // occupy stands in for one, and it is the same guard either way: the click
  // did not land on the scroller itself.
  it("leaves the marks alone when the click came from inside", () => {
    const scroller = list();
    fireEvent.click(scroller.firstElementChild as HTMLElement);

    expect(left().selected.size).toBe(2);
  });
});
