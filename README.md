# dcmd

A keyboard-first dual-pane file manager for developers, built with Tauri 2,
React and Rust.

Two panes side by side: one is the source, the other the destination. Copy,
move, rename and delete work between them without ever reaching for the mouse.

> **Status: 0.3, usable.** Browsing, file operations, bookmarks, SSH hosts,
> preview and the command palette all work and are covered by tests. Recursive
> filename search is not built yet — see
> [the design document](DCMD-Design-Document-v0.2.md) for the full scope.

## Install

Download from the [latest release](https://github.com/tendant/dcmd/releases/latest):

| Platform | File |
| --- | --- |
| macOS (Apple silicon) | `dcmd_*_aarch64.dmg` |
| Linux | `dcmd_*_amd64.AppImage`, `dcmd_*_amd64.deb` |
| Windows | `dcmd_*_x64-setup.exe`, `dcmd_*_x64_en-US.msi` |

**macOS is signed and notarised**, disk image and app both, so it opens without
the "damaged" dialog an unsigned build produces.

**Apple silicon only.** The binary is arm64, which an Intel Mac cannot run —
Rosetta 2 translates the other direction, Intel binaries onto Apple silicon.
Intel Macs are not supported; building from source is the only route there.

**The Linux and Windows bundles are unsigned.** SmartScreen warns on the Windows
installer — *More info* → *Run anyway*. Code-signing those needs a separate
certificate, which is not set up.

## Building it

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
| Command palette | `⌘⇧P` / `Ctrl+Shift+P` |
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
| Duplicate here | `⌘⇧D` |
| Move to Trash | `F8` or `⌘⌫` |
| Preview | `F3` |
| Open terminal here | `⌘⇧T` / `Ctrl+Shift+T` |
| Select all / none / invert | `⌘A` / `⌘⇧A` / `⌘I` |
| Show or hide the places bar | `⌘B` |
| Open a bookmark or host | `⌘⇧1`–`⌘⇧9` |
| Developer tools (dev builds) | `⌘⌥I` |

On macOS the F-keys are claimed by the system for dictation, Do Not Disturb and
media control, so they only reach the app with `Fn` held, or with *Use F1, F2,
etc. keys as standard function keys* enabled in System Settings. The `⌘`
bindings exist for that reason and do the same thing.

**Right-click** a row, empty space, a places-bar chip or the bar itself for a
menu of what applies, each item labelled with its keyboard shortcut.

Everything is also in the application menu. A command has exactly one binding:
the menu owns every `⌘`/`Ctrl` accelerator, and the keyboard handler owns the
keys whose meaning depends on what is happening — `Esc` unwinds a transfer, then
a filter; `Backspace` edits a filter or goes up; `Space` selects or cancels a
size walk. Those cannot be fixed accelerators, so they appear in menu labels
rather than as shortcuts.

## Remote hosts

Hosts come from your `~/.ssh/config`, so keys, ports, `ProxyJump` and
`known_hosts` all apply without dcmd reimplementing any of it. **Go → Add
Host…**, or right-click the places bar. A config of any size is filtered as you
type.

A remote pane is a listing over SFTP, not a mounted filesystem. Transfers to or
from it run **rsync**, which is what these connections are actually for: it
resumes, it only sends what differs, and a dry run shows what would change
before anything does. Listings are cached, so going back to a directory does not
re-fetch it.

**Getting back.** `⌘L` takes a scope as well as a path:

| Typed | Goes to |
| --- | --- |
| `/var/log` | that path, **wherever the pane already is** |
| `build:/srv` | `/srv` on the host `build` |
| `local:/var/log` | `/var/log` on this machine |

A bare path deliberately stays put: on a host, `/var/log` means that host's.
Editing `build:` to `local:` is the whole gesture for coming back, and `⌘L`
pre-fills the prefix so it is visible rather than something you have to know.

**Go → Disconnect from Host** does the same without typing — also in the command
palette. It lands on the same path if it exists here and your home directory
otherwise, since `/srv` on a build host usually means nothing locally.

Only a saved alias is read as a host, so `C:\Users` stays a Windows path and a
file named `notes:draft` stays a file.

Not available on a remote pane: preview, duplicating in place, and dragging out.
Each says so rather than failing.

*Unix only* — remote support drives the system `ssh` binary.

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

**Preview (`F3`)** shows text, Markdown, images and PDF read-only, without
leaving the window. Markdown is rendered and sanitised — a previewed file is
arbitrary content, and this window can call into the filesystem. Text over 1 MiB
is truncated with a notice rather than refused; anything dcmd cannot display
offers to open in the default application instead.

**Files can be dragged out** to Finder, Mail or anything else that takes files.
Dragging a selected row takes the whole selection; dragging an unselected one
takes just that row.

**A refusal is not an error.** "Nothing to copy", or asking for a terminal on a
remote pane, appear as a line in the status bar: nothing went wrong, nothing was
lost, and nothing needs deciding. The red bar is kept for failures that lost
work or need an answer.

**Both appear at the foot of the pane**, never above the list. A bar that opens
above it pushes every row down, moving the row under your cursor out from under
a keypress already on its way. At the bottom the listing loses height instead
and nothing you were looking at moves.

**Escape dismisses whatever a pane is telling you**, and does not spend the
keypress doing it: the same Escape still clears your filter or cancels the
transfer. Otherwise a message would make you press it twice.

**Errors reach a log file.** The webview console goes nowhere a user can see, so
uncaught errors, failed listings and transfer failures are appended to
`dcmd.log` in the platform log directory. **dcmd → Open Log** opens it.

**Sorting is per pane**, with folders always grouped first. Entries with nothing
to compare — directories have no size, creation time is missing on some
filesystems — sort last whichever direction is chosen.

## Development

```sh
make            # what every target does
make check      # everything CI runs, in the same order
make dev        # the app, with hot reload
```

`make check` is the one to run before pushing. Underneath it is nothing you
could not type by hand — the commands simply live in two directories and two
ecosystems:

```sh
pnpm build                      # tsc, so this covers type errors too
pnpm test                       # frontend: store logic and components (jsdom)
cd src-tauri && cargo fmt --check
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo clippy --release --all-targets -- -D warnings
cd src-tauri && cargo test
```

The release clippy run matters: code behind `debug_assertions` — the developer
tools menu item — is compiled out there, and a `mut` that only the removed
branch needed is a warning nothing in the dev profile can report. **CI does not
run it**, so `make check` is deliberately stricter than CI rather than equal to
it. That is the one difference between them.

CI runs the rest, with the Rust suite across Linux, macOS and Windows — the
filesystem behaviour is what differs between them.

`make test-live` runs the Rust suite including the remote tests, starting a
throwaway SSH container first and stopping it afterwards even if the tests fail.
Without it those tests skip silently and report `ok` without connecting to
anything.

`./scripts/check-platforms.sh` runs clippy over the cfg-gated filesystem code
for Linux and Windows. The full crate cannot be cross-checked from macOS —
tauri-winres needs llvm-rc for the Windows resource step — so those files are
extracted into a throwaway crate instead. It prints what it does **not** cover,
which is most of the crate.

It compiles that code and never runs it, so a platform-dependent *assertion*
passes there and fails on a real runner. Where behaviour differs by platform,
lift the rule out of the `cfg` into a plain function and test that, so it can be
checked from any host — `is_invalid_on_windows` is the example.

Cutting a release, and what macOS signing needs, is in
[docs/releasing.md](docs/releasing.md). Worth knowing before you touch it: the
certificate required is a **Developer ID Application** one, not the Apple
Development certificate already in most keychains, and both the `.app` and the
`.dmg` around it have to be notarised — Gatekeeper assesses the disk image, and
a signed-but-unnotarised one is refused with the app inside it untouched.

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
  remote/       ssh config, SFTP listing, rsync
  menu.rs       the native menu; menu_ids.txt is the contract with the frontend
  preview.rs    classifying and reading a file for display
  logging.rs    the log file both sides write to
```

The frontend holds no filesystem logic; every operation is a Rust command run
off the UI thread. Cursor positions, selections and operation targets all
resolve through `visibleEntries()` so that a filtered view cannot act on a row
you cannot see.
