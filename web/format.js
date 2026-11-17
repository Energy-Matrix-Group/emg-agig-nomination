// How the pages write dates and times: yyyy-mm-dd hh:mm:ss in Perth time (AWST), and a Gas Day as yyyy-mm-dd
// (Eve, 17 November 2026: "All date to be yyyy-mm-dd hh:mm:ss"). WA has no daylight saving, so AWST is always
// UTC+8 and a fixed offset is exact. Pure, so test/web/format.test.js runs it without a browser.

const AWST_MS = 8 * 60 * 60 * 1000;

// "2026-11-17 14:05:09" in Perth time, from an ISO instant; empty for none.
export function when(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + AWST_MS).toISOString().replace('T', ' ').slice(0, 19);
}

// A Gas Day, already yyyy-mm-dd, as it is.
export function gasDay(day) {
  return day ?? '';
}

// "in 3 h 59 min", "12 min ago", "in 2 days": how far an instant is from now.
export function relative(iso, now = Date.now()) {
  if (!iso) return '';
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  const size = Math.abs(minutes);
  const words = size < 60 ? `${size} min` : size < 48 * 60 ? `${Math.floor(size / 60)} h ${size % 60} min` : `${Math.round(size / 1440)} days`;
  return minutes >= 0 ? `in ${words}` : `${words} ago`;
}

// How long from one instant to another: "6 min", "1 h 12 min"; empty when either is missing.
export function took(from, to) {
  if (!from || !to) return '';
  const minutes = Math.round((new Date(to) - new Date(from)) / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
