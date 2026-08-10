import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bootstrap } from './main.js';

/**
 * Records calls to the Issues view's epic-subscription release hook so the
 * tests can assert that the route and the workspace own that cleanup.
 */
const release_calls = { count: 0 };

vi.mock('./views/list.js', () => ({
  /**
   * @param {HTMLElement} mount - Mount element.
   */
  createListView: (mount) => ({
    async load() {
      mount.innerHTML = '<div class="panel__body list-root"></div>';
    },
    async releaseEpicSubscriptions() {
      release_calls.count += 1;
    },
    destroy() {}
  })
}));

/** @type {Map<string, (payload: any) => void>} */
const ws_handlers = new Map();

vi.mock('./ws.js', () => ({
  createWsClient: () => ({
    /**
     * @param {string} type - Message type.
     */
    async send(type) {
      if (type === 'list-workspaces') {
        return { workspaces: [] };
      }
      return null;
    },
    /**
     * @param {string} type - Event name.
     * @param {(payload: any) => void} fn - Handler.
     */
    on(type, fn) {
      ws_handlers.set(type, fn);
      return () => ws_handlers.delete(type);
    },
    close() {},
    getState() {
      return 'open';
    }
  })
}));

/**
 * Flush the microtask queue a few times so bootstrap's async work settles.
 */
async function flush() {
  for (let i = 0; i < 4; i++) {
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

describe('epic detail subscriptions are released by route and workspace', () => {
  beforeEach(() => {
    release_calls.count = 0;
    ws_handlers.clear();
  });

  test('leaving the Issues view releases them', async () => {
    window.location.hash = '#/issues';
    document.body.innerHTML = '<main id="app"></main>';
    bootstrap(/** @type {HTMLElement} */ (document.getElementById('app')));
    await flush();
    release_calls.count = 0;

    await goto('#/board');

    expect(release_calls.count).toBeGreaterThan(0);
  });

  test('staying on Issues does not release them', async () => {
    window.location.hash = '#/issues';
    document.body.innerHTML = '<main id="app"></main>';
    bootstrap(/** @type {HTMLElement} */ (document.getElementById('app')));
    await flush();
    release_calls.count = 0;

    await goto('#/issues');

    expect(release_calls.count).toBe(0);
  });

  test('a workspace change releases them', async () => {
    window.location.hash = '#/issues';
    document.body.innerHTML = '<main id="app"></main>';
    bootstrap(/** @type {HTMLElement} */ (document.getElementById('app')));
    await flush();
    release_calls.count = 0;

    const handler = ws_handlers.get('workspace-changed');
    expect(handler).toBeTruthy();
    /** @type {(payload: any) => void} */ (handler)({
      root_dir: '/other/workspace',
      db_path: '/other/workspace/.beads/beads.db'
    });
    await flush();

    expect(release_calls.count).toBeGreaterThan(0);
  });
});
