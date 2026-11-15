// How long ago something was copied, as short as it reads: "30s ago",
// "3mins ago", "4h ago", "3d ago". The Mac and the phone show the same.

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const week = 7 * day;
const month = 30 * day;
const year = 365 * day;

/** `time` and `now` in ms since the epoch. A time not yet a second old, or
 *  ahead of a clock that was set back, is "now". */
export function shortTimeAgo(time: number, now: number): string {
  const age = now - time;
  if (age < second) return "now";
  if (age < minute) return `${Math.floor(age / second)}s ago`;
  if (age < hour) {
    const minutes = Math.floor(age / minute);
    return `${minutes}${minutes === 1 ? "min" : "mins"} ago`;
  }
  if (age < day) return `${Math.floor(age / hour)}h ago`;
  if (age < week) return `${Math.floor(age / day)}d ago`;
  if (age < month) return `${Math.floor(age / week)}w ago`;
  if (age < year) return `${Math.floor(age / month)}mo ago`;
  return `${Math.floor(age / year)}y ago`;
}
