/**
 * Matching hosts against a typed query.
 *
 * Its own module rather than living beside the dialog: React Fast Refresh only
 * handles a file whose exports are all components, so a component sitting next
 * to plain functions invalidated the module on every edit. That put the running
 * page into stale state repeatedly, which cost more than one debugging session
 * chasing bugs that were not in the code.
 */

/**
 * True when every whitespace-separated term appears somewhere in the name.
 *
 * Terms rather than one substring because host names are usually structured —
 * `prod-web-01`, `staging-db-eu` — so "prod db" should find the production
 * database without needing the parts in order or remembering the separator.
 */
export function matchesHost(host: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const name = host.toLowerCase();
  return terms.every((t) => name.includes(t));
}

export function filterHosts(hosts: string[], query: string): string[] {
  return hosts.filter((h) => matchesHost(h, query));
}
