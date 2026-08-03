#!/usr/bin/env bash
# Cross-compile the platform-specific filesystem code for Linux and Windows.
#
# Cross-compiling the real crate from a Mac is not possible: tauri-winres needs
# llvm-rc for the Windows resource step. So the filesystem files carrying
# cfg-gated code are extracted into a throwaway crate and linted there, which
# catches the unused import or wrong symbol only that platform sees.
#
# Read the coverage list it prints. Only the extracted files are checked, and a
# cfg elsewhere — lib.rs, the commands, the remote module — reaches no compiler
# here at all. That gap is why a value managed only on Windows passed this
# script and failed CI. This is a fast first pass, not a substitute for CI.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="src-tauri/src"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/src"
cat > "$WORK/Cargo.toml" <<'EOF'
[package]
name = "platform-check"
version = "0.0.0"
edition = "2021"

[target.'cfg(unix)'.dependencies]
libc = "0.2"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = ["Win32_Storage_FileSystem"] }
EOF

# Stand-ins for the crate types the extracted code refers to.
cat > "$WORK/src/lib.rs" <<'EOF'
#![allow(dead_code)]
#[derive(Debug)]
pub enum FsError {
    NotFound(String),
    AlreadyExists(String),
    PermissionDenied(String),
    InvalidName(String),
    NotADirectory(String),
    Trash(String),
    Io(String),
    Cancelled(String),
}
impl From<std::io::Error> for FsError {
    fn from(e: std::io::Error) -> Self {
        FsError::Io(e.to_string())
    }
}
pub mod atomic;
pub mod paths;
EOF

# Strip crate-internal paths and test modules; keep the cfg-gated bodies intact.
extract() {
  python3 - "$1" "$2" <<'PY'
import re, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
i = s.find('#[cfg(test)]')
if i != -1:
    s = s[:i]
s = s.replace('use crate::error::FsError;', 'use crate::FsError;')
s = re.sub(r'crate::fs::paths::', 'crate::paths::', s)
open(dst, 'w').write(s)
PY
}

extract "$SRC/fs/paths.rs" "$WORK/src/paths.rs"
extract "$SRC/fs/atomic.rs" "$WORK/src/atomic.rs"

# Everything cfg-gated that this script does not compile. Printed rather than
# assumed, so the list cannot quietly go stale as the code grows.
echo "checked here: fs/paths.rs, fs/atomic.rs"
uncovered=$(grep -rl --include='*.rs' -E '#\[cfg\((unix|windows|not\(unix\)|target_os)' "$SRC" \
  | grep -v -E '/(paths|atomic)\.rs$' | sed "s|^$SRC/||" | sort | paste -sd' ' -)
if [ -n "$uncovered" ]; then
  echo "NOT checked here (CI only): $uncovered"
fi
echo

status=0
for target in x86_64-unknown-linux-gnu x86_64-unknown-linux-musl x86_64-pc-windows-msvc; do
  printf '%-32s ' "$target"
  # clippy, not check: CI runs clippy with -D warnings, and its lints are what
  # a `cargo check` here will not reproduce. A unit value managed only on
  # Windows passed this script and failed the build.
  if (cd "$WORK" && cargo clippy --quiet --all-targets --target "$target" -- -D warnings 2>/tmp/pc-err.txt); then
    echo "ok"
  else
    echo "FAILED"
    grep -E '^(error|warning)' /tmp/pc-err.txt | head -5 | sed 's/^/    /'
    status=1
  fi
done
exit $status
