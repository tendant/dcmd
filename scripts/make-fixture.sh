#!/usr/bin/env bash
# Builds a sandbox for exercising copy/move by hand: nested folders, and a
# deliberate partial overlap so some items collide and some do not.
#
#   ./scripts/make-fixture.sh          # rebuild in /tmp/dcmd-fixture
#   ./scripts/make-fixture.sh ~/scratch/fx
#
# Point the left pane at <root>/left and the right pane at <root>/right.
# Re-run to reset after a destructive test.
set -euo pipefail

ROOT="${1:-/tmp/dcmd-fixture}"
LEFT="$ROOT/left"
RIGHT="$ROOT/right"

# Refuse to clobber anything that is not obviously ours.
if [ -e "$ROOT" ] && [ ! -e "$ROOT/.dcmd-fixture" ]; then
  echo "Refusing to overwrite $ROOT: no .dcmd-fixture marker." >&2
  echo "Delete it yourself, or pass a different path." >&2
  exit 1
fi

rm -rf "$ROOT"
mkdir -p "$LEFT" "$RIGHT"
touch "$ROOT/.dcmd-fixture"

# ---- left: the source ----------------------------------------------------
echo "unique to left" > "$LEFT/only-left.txt"
echo "LEFT version"   > "$LEFT/collides.txt"

mkdir -p "$LEFT/deep/one/two/three"
echo "top"    > "$LEFT/deep/top.txt"
echo "bottom" > "$LEFT/deep/one/two/three/bottom.txt"
for i in $(seq 1 40); do echo "file $i" > "$LEFT/deep/one/f$i.txt"; done

# A folder whose name collides, but whose contents differ. Replacing discards
# the right-hand file entirely; Keep both preserves it alongside.
mkdir -p "$LEFT/shared-name"
echo "from left" > "$LEFT/shared-name/left-only.txt"

# Awkward names worth exercising.
mkdir -p "$LEFT/edge cases"
echo "spaces"  > "$LEFT/edge cases/a file with spaces.txt"
echo "dotfile" > "$LEFT/edge cases/.hidden"
echo "unicode" > "$LEFT/edge cases/naïve—café.txt"
echo "noext"   > "$LEFT/edge cases/README"

# Something big enough that progress is visible and cancellable.
mkdir -p "$LEFT/bulk"
for i in $(seq 1 800); do head -c 20000 /dev/urandom > "$LEFT/bulk/blob$i.bin"; done

# ---- right: the destination, overlapping in part -------------------------
echo "RIGHT version" > "$RIGHT/collides.txt"
mkdir -p "$RIGHT/shared-name"
echo "from right" > "$RIGHT/shared-name/right-only.txt"
echo "untouched"  > "$RIGHT/only-right.txt"

cat <<EOF

Fixture ready: $ROOT

  left pane  -> $LEFT
  right pane -> $RIGHT

Collides:      collides.txt, shared-name/
Left only:     only-left.txt, deep/, edge cases/, bulk/
Right only:    only-right.txt

Worth checking, selecting several items at once so the conflict is partial:

  Skip       non-colliding items arrive; collides.txt still says "RIGHT version";
             shared-name/right-only.txt survives
  Keep both  "collides copy.txt" and "shared-name copy/" appear beside the originals
  Replace    collides.txt becomes "LEFT version", and shared-name/right-only.txt
             is GONE — replace is wholesale, not a merge
  Cancel     start a copy of bulk/, press Esc; the destination must not be left
             with a half-written bulk/ presented as complete

  Move       repeat with move: whatever is skipped or fails must still be in the
             left pane afterwards, never missing from both

EOF
