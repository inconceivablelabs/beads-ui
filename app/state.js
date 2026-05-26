/**
 * Minimal app state store with subscription.
 */
import { debug } from './utils/logging.js';
import { normalizeStatusFilters, sameStatusFilters } from './utils/status.js';

/**
 * @import { StatusFilter } from './utils/status.js'
 */

/**
 * The status filter is a selection, not a single value: either exactly
 * `['ready']` or a subset of the stored statuses. An empty selection means
 * "all issues".
 *
 * @typedef {{ status: StatusFilter[], search: string, type: string }} Filters
 */

/**
 * @typedef {'issues'|'epics'|'board'} ViewName
 */

/**
 * @typedef {'today'|'3'|'7'} ClosedFilter
 */

/**
 * @typedef {{ closed_filter: ClosedFilter }} BoardState
 */

/**
 * Active column sort for the Issues list. `column: null` means "no explicit
 * sort" — views fall back to their default ordering.
 *
 * @typedef {{ column: string | null, direction: 'asc'|'desc' }} SortState
 */

/**
 * @typedef {Object} WorkspaceInfo
 * @property {string} path - Full path to workspace
 * @property {string} database - Path to the database file
 * @property {number} [pid] - Process ID of the daemon
 * @property {string} [version] - Version of beads
 */

/**
 * @typedef {Object} WorkspaceState
 * @property {WorkspaceInfo | null} current - Currently active workspace
 * @property {WorkspaceInfo[]} available - All available workspaces
 */

/**
 * @typedef {{ selected_id: string | null, view: ViewName, filters: Filters, board: BoardState, sort: SortState, workspace: WorkspaceState }} AppState
 */

/**
 * Create a simple store for application state.
 *
 * @param {{ selected_id?: string | null, view?: ViewName, filters?: Partial<Filters>, board?: Partial<BoardState>, sort?: Partial<SortState>, workspace?: Partial<WorkspaceState> }} [initial]
 * @returns {{ getState: () => AppState, setState: (patch: { selected_id?: string | null, filters?: Partial<Filters>, board?: Partial<BoardState>, sort?: Partial<SortState>, workspace?: Partial<WorkspaceState> }) => void, subscribe: (fn: (s: AppState) => void) => () => void }}
 */
export function createStore(initial = {}) {
  const log = debug('state');
  /** @type {AppState} */
  let state = {
    selected_id: initial.selected_id ?? null,
    view: initial.view ?? 'issues',
    filters: {
      status: normalizeStatusFilters(initial.filters?.status),
      search: initial.filters?.search ?? '',
      type:
        typeof initial.filters?.type === 'string' ? initial.filters?.type : ''
    },
    board: {
      closed_filter:
        initial.board?.closed_filter === '3' ||
        initial.board?.closed_filter === '7' ||
        initial.board?.closed_filter === 'today'
          ? initial.board?.closed_filter
          : 'today'
    },
    sort: {
      column:
        typeof initial.sort?.column === 'string' ? initial.sort.column : null,
      direction: initial.sort?.direction === 'desc' ? 'desc' : 'asc'
    },
    workspace: {
      current: initial.workspace?.current ?? null,
      available: initial.workspace?.available ?? []
    }
  };

  /** @type {Set<(s: AppState) => void>} */
  const subs = new Set();

  function emit() {
    for (const fn of Array.from(subs)) {
      try {
        fn(state);
      } catch {
        // ignore
      }
    }
  }

  return {
    getState() {
      return state;
    },
    /**
     * Update state. Nested filters can be partial.
     *
     * @param {{ selected_id?: string | null, filters?: Partial<Filters>, board?: Partial<BoardState>, sort?: Partial<SortState>, workspace?: Partial<WorkspaceState> }} patch
     */
    setState(patch) {
      /** @type {AppState} */
      const next = {
        ...state,
        ...patch,
        filters: {
          ...state.filters,
          ...(patch.filters || {}),
          status:
            patch.filters && 'status' in patch.filters
              ? normalizeStatusFilters(patch.filters.status)
              : state.filters.status
        },
        board: { ...state.board, ...(patch.board || {}) },
        sort: { ...state.sort, ...(patch.sort || {}) },
        workspace: {
          current:
            patch.workspace?.current !== undefined
              ? patch.workspace.current
              : state.workspace.current,
          available:
            patch.workspace?.available !== undefined
              ? patch.workspace.available
              : state.workspace.available
        }
      };
      // Avoid emitting if nothing changed (shallow compare)
      const workspace_changed =
        next.workspace.current?.path !== state.workspace.current?.path ||
        next.workspace.available.length !== state.workspace.available.length;
      if (
        next.selected_id === state.selected_id &&
        next.view === state.view &&
        sameStatusFilters(next.filters.status, state.filters.status) &&
        next.filters.search === state.filters.search &&
        next.filters.type === state.filters.type &&
        next.board.closed_filter === state.board.closed_filter &&
        next.sort.column === state.sort.column &&
        next.sort.direction === state.sort.direction &&
        !workspace_changed
      ) {
        return;
      }
      state = next;
      log('state change %o', {
        selected_id: state.selected_id,
        view: state.view,
        filters: state.filters,
        board: state.board,
        workspace: state.workspace.current?.path
      });
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    }
  };
}
