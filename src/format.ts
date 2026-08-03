/**
 * Column formatting. Both of these sit in a narrow column next to the filename,
 * which is the thing people actually scan, so they are kept short enough not to
 * crowd it.
 */

/** `1.5 KB`. Sizes stay in familiar units rather than going fully compact. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = bytes / Math.pow(k, i);
  // One decimal only below 10, so "9.4 MB" but "24 MB" rather than "24.3 MB".
  const rounded = value >= 10 || i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${sizes[i]}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `14:35` for today, `07-30` within this year, `26-07-30` beyond it.
 *
 * Dropping the parts that are implied keeps the common cases to five characters.
 * The numeric form is deliberate: `07-30` is unambiguous, where a localised short
 * date is read as either July 30th or the 7th of October depending on where the
 * reader is from.
 *
 * `now` is a parameter so this can be tested without depending on the clock.
 */
export function formatTimestamp(ms: number | null, now: Date = new Date()): string {
  if (ms === null || ms === undefined) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";

  const sameYear = d.getFullYear() === now.getFullYear();
  const sameDay =
    sameYear && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();

  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const monthDay = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (sameYear) return monthDay;

  return `${pad(d.getFullYear() % 100)}-${monthDay}`;
}

/**
 * A count with thousands separated: "12,345".
 *
 * Grouped explicitly rather than through toLocaleString, whose output follows
 * the host locale and would make the column's width — and its tests —
 * depend on where the machine happens to be.
 */
export function formatCount(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
