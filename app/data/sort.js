/**
 * Shared sort comparators for issues lists.
 * Centralizes sorting so views and stores stay consistent.
 */
/**
 * @import { Status } from '../protocol.js'
 */
import { STATUSES } from '../utils/status.js';

/**
 * @typedef {{ id: string, title?: string, status?: Status, priority?: number, issue_type?: string, created_at?: number, updated_at?: number, closed_at?: number }} IssueLite
 */

/**
 * Compare by priority asc, then created_at asc, then id asc.
 *
 * @param {IssueLite} a
 * @param {IssueLite} b
 */
export function cmpPriorityThenCreated(a, b) {
  const pa = a.priority ?? 2;
  const pb = b.priority ?? 2;
  if (pa !== pb) {
    return pa - pb;
  }
  const ca = a.created_at ?? 0;
  const cb = b.created_at ?? 0;
  if (ca !== cb) {
    return ca < cb ? -1 : 1;
  }
  const ida = a.id;
  const idb = b.id;
  return ida < idb ? -1 : ida > idb ? 1 : 0;
}

/**
 * Compare by closed_at desc, then id asc for stability.
 *
 * @param {IssueLite} a
 * @param {IssueLite} b
 */
export function cmpClosedDesc(a, b) {
  const ca = a.closed_at ?? 0;
  const cb = b.closed_at ?? 0;
  if (ca !== cb) {
    return ca < cb ? 1 : -1;
  }
  const ida = a?.id;
  const idb = b?.id;
  return ida < idb ? -1 : ida > idb ? 1 : 0;
}

/**
 * Columns the Issues list can be sorted by via column headers.
 *
 * @type {Array<'id'|'issue_type'|'title'|'status'|'assignee'|'priority'>}
 */
export const SORTABLE_COLUMNS = [
  'id',
  'issue_type',
  'title',
  'status',
  'assignee',
  'priority'
];

// Canonical status rank, derived from the single status vocabulary so a new
// bd status is ranked the day it lands rather than silently bunching at the
// sentinel. Unknown statuses still sort after every known one.
/** @type {Map<string, number>} */
const STATUS_RANK = new Map(STATUSES.map((s, i) => [s, i]));

/**
 * Stable id comparison (ascending) used as the final tie-break so rows never
 * jitter between renders regardless of the active sort direction.
 *
 * @param {IssueLite} a
 * @param {IssueLite} b
 */
function cmpIdAsc(a, b) {
  const ida = String(a?.id ?? '');
  const idb = String(b?.id ?? '');
  return ida < idb ? -1 : ida > idb ? 1 : 0;
}

/**
 * Extract the primary sort key for a column. Returns a value comparable with
 * `<`/`>`: a number for priority/status, a lowercased string otherwise. Empty
 * strings sort last on ascending order by mapping to a high sentinel.
 *
 * @param {IssueLite} issue
 * @param {'id'|'issue_type'|'title'|'status'|'assignee'} column
 * @returns {number | string}
 */
function columnKey(issue, column) {
  switch (column) {
    case 'status': {
      const rank = STATUS_RANK.get(String(issue.status ?? ''));
      return rank === undefined ? Number.MAX_SAFE_INTEGER : rank;
    }
    case 'id':
      return String(issue.id ?? '').toLowerCase();
    case 'issue_type':
      return String(issue.issue_type ?? '').toLowerCase();
    case 'title':
      return String(issue.title ?? '').toLowerCase();
    case 'assignee': {
      const v = String(/** @type {any} */ (issue).assignee ?? '').toLowerCase();
      // Empty assignees sort last on ascending (use a sentinel above any text).
      return v === '' ? '￿' : v;
    }
    default:
      return '';
  }
}

/**
 * Build a comparator for a single column + direction. Priority and status use
 * numeric ranks; all other columns compare lowercased strings. Ties always
 * break by id ascending (unscaled) for render stability. An unrecognized column
 * falls back to {@link cmpPriorityThenCreated}.
 *
 * @param {string} column
 * @param {'asc'|'desc'} [direction]
 * @returns {(a: IssueLite, b: IssueLite) => number}
 */
export function makeColumnComparator(column, direction = 'asc') {
  if (!SORTABLE_COLUMNS.includes(/** @type {any} */ (column))) {
    return cmpPriorityThenCreated;
  }
  const mult = direction === 'desc' ? -1 : 1;
  return (a, b) => {
    let primary = 0;
    if (column === 'priority') {
      const pa = a.priority ?? 2;
      const pb = b.priority ?? 2;
      primary = pa - pb;
    } else {
      const ka = columnKey(a, /** @type {any} */ (column));
      const kb = columnKey(b, /** @type {any} */ (column));
      primary = ka < kb ? -1 : ka > kb ? 1 : 0;
    }
    if (primary !== 0) {
      return primary * mult;
    }
    return cmpIdAsc(a, b);
  };
}
