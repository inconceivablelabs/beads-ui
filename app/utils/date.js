/**
 * Date formatting helpers for the Issues list.
 *
 * Inputs are epoch milliseconds (as `created_at` reaches the client). All
 * helpers guard against null / undefined / non-finite / non-positive values so
 * an unset timestamp renders as an empty cell rather than "1970" or "Invalid
 * Date".
 */

/**
 * Format an epoch-ms timestamp as a local-time `yyyy-mm-dd` string.
 *
 * Uses local calendar fields (not a `toISOString` slice) so a late-night issue
 * shows the day the user created it, not a UTC-shifted day.
 *
 * @param {number | undefined | null} ms - Epoch milliseconds.
 * @returns {string} `yyyy-mm-dd`, or `''` for invalid input.
 */
export function formatDateYmd(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    return '';
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format an epoch-ms timestamp as a full ISO string (for hover tooltips).
 *
 * @param {number | undefined | null} ms - Epoch milliseconds.
 * @returns {string} ISO 8601 string, or `''` for invalid input.
 */
export function formatDateIso(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    return '';
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  return d.toISOString();
}
