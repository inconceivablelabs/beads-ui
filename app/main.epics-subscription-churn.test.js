import { describe, expect, test, vi } from 'vitest';
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

describe('tab:epics subscription churn', () => {
  test('does not churn while moving between Issues and Epics', async () => {
    window.location.hash = '#/issues';
    document.body.innerHTML = '<main id="app"></main>';
    bootstrap(/** @type {HTMLElement} */ (document.getElementById('app')));
    await flush();
    // Only traffic caused by the navigations below is under test. Asserting on
    // an absence rather than a count also keeps this honest if an earlier test
    // in this file left a bootstrap listening: extra instances would each have
    // to stay quiet too, so leakage cannot mask a regression here.
    sends.length = 0;

    await goto('#/epics');
    await goto('#/issues');

    // One `bd epic status` stream spans both views. If the subscription were
    // torn down and reopened per switch, tab switching would cost a bd
    // invocation each way on top of the refresh traffic.
    expect(sends.filter((s) => s.id === 'tab:epics')).toEqual([]);
  });
});
