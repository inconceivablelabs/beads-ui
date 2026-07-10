import { describe, expect, test } from 'vitest';
import { STATUSES } from '../utils/status.js';
import {
  SORTABLE_COLUMNS,
  cmpPriorityThenCreated,
  makeColumnComparator
} from './sort.js';

/**
 * Sort a copy of `issues` with the given comparator and return their ids.
 *
 * @param {any[]} issues
 * @param {(a: any, b: any) => number} cmp
 * @returns {string[]}
 */
function sortedIds(issues, cmp) {
  return issues
    .slice()
    .sort(cmp)
    .map((it) => String(it.id));
}

describe('data/sort makeColumnComparator', () => {
  test('exposes the sortable columns including created', () => {
    expect(SORTABLE_COLUMNS).toEqual([
      'id',
      'issue_type',
      'title',
      'status',
      'assignee',
      'priority',
      'created'
    ]);
  });

  test('priority ascending sorts low number first, id breaks ties', () => {
    const issues = [
      { id: 'C', priority: 1 },
      { id: 'A', priority: 3 },
      { id: 'B', priority: 1 }
    ];
    expect(sortedIds(issues, makeColumnComparator('priority', 'asc'))).toEqual([
      'B',
      'C',
      'A'
    ]);
  });

  test('priority descending flips the primary order but keeps id tie-break ascending', () => {
    const issues = [
      { id: 'C', priority: 1 },
      { id: 'A', priority: 3 },
      { id: 'B', priority: 1 }
    ];
    expect(sortedIds(issues, makeColumnComparator('priority', 'desc'))).toEqual(
      ['A', 'B', 'C']
    );
  });

  test('missing priority defaults to 2', () => {
    const issues = [
      { id: 'A', priority: 3 },
      { id: 'B' },
      { id: 'C', priority: 1 }
    ];
    expect(sortedIds(issues, makeColumnComparator('priority', 'asc'))).toEqual([
      'C',
      'B',
      'A'
    ]);
  });

  test('status ascending uses canonical rank open < in_progress < closed', () => {
    const issues = [
      { id: 'A', status: 'closed' },
      { id: 'B', status: 'open' },
      { id: 'C', status: 'in_progress' }
    ];
    expect(sortedIds(issues, makeColumnComparator('status', 'asc'))).toEqual([
      'B',
      'C',
      'A'
    ]);
  });

  test('status descending reverses the canonical rank', () => {
    const issues = [
      { id: 'A', status: 'open' },
      { id: 'B', status: 'closed' },
      { id: 'C', status: 'in_progress' }
    ];
    expect(sortedIds(issues, makeColumnComparator('status', 'desc'))).toEqual([
      'B',
      'C',
      'A'
    ]);
  });

  test('status rank covers every canonical status, not just the settable three', () => {
    // Rows are supplied in reverse canonical order so a rank table that only
    // knows open/in_progress/closed cannot pass by accident: the four it does
    // not know would tie at the sentinel and fall back to id ascending.
    const issues = STATUSES.slice()
      .reverse()
      .map((status, i) => ({ id: `I-${i}`, status }));
    expect(sortedIds(issues, makeColumnComparator('status', 'asc'))).toEqual(
      STATUSES.map((_, i) => `I-${STATUSES.length - 1 - i}`)
    );
  });

  test('an unknown status sorts after every canonical status', () => {
    const issues = [
      { id: 'A', status: 'in_review' },
      { id: 'B', status: 'hooked' },
      { id: 'C', status: 'open' }
    ];
    expect(sortedIds(issues, makeColumnComparator('status', 'asc'))).toEqual([
      'C',
      'B',
      'A'
    ]);
  });

  test('title sorts case-insensitively', () => {
    const issues = [
      { id: '1', title: 'banana' },
      { id: '2', title: 'Apple' },
      { id: '3', title: 'cherry' }
    ];
    expect(sortedIds(issues, makeColumnComparator('title', 'asc'))).toEqual([
      '2',
      '1',
      '3'
    ]);
  });

  test('assignee sorts empty values last on ascending', () => {
    const issues = [
      { id: '1', assignee: '' },
      { id: '2', assignee: 'Tom' },
      { id: '3', assignee: 'Ada' }
    ];
    expect(sortedIds(issues, makeColumnComparator('assignee', 'asc'))).toEqual([
      '3',
      '2',
      '1'
    ]);
  });

  test('id column sorts lexically and respects direction', () => {
    const issues = [{ id: 'UI-3' }, { id: 'UI-1' }, { id: 'UI-2' }];
    expect(sortedIds(issues, makeColumnComparator('id', 'asc'))).toEqual([
      'UI-1',
      'UI-2',
      'UI-3'
    ]);
    expect(sortedIds(issues, makeColumnComparator('id', 'desc'))).toEqual([
      'UI-3',
      'UI-2',
      'UI-1'
    ]);
  });

  test('issue_type sorts case-insensitively by type name', () => {
    const issues = [
      { id: '1', issue_type: 'task' },
      { id: '2', issue_type: 'bug' },
      { id: '3', issue_type: 'epic' }
    ];
    expect(
      sortedIds(issues, makeColumnComparator('issue_type', 'asc'))
    ).toEqual(['2', '3', '1']);
  });

  test('created sorts ascending by created_at, id breaks ties', () => {
    const issues = [
      { id: 'A', created_at: 300 },
      { id: 'C', created_at: 100 },
      { id: 'B', created_at: 200 }
    ];
    expect(sortedIds(issues, makeColumnComparator('created', 'asc'))).toEqual([
      'C',
      'B',
      'A'
    ]);
  });

  test('created descending reverses the order', () => {
    const issues = [
      { id: 'A', created_at: 300 },
      { id: 'C', created_at: 100 },
      { id: 'B', created_at: 200 }
    ];
    expect(sortedIds(issues, makeColumnComparator('created', 'desc'))).toEqual([
      'A',
      'B',
      'C'
    ]);
  });

  test('created ties break by id ascending', () => {
    const issues = [
      { id: 'B', created_at: 100 },
      { id: 'A', created_at: 100 }
    ];
    expect(sortedIds(issues, makeColumnComparator('created', 'asc'))).toEqual([
      'A',
      'B'
    ]);
    // Even descending keeps the id tie-break ascending for render stability.
    expect(sortedIds(issues, makeColumnComparator('created', 'desc'))).toEqual([
      'A',
      'B'
    ]);
  });

  test('unknown column falls back to priority-then-created ordering', () => {
    const issues = [
      { id: 'A', priority: 3, created_at: 1 },
      { id: 'B', priority: 1, created_at: 5 },
      { id: 'C', priority: 1, created_at: 2 }
    ];
    const viaColumn = sortedIds(
      issues,
      makeColumnComparator('nonsense', 'asc')
    );
    const viaDefault = sortedIds(issues, cmpPriorityThenCreated);
    expect(viaColumn).toEqual(viaDefault);
    expect(viaColumn).toEqual(['C', 'B', 'A']);
  });
});
