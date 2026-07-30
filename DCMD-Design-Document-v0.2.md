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
-   Mouse support
-   Bookmarks
-   History
-   Path bar

## Pane sizing

**TODO — not yet implemented.** The split is a fixed 50/50 (`flex-1` on each
pane in `DualPaneLayout`), so neither pane can be widened.

-   Draggable divider between the panes
-   Double-click the divider to reset to an even split
-   Keyboard adjustment, so it is reachable without the mouse
-   Collapse one pane entirely, and restore it
-   Remember the ratio across restarts

Notes for whoever picks this up:

-   Store the split as a **ratio**, not a pixel width, or resizing the window
    will push one pane off-screen.
-   Clamp to a sensible minimum so a pane cannot be dragged to zero by
    accident; collapsing should be a deliberate action with its own way back.
-   The file list is virtualised against a measured container. The virtualiser
    must be told the height changed, or rows will be positioned against a stale
    measurement after a resize.
-   Persistence needs somewhere to live: there is no settings store yet, and
    this is likely the first thing to want one.

## Sorting

**TODO — not yet implemented.** Listings are currently fixed at
directories-first, then case-insensitive by name.

-   Sort by name
-   Sort by size
-   Sort by modified time
-   Sort by created time
-   Sort by extension / kind
-   Ascending and descending, toggled by re-selecting the active key
-   Directories grouped before files, independent of the sort key
-   Per pane, since the two are often used for different purposes
-   Clickable column headers, with the active key and direction shown
-   Keyboard shortcuts for each key, so it stays usable without the mouse

Notes for whoever picks this up:

-   `FileEntry` carries `modifiedAt` but **not** a creation time. Sorting by
    created time needs a new field from `build_entry`.
-   `std::fs::Metadata::created()` is not available everywhere: it works on
    macOS and Windows, but returns an error on Linux filesystems that do not
    record a birth time. The field has to be optional, and the UI needs to
    behave sensibly when it is missing rather than sorting those entries
    arbitrarily.
-   Sorting happens in Rust today (`read_dir_entries`). Doing it in the
    frontend instead would let the key change without re-listing, but means
    shipping the comparison logic to the client; either is defensible, but the
    choice should be made deliberately rather than by accident.
-   Whatever is chosen must resolve rows through `visibleEntries()`, or a sort
    applied while a filter is active will desynchronise the cursor from what is
    on screen.

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
