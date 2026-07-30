#!/usr/bin/env bash
# Cross-compile the platform-specific filesystem code for Linux and Windows.
#
# `cargo check --target` cannot be run on the real crate from a Mac: tauri-winres
# needs llvm-rc for the Windows resource step. So the two files that contain
# cfg-gated code are extracted into a throwaway crate and checked there, which is
# enough to catch the unused import or wrong symbol that only that platform sees.
#
# This is what CI does properly, on real runners. Run it before pushing changes
# to cfg-gated code so the round trip is seconds rather than a red build.
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

status=0
for target in x86_64-unknown-linux-gnu x86_64-unknown-linux-musl x86_64-pc-windows-msvc; do
  printf '%-32s ' "$target"
  if (cd "$WORK" && RUSTFLAGS="-D warnings" cargo check --quiet --target "$target" 2>/tmp/pc-err.txt); then
    echo "ok"
  else
    echo "FAILED"
    grep -E '^(error|warning)' /tmp/pc-err.txt | head -5 | sed 's/^/    /'
    status=1
  fi
done
exit $status
