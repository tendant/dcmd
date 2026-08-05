/**
 * What someone means when they type a location into the path bar.
 *
 * A pane is either on this machine or on a host, and until now the path bar
 * could only move within whichever it already was — so a pane that had been
 * connected to a host could not be brought back, whatever you typed. The scope
 * has to be expressible where the location is typed.
 */
export type Location =
  /** This machine. A bare path, or an explicit `local:/var/log`. */
  | { scope: "local"; path: string }
  /** A named host: `build:/srv`. The alias must be one that is known. */
  | { scope: "remote"; alias: string; path: string };

/** The word that means this machine, kept for when being explicit reads better. */
export const LOCAL_SCOPE = "local";

/**
 * Reads `alias:path`, `local:path`, or a bare path.
 *
 * A bare path means this machine. What is in the field is the whole location,
 * so removing the host from it is how you say "not that host" — the obvious
 * reading, and the one people reach for.
 *
 * That is only safe because editing the field does not silently drop the host:
 * `⌘L` selects the path and leaves the prefix, so typing a new path stays on
 * the machine you are on. Removing the prefix has to be deliberate. The two
 * behaviours are a pair; changing either alone makes typing a path jump
 * machines by accident.
 *
 * An alias is only recognised when it is one the user has actually saved. That
 * keeps `C:\Users` on Windows a path rather than a host called `C`, and a file
 * named `notes:draft` a file — guessing from the shape of the string cannot
 * distinguish those.
 */
export function parseLocation(input: string, knownAliases: readonly string[]): Location {
  const trimmed = input.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return { scope: "local", path: trimmed };

  const prefix = trimmed.slice(0, colon);
  const rest = trimmed.slice(colon + 1);

  if (prefix === LOCAL_SCOPE) return { scope: "local", path: rest || "/" };
  if (knownAliases.includes(prefix)) return { scope: "remote", alias: prefix, path: rest };

  // Not a scope at all: a Windows drive, or a path that happens to contain a
  // colon. A path on this machine, then, and left exactly as typed.
  return { scope: "local", path: trimmed };
}

/**
 * Turns a leading `~` into the home directory.
 *
 * `~` is a shell convention, not a filesystem one: nothing below this expands
 * it, so an unexpanded one is looked up as a directory that happens to be named
 * `~` and reported as missing. A host pane already resolved it — SFTP has the
 * same problem and `resolve_path` handles it there — which left the same input
 * working on a server and failing at home.
 *
 * Only `~` and `~/…` are expanded. `~someone` needs a lookup of that user's
 * home directory, which is not something this can answer, so it is left alone
 * to fail honestly rather than being turned into the wrong path.
 */
export function expandHome(path: string, home: string): string {
  if (!home) return path;
  if (path === "~") return home;
  if (path.startsWith("~/")) return home + path.slice(1);
  return path;
}

/**
 * How a location reads back, for the path bar and for titles.
 *
 * Local paths carry no prefix: that is the ordinary case and prefixing it would
 * make every path noisier to serve the rarer one.
 */
export function formatLocation(alias: string | null, path: string): string {
  return alias ? `${alias}:${path}` : path;
}
