import { describe, expect, test } from 'vitest';
import { createSubscriptionIssueStore } from '../data/subscription-issue-store.js';
import { createListView } from './list.js';

/**
 * Push-store harness that records register/unregister so the tests can assert
 * on store lifecycle, not just on the wire.
 */
function createTestIssueStores() {
  /** @type {Map<string, any>} */
  const stores = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {string[]} */
  const registered = [];
  /** @type {string[]} */
  const unregistered = [];

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
    registered,
    unregistered,
    /** @param {string} id - Subscription client id. */
    register(id) {
      registered.push(id);
      getStore(id);
    },
    /** @param {string} id - Subscription client id. */
    unregister(id) {
      unregistered.push(id);
      stores.delete(id);
    },
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
 * Subscriptions facade recording subscribe/unsubscribe by client id.
 *
 * @param {{ fail_for?: string }} [options] - `fail_for` rejects that client id.
 */
function createTestSubscriptions(options = {}) {
  /** @type {string[]} */
  const subscribed = [];
  /** @type {string[]} */
  const unsubscribed = [];
  return {
    subscribed,
    unsubscribed,
    /**
     * @param {string} client_id - Subscription client id.
     * @returns {Promise<() => Promise<void>>}
     */
    async subscribeList(client_id) {
      if (options.fail_for && client_id === options.fail_for) {
        throw new Error('subscribe failed');
      }
      subscribed.push(client_id);
      return async () => {
        unsubscribed.push(client_id);
      };
    }
  };
}

/**
 * Seed one epic with counters and its delivered children.
 *
 * @param {any} stores - Test store harness.
 * @param {string} epic_id - Epic issue id.
 */
function seedEpic(stores, epic_id) {
  stores.getStore('tab:issues').applyPush({
    type: 'snapshot',
    id: 'tab:issues',
    revision: 1,
    issues: [
      {
        id: epic_id,
        title: 'Epic A',
        status: 'open',
        priority: 1,
        issue_type: 'epic'
      }
    ]
  });
  stores.getStore('tab:epics').applyPush({
    type: 'snapshot',
    id: 'tab:epics',
    revision: 1,
    issues: [{ id: epic_id, total_children: 1, closed_children: 0 }]
  });
}

/**
 * Expand an epic by clicking its chevron.
 *
 * @param {HTMLElement} mount - The container element.
 * @param {string} epic_id - Epic issue id.
 */
async function expandEpic(mount, epic_id) {
  /** @type {HTMLElement} */ (
    mount.querySelector(`[data-epic-id="${epic_id}"] .epic-chevron`)
  ).click();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Mount the list view.
 *
 * @param {HTMLElement} mount - The container element.
 * @param {any} stores - Test store harness.
 * @param {any} subscriptions - Subscriptions facade.
 */
function mountList(mount, stores, subscriptions) {
  return createListView(
    mount,
    async () => null,
    () => {},
    undefined,
    subscriptions,
    stores
  );
}

describe('views/list epic detail-subscription lifecycle', () => {
  test('releaseEpicSubscriptions unsubscribes every expanded epic', async () => {
    document.body.innerHTML = '<aside id="mount" class="panel"></aside>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const stores = createTestIssueStores();
    const subscriptions = createTestSubscriptions();
    seedEpic(stores, 'X-EPIC');
    const view = mountList(mount, stores, subscriptions);
    await view.load();
    await expandEpic(mount, 'X-EPIC');
    expect(subscriptions.subscribed).toContain('detail:X-EPIC');

    await view.releaseEpicSubscriptions();

    expect(subscriptions.unsubscribed).toContain('detail:X-EPIC');
  });

  test('releaseEpicSubscriptions unregisters the detail store', async () => {
    document.body.innerHTML = '<aside id="mount" class="panel"></aside>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const stores = createTestIssueStores();
    const subscriptions = createTestSubscriptions();
    seedEpic(stores, 'X-EPIC');
    const view = mountList(mount, stores, subscriptions);
    await view.load();
    await expandEpic(mount, 'X-EPIC');
    expect(stores.registered).toContain('detail:X-EPIC');

    await view.releaseEpicSubscriptions();

    expect(stores.unregistered).toContain('detail:X-EPIC');
  });

  test('the list renders collapsed again after release', async () => {
    document.body.innerHTML = '<aside id="mount" class="panel"></aside>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const stores = createTestIssueStores();
    const subscriptions = createTestSubscriptions();
    seedEpic(stores, 'X-EPIC');
    const view = mountList(mount, stores, subscriptions);
    await view.load();
    await expandEpic(mount, 'X-EPIC');
    expect(
      mount
        .querySelector('[data-epic-id="X-EPIC"] .epic-chevron')
        ?.getAttribute('aria-expanded')
    ).toBe('true');

    await view.releaseEpicSubscriptions();
    await view.load();

    expect(
      mount
        .querySelector('[data-epic-id="X-EPIC"] .epic-chevron')
        ?.getAttribute('aria-expanded')
    ).toBe('false');
  });

  test('re-expanding after release opens a fresh subscription', async () => {
    document.body.innerHTML = '<aside id="mount" class="panel"></aside>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const stores = createTestIssueStores();
    const subscriptions = createTestSubscriptions();
    seedEpic(stores, 'X-EPIC');
    const view = mountList(mount, stores, subscriptions);
    await view.load();
    await expandEpic(mount, 'X-EPIC');
    await view.releaseEpicSubscriptions();
    await view.load();

    await expandEpic(mount, 'X-EPIC');

    expect(
      subscriptions.subscribed.filter((id) => id === 'detail:X-EPIC')
    ).toHaveLength(2);
  });

  test('collapsing an epic releases its subscription immediately', async () => {
    document.body.innerHTML = '<aside id="mount" class="panel"></aside>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const stores = createTestIssueStores();
    const subscriptions = createTestSubscriptions();
    seedEpic(stores, 'X-EPIC');
    const view = mountList(mount, stores, subscriptions);
    await view.load();
    await expandEpic(mount, 'X-EPIC');
    expect(subscriptions.unsubscribed).toHaveLength(0);

    // Collapsing is its own release point: waiting for route-away would hold a
    // live subscription for an epic the user has already closed.
    await expandEpic(mount, 'X-EPIC');

    expect(subscriptions.unsubscribed).toContain('detail:X-EPIC');
    expect(stores.unregistered).toContain('detail:X-EPIC');
  });

  test('a failed subscribeList unregisters the detail store', async () => {
    document.body.innerHTML = '<aside id="mount" class="panel"></aside>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const stores = createTestIssueStores();
    const subscriptions = createTestSubscriptions({
      fail_for: 'detail:X-EPIC'
    });
    seedEpic(stores, 'X-EPIC');
    const view = mountList(mount, stores, subscriptions);
    await view.load();

    await expandEpic(mount, 'X-EPIC');

    expect(stores.registered).toContain('detail:X-EPIC');
    expect(stores.unregistered).toContain('detail:X-EPIC');
  });

  test('a failed subscribeList retains no subscription to release later', async () => {
    document.body.innerHTML = '<aside id="mount" class="panel"></aside>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const stores = createTestIssueStores();
    const subscriptions = createTestSubscriptions({
      fail_for: 'detail:X-EPIC'
    });
    seedEpic(stores, 'X-EPIC');
    const view = mountList(mount, stores, subscriptions);
    await view.load();
    await expandEpic(mount, 'X-EPIC');
    stores.unregistered.length = 0;

    await view.releaseEpicSubscriptions();

    // Nothing was ever subscribed, so release must not report an unsubscribe
    // and must not unregister a store it already cleaned up.
    expect(subscriptions.unsubscribed).toHaveLength(0);
    expect(stores.unregistered).toHaveLength(0);
  });
});
