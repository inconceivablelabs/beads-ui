import { beforeEach, describe, expect, test, vi } from 'vitest';
import { runBdJson } from './bd.js';
import {
  fetchListForSubscription,
  mapSubscriptionToBdArgs
} from './list-adapters.js';

vi.mock('./bd.js', () => ({ runBdJson: vi.fn() }));

describe('list adapters for subscription types', () => {
  beforeEach(() => {
    /** @type {import('vitest').Mock} */ (runBdJson).mockReset();
  });

  test('mapSubscriptionToBdArgs returns args for all-issues', () => {
    const args = mapSubscriptionToBdArgs({ type: 'all-issues' });
    // `--limit 0` = unlimited; without it bd list truncates at its default 50
    expect(args).toEqual(['list', '--json', '--tree=false', '--limit', '0']);
  });

  test('mapSubscriptionToBdArgs returns args for epics', () => {
    const args = mapSubscriptionToBdArgs({ type: 'epics' });
    expect(args).toEqual(['epic', 'status', '--json']);
  });

  test('mapSubscriptionToBdArgs returns args for blocked-issues', () => {
    const args = mapSubscriptionToBdArgs({ type: 'blocked-issues' });
    // We choose dedicated subcommand mapping for blocked
    expect(args).toEqual(['blocked', '--json']);
  });

  test('mapSubscriptionToBdArgs returns args for ready-issues', () => {
    const args = mapSubscriptionToBdArgs({ type: 'ready-issues' });
    expect(args).toEqual(['ready', '--limit', '1000', '--json']);
  });

  test('mapSubscriptionToBdArgs returns args for in-progress-issues', () => {
    const args = mapSubscriptionToBdArgs({ type: 'in-progress-issues' });
    // `--limit 0` = unlimited; without it bd list truncates at its default 50
    expect(args).toEqual([
      'list',
      '--json',
      '--tree=false',
      '--status',
      'in_progress',
      '--limit',
      '0'
    ]);
  });

  test('mapSubscriptionToBdArgs returns args for closed-issues', () => {
    const args = mapSubscriptionToBdArgs({ type: 'closed-issues' });
    expect(args).toEqual([
      'list',
      '--json',
      '--tree=false',
      '--status',
      'closed',
      '--limit',
      '1000'
    ]);
  });

  test('mapSubscriptionToBdArgs returns args for status-blocked-issues', () => {
    const args = mapSubscriptionToBdArgs({ type: 'status-blocked-issues' });
    // `bd blocked` only reports dependency-blocked issues, so issues whose
    // stored status is `blocked` need their own list query.
    // `--limit 0` = unlimited; without it bd list truncates at its default 50
    expect(args).toEqual([
      'list',
      '--json',
      '--tree=false',
      '--status',
      'blocked',
      '--limit',
      '0'
    ]);
  });

  test('mapSubscriptionToBdArgs returns args for issue-detail', () => {
    const args = mapSubscriptionToBdArgs({
      type: 'issue-detail',
      params: { id: 'UI-123' }
    });
    expect(args).toEqual(['show', 'UI-123', '--json']);
  });

  // FORK-LOCAL DIVERGENCE FROM UPSTREAM — see ds-673 and the dev-services CLAUDE.md gotcha.
  //
  // Upstream #94 (bc972a2) added `--include-dependents` to the issue-detail call. That
  // flag does not exist in bd 1.0.3, which is what our deployment runs, so bd exits with
  // `unknown flag: --include-dependents` on EVERY issue-detail fetch. The client then gets
  // no children at all: the Epics tab renders epics with no children, the inline epic view
  // expands to nothing, and issues with a parent epic vanish from the Issues list entirely
  // (they are filtered out of the top level in anticipation of a nested render that never
  // arrives).
  //
  // bd 1.0.3's plain `bd show <id> --json` already includes `dependents`, so dropping the
  // flag restores children. bd 1.1.x made dependent-streaming opt-in behind the flag, which
  // is why upstream needs it and we must not have it.
  //
  // REVERT once the deployed bd is >= 1.1.0 (tracked as dc-ytn). Until then this stays on
  // preview/local ONLY and must never reach a PR branch.
  test('issue-detail args stay compatible with bd 1.0.3 (no --include-dependents)', () => {
    const args = mapSubscriptionToBdArgs({
      type: 'issue-detail',
      params: { id: 'UI-123' }
    });
    expect(args).not.toContain('--include-dependents');
    expect(args).toEqual(['show', 'UI-123', '--json']);
  });

  test('fetchListForSubscription returns normalized items (Date.parse)', async () => {
    /** @type {import('vitest').Mock} */ (runBdJson).mockResolvedValue({
      code: 0,
      stdoutJson: [
        {
          id: 'A-1',
          updated_at: '2024-01-01T00:00:00.000Z',
          closed_at: null,
          extra: 'x'
        },
        {
          id: 'A-2',
          updated_at: '2024-01-01T00:00:01.000Z',
          closed_at: '2024-01-01T00:00:05.000Z'
        },
        { id: 3, updated_at: 'not-a-date' }
      ]
    });
    const res = await fetchListForSubscription({ type: 'all-issues' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items.length).toBe(3);
      expect(res.items[0]).toMatchObject({
        id: 'A-1',
        updated_at: Date.parse('2024-01-01T00:00:00.000Z'),
        closed_at: null
      });
      expect(res.items[1]).toMatchObject({
        id: 'A-2',
        updated_at: Date.parse('2024-01-01T00:00:01.000Z'),
        closed_at: Date.parse('2024-01-01T00:00:05.000Z')
      });
      // id coerced to string, closed_at defaults to null
      expect(res.items[2]).toMatchObject({
        id: '3',
        updated_at: 0,
        closed_at: null
      });
    }
  });

  test('filters tombstoned epics', async () => {
    /** @type {import('vitest').Mock} */ (runBdJson).mockResolvedValue({
      code: 0,
      stdoutJson: [
        {
          epic: {
            id: 'E-1',
            status: 'open',
            issue_type: 'epic',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
            closed_at: null
          },
          total_children: 1,
          closed_children: 0,
          eligible_for_close: false
        },
        {
          epic: {
            id: 'E-2',
            status: 'tombstone',
            issue_type: 'epic',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
            closed_at: null,
            deleted_at: '2024-02-01T00:00:00.000Z'
          },
          total_children: 0,
          closed_children: 0,
          eligible_for_close: false
        }
      ]
    });

    const res = await fetchListForSubscription({ type: 'epics' });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({
        id: 'E-1',
        status: 'open'
      });
    }
  });

  test('fetchListForSubscription surfaces bd error', async () => {
    /** @type {import('vitest').Mock} */ (runBdJson).mockResolvedValue({
      code: 2,
      stderr: 'boom'
    });
    const res = await fetchListForSubscription({ type: 'all-issues' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('bd_error');
      expect(res.error.message).toContain('boom');
      expect(res.error.details && res.error.details.exit_code).toBe(2);
    }
  });

  test('fetchListForSubscription returns error for unknown type', async () => {
    const res = await fetchListForSubscription(
      /** @type {any} */ ({ type: 'unknown' })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('bad_request');
      expect(res.error.message).toMatch(/Unknown subscription type/);
    }
  });
});
