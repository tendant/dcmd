# dcmd

A keyboard-first dual-pane file manager for developers, built with Tauri 2,
React and Rust.

Two panes side by side: one is the source, the other the destination. Copy,
move, rename and delete work between them without ever reaching for the mouse.

> **Status: early.** Browsing and file operations work and are covered by tests.
> Bookmarks, search and preview are not implemented —
> see [the design document](DCMD-Design-Document-v0.2.md) for what is planned.

## Running it

Requires [Rust](https://rustup.rs), Node 22+ and pnpm.

```sh
pnpm install
pnpm tauri dev          # development, with hot reload
pnpm tauri build        # release binary + installer
```

`pnpm dev` alone serves the frontend in a browser, where **no file operation
will work** — every one of them goes through Rust, which is only present in the
window `pnpm tauri dev` opens. The app says so rather than failing silently.

## Keyboard

| Action | Keys |
| --- | --- |
| Switch pane | `Tab` |
| Open file or enter folder | `Enter`, or double-click |
| Go up | `Backspace` |
| Back / forward | `⌘[` / `⌘]`, or `Alt+←→` |
| Bookmark this folder | `⌘D` |
| Edit path | `⌘L` / `Ctrl+L` |
| Refresh | `⌘R` / `Ctrl+R` |
| Select, and size a folder | `Space` |
| Extend selection | `Shift+↑↓`, `Shift+Click` |
| Filter | just start typing |
| Clear filter, cancel a transfer | `Esc` |
| Show/hide dotfiles | `⌘⇧.` / `Ctrl+H` |
| Sort by name/size/modified/created/kind | `⌘1`–`⌘5`, or click a header |
| Resize panes | `⌘⇧←→`, or drag the divider |
| Even split | `⌘0`, or double-click the divider |
| Collapse to one pane | `⌘\\` |
| Copy to other pane | `F5` or `⌘⇧C` |
| Move to other pane | `F6` or `⌘⇧M` |
| New folder | `F7` or `⌘⇧N` |
| Rename | `F2` or `⌘⇧R` |
| Move to Trash | `F8` or `⌘⌫` |

On macOS the F-keys are claimed by the system for dictation, Do Not Disturb and
media control, so they only reach the app with `Fn` held, or with *Use F1, F2,
etc. keys as standard function keys* enabled in System Settings. The `⌘`
bindings exist for that reason and do the same thing.

**Right-click** a row or empty space for a menu of what applies, each item
labelled with its keyboard shortcut.

## Behaviour worth knowing

**Folder sizes are not computed while listing.** A directory shows its item
count; pressing `Space` computes the recursive byte total, which can take
minutes on a large tree and is cancellable with `Space` again or `Esc`.
Computing sizes eagerly meant listing a home directory walked millions of files
before showing anything.

**Folders merge.** Copying a folder onto one of the same name descends into it
and applies your choice — skip, replace, keep both — to the individual files
inside. Files the destination has and the source does not are left alone.

**Nothing is deleted before its replacement exists.** Replacing assembles the
incoming copy beside the target and swaps it in only once complete, so a failed
or cancelled transfer leaves the original intact.

**Deleting names what it will delete**, goes to the system Trash rather than
unlinking, and reports which items it could not take rather than failing the
whole batch with one message.

**Dotfiles are hidden by default**, toggled per pane.

**Layout and sorting persist** across restarts, in `settings.json` in the
platform config directory. A corrupt or hand-edited file falls back to defaults
rather than failing to start.

**The Size and Modified columns are resizable** — drag the handle on the left
edge of either, or double-click a handle to reset both. Widths are per pane
and persist.

**Sorting is per pane**, with folders always grouped first. Entries with nothing
to compare — directories have no size, creation time is missing on some
filesystems — sort last whichever direction is chosen.

## Development

```sh
pnpm test                       # frontend: store logic and components (jsdom)
cd src-tauri && cargo test      # filesystem operations
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

CI runs all of the above, with the Rust suite across Linux, macOS and Windows —
the filesystem behaviour is what differs between them.

`./scripts/check-platforms.sh` cross-compiles the cfg-gated filesystem code for
Linux and Windows. The full crate cannot be cross-checked from macOS, because
tauri-winres needs llvm-rc for the Windows resource step, so the platform files
are extracted into a throwaway crate instead. Run it before pushing changes to
platform-specific code — otherwise CI is the first thing that compiles them.

`DCMD_TRACE_STARTUP=1` makes a release build report startup milestones to
stderr. Startup currently misses the design document's sub-100ms target; the
measurements and where the time goes are recorded there.

For exercising the dialogs by hand:

```sh
./scripts/make-fixture.sh       # builds /tmp/dcmd-fixture
```

It creates two directories that overlap in part, so a multi-item copy produces a
partial conflict, plus deep nesting, awkward filenames and a bulk directory big
enough to make progress and cancellation worth testing.

## Layout

```
src/
  app/          global keyboard handling, startup
  components/   panes, list, dialogs, error and progress bars
  state/        one Zustand store for both panes
  tauri/        the only place that calls invoke()
  errors.ts     backend errors -> messages a person can act on
src-tauri/src/
  commands/     the Tauri command surface
  fs/           listing, entry model, atomic rename
  operations/   copy, move, rename, mkdir, trash, transfer policy
```

The frontend holds no filesystem logic; every operation is a Rust command run
off the UI thread. Cursor positions, selections and operation targets all
resolve through `visibleEntries()` so that a filtered view cannot act on a row
you cannot see.
