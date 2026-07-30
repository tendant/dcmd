# DCMD Design Document (POC & MVP)

Project: **DCMD**

Version: 0.2

## Vision

**DCMD is the fastest native, keyboard-first dual-pane file manager for
developers.**

Goals:

-   Fast startup
-   Native desktop experience
-   Keyboard-driven workflow
-   Reliable file operations
-   Cross-platform
-   Small binary
-   Modern, maintainable architecture

Non-goals:

-   Cloud sync
-   AI features
-   Plugin marketplace
-   Enterprise collaboration
-   Finder replacement

------------------------------------------------------------------------

# Technology Stack

  Component       Choice
  --------------- ---------------------
  Desktop         Tauri 2
  Frontend        React + TypeScript
  Build           Vite
  Backend         Rust
  Async           Tokio
  State           Zustand
  Styling         Tailwind CSS
  Virtual Lists   TanStack Virtual
  Serialization   Serde
  File Watching   notify
  Logging         tracing
  Testing         Vitest + Playwright

------------------------------------------------------------------------

# Product Philosophy

1.  Fast by default
2.  Keyboard first
3.  Native feel
4.  Reliable file operations
5.  Simple over configurable
6.  Small and maintainable

------------------------------------------------------------------------

# POC Goal

Validate that users prefer the interaction over Finder.

Success criteria:

-   Browse directories
-   Two panes
-   Copy files
-   Move files
-   Rename
-   Delete to Trash
-   Smooth navigation
-   Startup feels instant

No networking. No plugins. No settings.

------------------------------------------------------------------------

# MVP Scope

## Navigation

-   Dual panes
-   Keyboard navigation
-   Mouse support, including a right-click menu
-   Bookmarks
-   History
-   Path bar

## Pane sizing

Implemented. The split is draggable, double-clicking the divider evens it up,
and either pane can be collapsed for a single-pane view.

-   `Cmd/Ctrl+Shift+←→` moves the divider, `Cmd/Ctrl+0` evens it,
    `Cmd/Ctrl+\\` collapses the pane not in use
-   The divider is focusable and takes arrow keys directly
-   Stored as a ratio, so resizing the window cannot push a pane off-screen
-   Clamped to 15% either side; collapsing is a separate deliberate action with
    its own way back, rather than something a drag can do by accident
-   A collapsed pane is removed from the layout rather than given zero width, so
    it cannot take focus or be reached by Tab while invisible
-   Focus moves to the other pane when the active one is collapsed

The split and the collapse state are remembered across restarts, apart from a
collapsed pane: a window that opens missing half its interface reads as broken,
and re-collapsing costs one keystroke.

## Sorting

Implemented. Rows sort by name, size, modified time, created time or extension,
ascending or descending, per pane. Directories are grouped ahead of files
regardless of the key, since burying folders under a size sort makes navigating
harder rather than easier.

-   Clickable column headers, showing the active key and direction
-   Size and Modified are resizable by dragging the handle on their leading
    edge; double-clicking a handle resets both. Widths are in pixels rather than
    a fraction, since these size their content rather than the window, and are
    clamped so a column can neither vanish nor squeeze out the name
-   `Cmd/Ctrl+1..5` selects a key; pressing the active one reverses it
-   Names compare numerically, so `file2` precedes `file10`
-   The cursor follows its entry when the order changes, not its index
-   Entries with no value for the key — directories have no size, and creation
    time is absent on some filesystems — sort last in **both** directions

Sorting happens in the frontend, inside `visibleEntries()`, so changing the key
does not re-list the directory and cannot desynchronise the cursor from a
filtered view.

The key and direction are remembered across restarts, per pane.

## Operations

-   Copy
-   Move
-   Rename
-   Delete to Trash
-   New Folder
-   Refresh

## Preview

Read-only preview:

-   Text
-   Markdown
-   Images
-   PDF

## Search

Filename search only.

## Command Palette

Cmd/Ctrl + P

Commands:

-   Copy
-   Move
-   Rename
-   Delete
-   Refresh
-   New Folder
-   Open Terminal

------------------------------------------------------------------------

# Context menu

Right-clicking a row offers open, copy and move to the other pane, rename, move
to Trash, calculate size for folders, reveal in the file browser and copy path.
Right-clicking empty space offers new folder, refresh, a sort submenu and a
hidden-files toggle.

Every item shows its keyboard shortcut. The menu is as much a way of learning
the keyboard interface as of avoiding it: most of what this app does is behind a
key, and a menu listing no shortcuts would teach people to keep reaching for the
mouse.

-   Right-clicking a row that is not in the selection selects it first, so the
    menu can never describe acting on something the click did not hit
-   Right-clicking ".." gives the folder menu. A directory with enough rows to
    leave no blank space would otherwise offer no way to reach those actions
    from the list, and that row is always present
-   With several items selected the labels name the count — a menu reading
    "Copy a.txt" while about to copy twelve files is lying
-   Rename is disabled for a multi-selection rather than silently acting on one
-   Built in HTML rather than with Tauri's `Menu::popup`. The native menu looks
    more native and is accessible for free, but cannot be covered by the
    component tests, and showing a shortcut beside each item is awkward in it.
-   The webview's own menu is suppressed by preventing the `contextmenu` event;
    Tauri has no configuration flag for this. Inputs keep theirs, since the
    native menu is genuinely useful for paste while renaming.

# Settings

Stored as JSON in the platform config directory, `settings.json`. Currently the
split ratio and, per pane, the sort key, direction and whether dotfiles show.

-   Loaded with the start directory in a single `startup_info` command, because
    each round trip sits on the startup critical path
-   Written at most twice a second, and only when something actually changed —
    dragging the divider produces an update per frame
-   Written via a temporary file and a rename, so an interrupted write cannot
    leave a half-written file that fails to parse next time
