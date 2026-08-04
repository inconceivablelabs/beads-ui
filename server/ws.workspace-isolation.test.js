import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { runBd } from './bd.js';
import { fetchListForSubscription } from './list-adapters.js';
import { keyOf, registry } from './subscriptions.js';
import { attachWsServer, handleMessage, scheduleListRefresh } from './ws.js';

// The adapter mock derives its items from the cwd it is handed, so a
// subscription that runs against the wrong workspace is directly observable
// in the ids the client receives.
vi.mock('./list-adapters.js', () => ({
  fetchListForSubscription: vi.fn(async (_spec, options) => {
    const cwd = String((options && options.cwd) || 'no-cwd');
    const tag = cwd.split('/').filter(Boolean).pop() || 'no-cwd';
    const items = [{ id: `${tag}-1`, updated_at: 1, closed_at: null }];
    if (EXTRA_ITEM) {
      items.push({ id: `${tag}-2`, updated_at: 1, closed_at: null });
    }
    return { ok: true, items };
  })
}));

vi.mock('./bd.js', () => ({
  runBd: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
  runBdJson: vi.fn(async () => ({
    code: 0,
    stdoutJson: { id: 'X' },
    stderr: ''
  })),
  getGitUserName: vi.fn(async () => 'tester')
}));

/** When true, the adapter reports a second issue (simulates a new issue). */
let EXTRA_ITEM = false;

/**
 * Create a workspace root with a `.beads/<name>.db` so that
 * `resolveWorkspaceDatabase` resolves a distinct db path per root.
 *
 * @param {string} label
 * @returns {string}
 */
function makeWorkspaceRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bdui-${label}-`));
  fs.mkdirSync(path.join(root, '.beads'), { recursive: true });
  fs.writeFileSync(path.join(root, '.beads', `${label}.db`), '');
  return fs.realpathSync(root);
}

const root1 = makeWorkspaceRoot('ws1');
const root2 = makeWorkspaceRoot('ws2');
const root3 = makeWorkspaceRoot('ws3');
const tag1 = path.basename(root1);
const tag2 = path.basename(root2);

/**
 * Minimal WebSocket stand-in that records what the server sent.
 */
function makeSocket() {
  return {
    sent: /** @type {string[]} */ ([]),
    readyState: 1,
    OPEN: 1,
    /** @param {string} msg */
    send(msg) {
      this.sent.push(String(msg));
    }
  };
}

/**
 * @param {ReturnType<typeof makeSocket>} sock
 * @param {string} type
 * @param {unknown} payload
 */
async function send(sock, type, payload) {
  await handleMessage(
    /** @type {any} */ (sock),
    Buffer.from(
      JSON.stringify({ id: `req-${type}-${Date.now()}`, type, payload })
    )
  );
}

/**
 * Parse every envelope a socket received.
 *
 * @param {ReturnType<typeof makeSocket>} sock
 */
function envelopes(sock) {
  return sock.sent
    .map((m) => {
      try {
        return JSON.parse(m);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * The reply to the most recent request on a socket.
 *
 * @param {ReturnType<typeof makeSocket>} sock
 */
function lastReply(sock) {
  return JSON.parse(sock.sent[sock.sent.length - 1]);
}

/**
 * All issue ids the socket was told about, from any envelope kind.
 *
 * @param {ReturnType<typeof makeSocket>} sock
 * @returns {string[]}
 */
function receivedIssueIds(sock) {
  /** @type {string[]} */
  const ids = [];
  for (const e of envelopes(sock)) {
    const p = e && e.payload;
    if (!p) continue;
    if (Array.isArray(p.issues)) {
      for (const it of p.issues) {
        if (it && typeof it.id === 'string') ids.push(it.id);
      }
    }
    if (p.issue && typeof p.issue.id === 'string') ids.push(p.issue.id);
    if (typeof p.issue_id === 'string') ids.push(p.issue_id);
  }
  return ids;
}

/**
 * Attach a ws server rooted at `root_dir`.
 *
 * @param {string} root_dir
 */
function attach(root_dir) {
  const server = createServer();
  return attachWsServer(server, {
    path: '/ws',
    heartbeat_ms: 10000,
    refresh_debounce_ms: 5,
    root_dir
  });
}

describe('per-connection workspace isolation', () => {
  beforeEach(() => {
    EXTRA_ITEM = false;
    registry.clear();
    vi.clearAllMocks();
  });

  test('two connections on different workspaces keep their own data', async () => {
    const { wss } = attach(root1);
    const a = makeSocket();
    const b = makeSocket();
    wss.clients.add(/** @type {any} */ (a));
    wss.clients.add(/** @type {any} */ (b));

    // A subscribes on the inherited default workspace (root1).
    await send(a, 'subscribe-list', { id: 'c-a', type: 'all-issues' });
    // B switches to root2 and subscribes to the very same spec type.
    await send(b, 'set-workspace', { path: root2 });
    await send(b, 'subscribe-list', { id: 'c-b', type: 'all-issues' });

    expect(receivedIssueIds(a)).toEqual([`${tag1}-1`]);
    expect(receivedIssueIds(b)).toEqual([`${tag2}-1`]);

    // A refresh must publish each connection's own workspace, not one shared set.
    a.sent = [];
    b.sent = [];
    EXTRA_ITEM = true;
    vi.useFakeTimers();
    scheduleListRefresh();
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();

    const a_ids = receivedIssueIds(a);
    const b_ids = receivedIssueIds(b);
    expect(a_ids).toContain(`${tag1}-2`);
    expect(b_ids).toContain(`${tag2}-2`);
    expect(a_ids.every((id) => id.startsWith(tag1))).toBe(true);
    expect(b_ids.every((id) => id.startsWith(tag2))).toBe(true);

    // A subscription opened *after* the other connection switched must still
    // read A's own workspace.
    a.sent = [];
    await send(a, 'subscribe-list', { id: 'c-a2', type: 'ready-issues' });
    const a_late_ids = receivedIssueIds(a);
    expect(a_late_ids.length).toBeGreaterThan(0);
    expect(a_late_ids.every((id) => id.startsWith(tag1))).toBe(true);
  });

  test('get-workspace reflects only the requesting connection', async () => {
    const { wss } = attach(root1);
    const a = makeSocket();
    const b = makeSocket();
    wss.clients.add(/** @type {any} */ (a));
    wss.clients.add(/** @type {any} */ (b));

    await send(b, 'set-workspace', { path: root2 });

    await send(a, 'get-workspace', {});
    expect(lastReply(a).payload.root_dir).toBe(root1);

    await send(b, 'get-workspace', {});
    expect(lastReply(b).payload.root_dir).toBe(root2);

    // list-workspaces reports the same per-connection current workspace
    await send(a, 'list-workspaces', {});
    expect(lastReply(a).payload.current.root_dir).toBe(root1);
    await send(b, 'list-workspaces', {});
    expect(lastReply(b).payload.current.root_dir).toBe(root2);
  });

  test('bd mutations run in the requesting connection workspace', async () => {
    const { wss } = attach(root1);
    const a = makeSocket();
    const b = makeSocket();
    wss.clients.add(/** @type {any} */ (a));
    wss.clients.add(/** @type {any} */ (b));

    await send(b, 'set-workspace', { path: root2 });

    await send(a, 'update-status', { id: 'X-1', status: 'open' });
    await send(b, 'update-status', { id: 'X-1', status: 'open' });

    const mock = /** @type {import('vitest').Mock} */ (runBd);
    const cwds = mock.mock.calls.map((c) => c[1] && c[1].cwd);
    expect(cwds).toEqual([root1, root2]);
  });

  test('switching workspace leaves another workspace entries intact', async () => {
    const { wss } = attach(root1);
    const a = makeSocket();
    const b = makeSocket();
    wss.clients.add(/** @type {any} */ (a));
    wss.clients.add(/** @type {any} */ (b));

    await send(a, 'subscribe-list', { id: 'c-a', type: 'all-issues' });

    const key_a = keyOf({ type: 'all-issues' }, root1);
    expect(registry.get(key_a)?.subscribers.size).toBe(1);
    expect(Array.from(registry.get(key_a)?.itemsById.keys() || [])).toEqual([
      `${tag1}-1`
    ]);

    await send(b, 'set-workspace', { path: root2 });
    await send(b, 'subscribe-list', { id: 'c-b', type: 'all-issues' });

    // A's entry survives B's switch, with its own data.
    const entry_a = registry.get(key_a);
    expect(entry_a?.subscribers.size).toBe(1);
    expect(Array.from(entry_a?.itemsById.keys() || [])).toEqual([`${tag1}-1`]);

    // B has its own, separate entry.
    const entry_b = registry.get(keyOf({ type: 'all-issues' }, root2));
    expect(entry_b?.subscribers.size).toBe(1);
    expect(Array.from(entry_b?.itemsById.keys() || [])).toEqual([`${tag2}-1`]);
  });

  test('two connections on the same workspace share one entry and one bd call', async () => {
    const { wss } = attach(root1);
    const a = makeSocket();
    const b = makeSocket();
    wss.clients.add(/** @type {any} */ (a));
    wss.clients.add(/** @type {any} */ (b));

    await send(a, 'subscribe-list', { id: 'c-a', type: 'all-issues' });
    await send(b, 'subscribe-list', { id: 'c-b', type: 'all-issues' });

    const key = keyOf({ type: 'all-issues' }, root1);
    expect(registry.get(key)?.subscribers.size).toBe(2);

    // One refresh pass must fetch the shared spec exactly once.
    const mock = /** @type {import('vitest').Mock} */ (
      fetchListForSubscription
    );
    mock.mockClear();
    vi.useFakeTimers();
    scheduleListRefresh();
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();
    expect(mock.mock.calls.length).toBe(1);
  });

  test('a connection that never switches uses the server default workspace', async () => {
    const { wss } = attach(root1);
    const a = makeSocket();
    wss.clients.add(/** @type {any} */ (a));

    await send(a, 'subscribe-list', { id: 'c-a', type: 'all-issues' });

    const mock = /** @type {import('vitest').Mock} */ (
      fetchListForSubscription
    );
    expect(mock.mock.calls[0][1].cwd).toBe(root1);
    expect(receivedIssueIds(a)).toEqual([`${tag1}-1`]);

    await send(a, 'get-workspace', {});
    expect(lastReply(a).payload.root_dir).toBe(root1);
  });

  test('switching a connection releases only its own subscriptions', async () => {
    const { wss } = attach(root1);
    const a = makeSocket();
    const b = makeSocket();
    wss.clients.add(/** @type {any} */ (a));
    wss.clients.add(/** @type {any} */ (b));

    await send(a, 'subscribe-list', { id: 'c-a', type: 'all-issues' });
    await send(b, 'subscribe-list', { id: 'c-b', type: 'all-issues' });

    const key1 = keyOf({ type: 'all-issues' }, root1);
    expect(registry.get(key1)?.subscribers.size).toBe(2);

    await send(b, 'set-workspace', { path: root2 });

    // B is detached from the root1 entry; A remains subscribed.
    const entry = registry.get(key1);
    expect(entry?.subscribers.size).toBe(1);
    expect(entry?.subscribers.has(/** @type {any} */ (a))).toBe(true);
    expect(entry?.subscribers.has(/** @type {any} */ (b))).toBe(false);

    // A refresh must not push root1 data to B any more.
    a.sent = [];
    b.sent = [];
    EXTRA_ITEM = true;
    vi.useFakeTimers();
    scheduleListRefresh();
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();
    expect(receivedIssueIds(a)).toContain(`${tag1}-2`);
    expect(receivedIssueIds(b)).toEqual([]);
  });

  test('exported setWorkspace moves the default without hijacking explicit connections', async () => {
    const { wss, setWorkspace } = attach(root1);
    const a = makeSocket();
    const b = makeSocket();
    wss.clients.add(/** @type {any} */ (a));
    wss.clients.add(/** @type {any} */ (b));

    // B makes an explicit choice; A stays on the default.
    await send(b, 'set-workspace', { path: root2 });

    const res = setWorkspace(root3);
    expect(res.changed).toBe(true);
    expect(res.workspace.root_dir).toBe(root3);

    await send(a, 'get-workspace', {});
    expect(lastReply(a).payload.root_dir).toBe(root3);

    await send(b, 'get-workspace', {});
    expect(lastReply(b).payload.root_dir).toBe(root2);

    // Both sockets are told the default moved.
    for (const sock of [a, b]) {
      const changed = envelopes(sock).find(
        (e) => e && e.type === 'workspace-changed'
      );
      expect(changed?.payload?.root_dir).toBe(root3);
    }
  });

  test('exported setWorkspace releases subscriptions of inheriting connections only', async () => {
    const { wss, setWorkspace } = attach(root1);
    const a = makeSocket();
    const b = makeSocket();
    wss.clients.add(/** @type {any} */ (a));
    wss.clients.add(/** @type {any} */ (b));

    await send(b, 'set-workspace', { path: root2 });
    await send(a, 'subscribe-list', { id: 'c-a', type: 'all-issues' });
    await send(b, 'subscribe-list', { id: 'c-b', type: 'all-issues' });

    setWorkspace(root3);

    // A inherited the default, so its subscription is released.
    expect(registry.get(keyOf({ type: 'all-issues' }, root1))).toBe(null);
    // B chose root2 explicitly, so its entry is untouched.
    const entry_b = registry.get(keyOf({ type: 'all-issues' }, root2));
    expect(entry_b?.subscribers.size).toBe(1);
    expect(Array.from(entry_b?.itemsById.keys() || [])).toEqual([`${tag2}-1`]);
  });
});
