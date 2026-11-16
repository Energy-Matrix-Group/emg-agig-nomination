// Nominated quantities, in TJ with at most three decimals.
//
// They are added up and compared with a capacity or a Spot award, so they are kept as whole thousandths of a TJ
// (an integer, "milli") while the app works with them, and written back as text with exactly three decimals.
// Floating point would make 0.1 + 0.2 land a hair over 0.3, and a capacity check must not fail on that.

const MAX_MILLI = 999_999_999_999; // decimal(12,3) holds up to 999,999,999.999
const NUMBER = /^(\d+(\.\d*)?|\.\d+)$/; // 12, 12., 12.5, .5

// Reads a quantity typed or pasted by a person. Answers { milli } or { error } in words for the Check column.
export function parseQuantity(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return { error: 'Quantity is missing.' };
  // Excel copies what it shows, so 1,234.5 arrives with its thousands separator.
  if (/^-?\d{1,3}(,\d{3})+(\.\d*)?$/.test(text)) text = text.replaceAll(',', '');
  if (NUMBER.test(text.replace(/^-/, '')) && text.startsWith('-')) return { error: 'Quantity cannot be negative.' };
  if (!NUMBER.test(text)) return { error: `Quantity "${String(raw).trim().slice(0, 20)}" is not a number.` };
  const [whole, fraction = ''] = text.split('.');
  const decimals = fraction.replace(/0+$/, '');
  if (decimals.length > 3) return { error: 'Quantity has more than 3 decimals.' };
  const milli = Number(whole || '0') * 1000 + Number(decimals.padEnd(3, '0') || '0');
  if (!Number.isSafeInteger(milli) || milli > MAX_MILLI) return { error: 'Quantity is too large.' };
  return { milli };
}

export function formatMilli(milli) {
  const sign = milli < 0 ? '-' : '';
  const absolute = Math.abs(milli);
  return `${sign}${Math.floor(absolute / 1000)}.${String(absolute % 1000).padStart(3, '0')}`;
}

// A stored quantity (text such as '12.345', or the number the SQL driver gives for a decimal(12,3)) as milli.
export function toMilli(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseQuantity(typeof value === 'number' ? value.toFixed(3) : value);
  return parsed.error ? null : parsed.milli;
}

// A stored quantity as the three-decimal text the API and the CSV use.
export function quantityText(value) {
  const milli = toMilli(value);
  return milli === null ? null : formatMilli(milli);
}