-   A corrupt, truncated or hand-edited file yields defaults rather than an
    error: settings are a convenience and must never stop the app starting
-   Values are validated on load, not trusted. A split of 0 or a sort key from a
    newer build is replaced, so an edited file cannot put the UI into a state
    with no way out

# User Interface

``` text
+-----------------------------------------------------------+
| Left Path                     | Right Path                |
+-------------------------------+---------------------------+
| files                         | files                     |
|                               |                           |
|                               |                           |
+-------------------------------+---------------------------+

F5 Copy
F6 Move
F7 Mkdir
F8 Delete

Cmd+P Command Palette
```

------------------------------------------------------------------------

# Repository Layout

``` text
src/
    app/
    components/
    state/
    tauri/
    styles/
    types/

src-tauri/
    commands/
    fs/
    operations/
    platform/
```

------------------------------------------------------------------------

# Frontend Responsibilities

-   Rendering
-   Selection
-   Keyboard handling
-   Tabs
-   Progress UI
-   Dialogs
-   State management

------------------------------------------------------------------------

# Rust Responsibilities

-   Directory listing
-   File operations
-   Progress reporting
-   Cancellation
-   Trash
-   File watching
-   Error handling

------------------------------------------------------------------------

# Initial Rust Commands

-   list_directory()
-   copy()
-   move()
-   rename()
-   mkdir()
-   trash()
-   cancel_operation()

------------------------------------------------------------------------

# File Entry Model

``` ts
type FileEntry = {
    name: string;
    path: string;
    kind: "file" | "directory" | "symlink";
    size: number | null;
    modifiedAt: number | null;
    hidden: boolean;
};
```

------------------------------------------------------------------------

# Performance Targets

Startup

-   \<100 ms

**Measured, and not met.** Release build on an M-series Mac, timed from
`main()` with `DCMD_TRACE_STARTUP=1`:

| Milestone | Time |
| --- | --- |
| Window created | ~160-200 ms |
| First listing requested | ~320-350 ms |
| Both panes ready | ~360-420 ms |

The shape of the problem is that **~180 ms goes on Tauri and WebView
initialisation before any application code runs**. The target is already
exceeded by the time the window exists, so it cannot be reached by optimising
what happens afterwards. The remaining ~150 ms is bundle parse, React mount and
the first IPC round trip.

Options, none of them free:

-   Revise the target to measure time to interactive after window creation,
    which is the part that is actually ours to control.
-   Render the window shell before the first listing returns, so perceived
    startup is the ~180 ms rather than the ~380 ms.
-   Have Rust supply the initial path with the window instead of the frontend
    asking for it, removing one IPC round trip from the critical path.

Measured and rejected as a fix: listing the two panes concurrently rather than
in sequence. It is the correct shape and is done that way now, but on a local
home directory the saving is around 16 ms and vanishes into run-to-run
variance. It would matter on a slow mount.

Directory open

-   \<30 ms

Scrolling

-   60 FPS

Large directory

-   Responsive with 100k+ entries

------------------------------------------------------------------------

# Keyboard Shortcuts

  Shortcut     Action
  ------------ -----------------
  Tab          Switch Pane
  Enter        Open
  Backspace    Parent
  Space        Select
  F2           Rename
  F5           Copy
  F6           Move
  F7           New Folder
  F8           Trash
  Cmd/Ctrl+L   Path
  Cmd/Ctrl+P   Command Palette
  Cmd/Ctrl+R   Refresh

------------------------------------------------------------------------

# Architecture

``` text
React UI
      │
      ▼
Tauri Commands
      │
      ▼
Rust Application Layer
      │
      ▼
Filesystem / Operating System
```

Keep the frontend thin.

Business logic lives in Rust.

------------------------------------------------------------------------

# Milestones

## Milestone 1

-   Launch
-   Browse
-   Navigate
-   Active pane

## Milestone 2

-   Copy
-   Move
-   Rename
-   Delete
-   Mkdir

## Milestone 3

-   Bookmarks
-   History
-   Search
-   Command Palette
-   Sorting (see the Sorting section above)
-   Pane sizing (see the Pane sizing section above)

## Milestone 4

-   Preview
-   Progress
-   Cancellation
-   Operation Queue

------------------------------------------------------------------------

# Deferred

Not included in MVP:

-   SSH
-   SFTP
-   Git
-   Archives
-   Plugins
-   AI
-   Cloud storage
-   Remote filesystem
-   Themes
-   Scripting

------------------------------------------------------------------------

# Design Principles

-   Every operation is cancellable.
-   Never block the UI.
-   Never lose user data.
-   Optimize for common workflows.
-   Opinionated defaults.
-   Build only features used every week.

------------------------------------------------------------------------

# Long-term Vision

Become the developer's preferred local file manager.

Future capabilities (after product-market fit):

-   SSH
-   Archive browsing
-   Git status
-   Workspace tabs
-   Plugin SDK
-   AI-assisted operations (optional)


---

# Project Name

## Name

**DCMD**

### Command

```bash
dcmd
```

### Homebrew

```bash
brew install dcmd
```

### Branding

**DCMD** is intentionally short and Unix-like. The name is treated as its own identity rather than an acronym. It is easy to type, easy to remember, and fits naturally alongside tools such as `git`, `rg`, `fd`, `jj`, and `uv`.

Tagline:

> **Fast native dual-pane file manager for developers.**


---

# Project Identity

## Name

**DCMD**

DCMD is a fast, native, keyboard-first dual-pane file manager for developers.

## Command

```bash
dcmd
```

## Installation

```bash
brew install dcmd
```

## Tagline

> Fast native dual-pane file manager for developers.

## Naming Guidance

Treat **DCMD** as the product name rather than expanding it as an acronym in public-facing material.
