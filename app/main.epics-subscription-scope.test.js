import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bootstrap } from './main.js';

/**
 * Records every subscribe/unsubscribe the client sends, so the tests can
 * assert which lists are actually open per view rather than which ones the
 * code appears to register.
 *
 * @type {{ type: string, id: string }[]}
 */
const sends = [];

vi.mock('./views/list.js', () => ({
  /**
   * @param {HTMLElement} mount - Mount element.
   */
  createListView: (mount) => ({
    async load() {
      mount.innerHTML = '<div class="panel__body list-root"></div>';
    },
    async releaseEpicSubscriptions() {},
    destroy() {}
  })
}));

vi.mock('./ws.js', () => ({
  createWsClient: () => ({
    /**
     * @param {string} type - Message type.
     * @param {any} payload - Message payload.
     */
    async send(type, payload) {
      if (type === 'subscribe-list' || type === 'unsubscribe-list') {
        sends.push({ type, id: payload?.id });
      }
      if (type === 'list-workspaces') {
        return { workspaces: [] };
      }
      return null;
    },
    on() {
      return () => {};
    },
    close() {},
    getState() {
      return 'open';
    }
  })
}));

/**
 * Flush the microtask queue so bootstrap's async subscribe work settles.
 */
async function flush() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

/**
 * Navigate via the hash router.
 *
 * @param {string} hash - Target hash.
 */
async function goto(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flush();
}

/**
 * Is `tab:epics` currently subscribed, per the recorded wire traffic?
 */
function epicsOpen() {
  let open = false;
  for (const s of sends) {
    if (s.id !== 'tab:epics') continue;
    open = s.type === 'subscribe-list';
  }
  return open;
}

describe('tab:epics subscription scope', () => {
  beforeEach(() => {
    sends.length = 0;
  });

  test('is open on the Epics view', async () => {
    window.location.hash = '#/epics';
    document.body.innerHTML = '<main id="app"></main>';
    bootstrap(/** @type {HTMLElement} */ (document.getElementById('app')));
    await flush();

    expect(epicsOpen()).toBe(true);
  });

  test('is open on the Issues view, which reads the progress counters', async () => {
    window.location.hash = '#/issues';
    document.body.innerHTML = '<main id="app"></main>';
    bootstrap(/** @type {HTMLElement} */ (document.getElementById('app')));
    await flush();

    expect(epicsOpen()).toBe(true);
  });

  test('is released on the Board view', async () => {
    window.location.hash = '#/issues';
    document.body.innerHTML = '<main id="app"></main>';
    bootstrap(/** @type {HTMLElement} */ (document.getElementById('app')));
    await flush();
    expect(epicsOpen()).toBe(true);

    await goto('#/board');

    // The bound on the added cost: Issues extends the subscription's lifetime
    // to a second view, it does not make it permanent.
    expect(epicsOpen()).toBe(false);
  });
});
