/**
 * What someone means when they type a location into the path bar.
 *
 * A pane is either on this machine or on a host, and until now the path bar
 * could only move within whichever it already was — so a pane that had been
 * connected to a host could not be brought back, whatever you typed. The scope
 * has to be expressible where the location is typed.
 */
export type Location =
  /** Explicitly this machine: `local:/var/log`. */
  | { scope: "local"; path: string }
  /** A named host: `build:/srv`. The alias must be one that is known. */
  | { scope: "remote"; alias: string; path: string }
  /** No prefix — wherever the pane already is. */
  | { scope: "current"; path: string };

/** The word that means this machine, so there is a way back by typing. */
export const LOCAL_SCOPE = "local";

/**
 * Reads `alias:path`, `local:path`, or a bare path.
 *
 * A bare path deliberately means *stay where you are*. Someone on a host typing
 * `/var/log` means that host's `/var/log`; sending them home instead would be a
 * worse bug than the one this fixes.
 *
 * An alias is only recognised when it is one the user has actually saved. That
 * keeps `C:\Users` on Windows a path rather than a host called `C`, and means a
 * file named `notes:draft` in a relative path is not mistaken for a host
 * either — guessing from the shape of the string cannot distinguish those.
 */
export function parseLocation(input: string, knownAliases: readonly string[]): Location {
  const trimmed = input.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return { scope: "current", path: trimmed };

  const prefix = trimmed.slice(0, colon);
  const rest = trimmed.slice(colon + 1);

  if (prefix === LOCAL_SCOPE) return { scope: "local", path: rest || "/" };
  if (knownAliases.includes(prefix)) return { scope: "remote", alias: prefix, path: rest };

  // Not a scope at all: a Windows drive, or a path that happens to contain a
  // colon. Left alone rather than guessed at.
  return { scope: "current", path: trimmed };
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
