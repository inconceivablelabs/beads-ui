import { describe, expect, test } from 'vitest';
import { createSubscriptionIssueStore } from '../data/subscription-issue-store.js';
import { createListView } from './list.js';

/**
 * Minimal push-store harness (mirrors the one in list.test.js).
 */
function createTestIssueStores() {
  /** @type {Map<string, any>} */
  const stores = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();

  /**
   * @param {string} id - Subscription client id.
   * @returns {any}
   */
  function getStore(id) {
    let s = stores.get(id);
    if (!s) {
      s = createSubscriptionIssueStore(id);
      stores.set(id, s);
      s.subscribe(() => {
        for (const fn of Array.from(listeners)) {
          try {
            fn();
          } catch {
            /* ignore */
          }
        }
      });
    }
    return s;
  }

  return {
    getStore,
    /** @param {string} id - Subscription client id. */
    snapshotFor(id) {
      return getStore(id).snapshot().slice();
    },
    /** @param {() => void} fn - Change listener. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

/**
 * Seed `tab:issues` with the given rows.
 *
 * @param {any} stores - Test store harness.
 * @param {any[]} issues - Rows to publish.
 */
function seed(stores, issues) {
  stores.getStore('tab:issues').applyPush({
    type: 'snapshot',
    id: 'tab:issues',
    revision: 1,
    issues
  });
  stores.getStore('tab:epics').applyPush({
    type: 'snapshot',
    id: 'tab:epics',
    revision: 1,
    issues: issues
      .filter((i) => i.issue_type === 'epic')
      .map((i) => ({ id: i.id, total_children: 0, closed_children: 0 }))
  });
}

/**
 * Click a status checkbox in the status dropdown.
 *
 * @param {HTMLElement} mount - The container element.
 * @param {string} label - Visible label of the checkbox.
 */
function toggleStatus(mount, label) {
  const dropdown = mount.querySelectorAll('.filter-dropdown')[0];
  const option = Array.from(
    dropdown.querySelectorAll('.filter-dropdown__option--status')
  ).find((opt) => (opt.textContent || '').trim() === label);
  const checkbox = /** @type {HTMLInputElement} */ (
    option?.querySelector('input[type="checkbox"]')
  );
  checkbox.click();
}

/**
 * Rendered row ids, top to bottom.
 *
 * @param {HTMLElement} mount - The container element.
 */
function rowIds(mount) {
  return Array.from(mount.querySelectorAll('[data-issue-id]')).map((el) =>
    el.getAttribute('data-issue-id')
  );
}

/**
 * Mount the list view.
 *
 * @param {HTMLElement} mount - The container element.
 * @param {any} stores - Test store harness.
 */
function mountList(mount, stores) {
  return createListView(
    mount,
    async () => null,
    () => {},
    undefined,
    undefined,
    stores
  );
}

describe('views/list row ordering through the epic merge', () => {
  test('a closed-only list stays newest-first', async () => {
    document.body.innerHTML = '<aside id="mount" class="panel"></aside>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const stores = createTestIssueStores();
    // closed_at deliberately disagrees with priority, so the two comparators
    // produce exactly reversed orders and the assertion can tell them apart.
    seed(stores, [
      {
        id: 'X-EPIC',
        title: 'Epic',
        status: 'closed',
        priority: 1,
        issue_type: 'epic',
        closed_at: 100
      },
      {
        id: 'X-MID',
        title: 'Mid',
        status: 'closed',
        priority: 2,
        issue_type: 'task',
        closed_at: 200
      },
      {
        id: 'X-NEW',
        title: 'Newest',
        status: 'closed',
        priority: 3,
        issue_type: 'task',
        closed_at: 300
      }
    ]);
    const view = mountList(mount, stores);
    await view.load();

    toggleStatus(mount, 'Closed');
    await Promise.resolve();

    expect(rowIds(mount)).toEqual(['X-NEW', 'X-MID', 'X-EPIC']);
  });

  test('the default list keeps priority order with epics interleaved', async () => {
    document.body.innerHTML = '<aside id="mount" class="panel"></aside>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const stores = createTestIssueStores();
    seed(stores, [
      {
        id: 'X-P1',
        title: 'First',
        status: 'open',
        priority: 1,
        issue_type: 'task'
      },
      {
        id: 'X-EPIC',
        title: 'Epic in the middle',
        status: 'open',
        priority: 2,
        issue_type: 'epic'
      },
      {
        id: 'X-P3',
        title: 'Last',
        status: 'open',
        priority: 3,
        issue_type: 'task'
      }
    ]);
    const view = mountList(mount, stores);
    await view.load();

    // The epic sorts by its own priority rather than clumping with other
    // epics at the top, which is what the partition would do unaided.
    expect(rowIds(mount)).toEqual(['X-P1', 'X-EPIC', 'X-P3']);
  });

  test('children are hidden from the top level without disturbing order', async () => {
    document.body.innerHTML = '<aside id="mount" class="panel"></aside>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const stores = createTestIssueStores();
    seed(stores, [
      {
        id: 'X-P1',
        title: 'First',
        status: 'open',
        priority: 1,
        issue_type: 'task'
      },
      {
        id: 'X-EPIC',
        title: 'Epic',
        status: 'open',
        priority: 2,
        issue_type: 'epic'
      },
      {
        id: 'X-KID',
        title: 'Child',
        status: 'open',
        priority: 2,
        issue_type: 'task',
        parent: 'X-EPIC'
      },
      {
        id: 'X-P3',
        title: 'Last',
        status: 'open',
        priority: 3,
        issue_type: 'task'
      }
    ]);
    const view = mountList(mount, stores);
    await view.load();

    expect(rowIds(mount)).toEqual(['X-P1', 'X-EPIC', 'X-P3']);
  });
});
