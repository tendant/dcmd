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
