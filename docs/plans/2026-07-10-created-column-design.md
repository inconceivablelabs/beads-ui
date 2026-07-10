# Design: Sortable "Created" column in the Issues list

**Bead:** ds-oe5 **Date:** 2026-07-10 **Base branch:** `preview/local` (the
deployed integration branch; not upstreamed yet)

## Problem

The Issues list shows ID, Type, Title, Status, Assignee, Priority, and a Deps
indicator. It does not show when an issue was created, and you can't order the
list by creation date. Sorting by date has to keep epic children grouped under
their parent — a flat date sort across every row would scatter children away
from their epics.

## What already exists (so we don't rebuild it)

`preview/local` already carries the column-header sort framework:

- `app/data/sort.js` — `SORTABLE_COLUMNS`, `columnKey(issue, column)`,
  `makeColumnComparator(column, direction)`, three-state sort state.
- `app/views/list.js` — `sortableHeader(label, column)` renders a clickable
  header with ▲/▼ + `aria-sort`; the list sorts top-level rows by the active
  comparator, then **re-sorts each epic's children by the same comparator within
  their parent group** (the `sorted_children` path). Children never leave their
  epic.

`created_at` already reaches the client as a **number (epoch ms)** —
`server/list-adapters.js` normalizes the bd ISO string via `Date.parse`. The
`IssueLite` typedef already declares `created_at?: number`, and `sort.js`'s
default comparator already sorts by it.

So a sortable Created column is a small addition to this framework: the
children-grouping behavior comes for free the moment `created` is a recognized
sort column.

## Actor capabilities

- **A user** can see each issue's creation date (`yyyy-mm-dd`) in the Issues
  list.
- **A user** can click the "Created" header to sort the list by creation date,
  ascending / descending / cleared (the existing three-state cycle).
- When sorted by Created, **epic children** re-order by date _within_ their
  parent epic, never flattening across epics (inherited from the framework).
- **A user** can hover the date to see the full timestamp (title tooltip).
- In the separate **Epics tab**, a user sees the same Created date as a
  display-only cell (no click-sort there; that view has no column sort).

## Changes

### 1. `app/data/sort.js` — recognize `created`

- Add `'created'` to `SORTABLE_COLUMNS` and to the two column-union jsdoc
  typedefs.
- Add `case 'created'` to `columnKey`, returning the numeric `created_at` (epoch
  ms), mirroring how `status` returns a numeric rank:
  `return typeof issue.created_at === 'number' ? issue.created_at : 0;`
- No change to `makeColumnComparator`: a numeric `columnKey` compares correctly
  through the existing generic `<`/`>` path (same as `status`). Ties still break
  by id ascending.

### 2. `app/utils/date.js` — new formatter (own unit test)

- `formatDateYmd(ms)` → local-time `yyyy-mm-dd` via
  `getFullYear`/`getMonth`+1/`getDate` with `padStart`. Returns `''` for null /
  undefined / non-finite / `<= 0`. Local time (not `toISOString` slicing) so a
  late-night issue shows the day the user created it, not a UTC-shifted day.
- `formatDateIso(ms)` → full ISO string for the hover tooltip; same guards.

### 3. `app/views/issue-row.js` — the cell

- Add `created_at?: number` to the `IssueRowData` typedef.
- Insert a `<td>` **between the Priority cell and the Deps cell**, rendering
  `formatDateYmd(it.created_at)` with `title=${formatDateIso(it.created_at)}`
  and a `class="created-col mono muted"` (muted, monospace to match the date
  style). Empty string renders as an empty cell.

### 4. `app/views/list.js` — the header + column width

- Add `${sortableHeader('Created', 'created')}` **between the Priority header
  and the plain Deps header**.
- Add a `<col style="width: 110px" />` to the `<colgroup>` in the same position
  (before the Deps col) so widths stay aligned.
- Bump `aria-colcount` from `"6"` to `"7"` (it counts the sortable columns;
  Created is the 7th).

### 5. `app/views/epics.js` — display-only alignment

- The Epics tab shares the row renderer, so its children rows inherit the new
  Created cell. Add a `<th>Created</th>` after the Priority header to keep the
  cell under a header.
- Pre-existing quirk left untouched: that header has no Deps `<th>` even though
  the shared row renders a Deps cell. Out of scope for this change.

## Data flow

`bd list --json` → `server/list-adapters.js` (`created_at` → epoch ms) →
subscription store → `list.js` sort (`makeColumnComparator('created', dir)`,
children re-sorted within epic) → `issue-row.js` renders
`formatDateYmd(created_at)`.

## Testing (TDD, red first)

1. `app/utils/date.test.js` (new)
   - `formatDateYmd(Date.UTC(2026, 6, 10, 12))` → `'2026-07-10'` (noon-UTC input
     keeps the local date stable across timezones).
   - year boundary: `Date.UTC(2025, 11, 12, 12)` → `'2025-12-12'`.
   - `''` for `undefined`, `0`, negative, `NaN`, non-number.
   - `formatDateIso` returns a `Z`-suffixed ISO string; `''` on bad input.
2. `app/data/sort.test.js` (extend)
   - `SORTABLE_COLUMNS` includes `'created'`.
   - `makeColumnComparator('created','asc')` orders by `created_at` ascending;
     `'desc'` reverses; equal `created_at` breaks by id ascending.
3. `app/views/list.test.js` (extend)
   - The rendered header includes a sortable `Created` column
     (`data-sort-col="created"`); clicking it drives `setSort('created')`.
4. `app/views/issue-row.*` coverage
   - A rendered row contains the formatted created date in a `created-col` cell.
     (Add `app/views/issue-row.test.js` if no existing harness covers the row
     template directly; otherwise assert through `list.test.js`.)

Full gate: `npm run all` (eslint + tsc + vitest + prettier) green.

## Deploy

Rebuild the bdui container from `preview/local`. The Dockerfile's `BEADS_UI_REF`
default is currently `feat/nested-epic-view`, so the rebuild must pin the ref
explicitly:

```bash
# from dev-services/
docker compose build --no-cache --build-arg BEADS_UI_REF=preview/local bdui
docker compose up -d bdui
```

(Alternatively, reset the Dockerfile `ARG BEADS_UI_REF` default to
`preview/local` so plain rebuilds track the running branch — decide at deploy
time.) Verify: `curl host.docker.internal:3000` → 200, then load the Issues list
and click the Created header.

## Assumptions

| #   | Assumption                                                                | Risk if wrong                                 | Validation                                                                                   |
| --- | ------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | `created_at` is epoch ms on the client                                    | Formatter shows 1970 / wrong dates            | Confirmed: `list-adapters.js:76` `parseTimestamp` (`Date.parse`) → ms; typedef says `number` |
| 2   | A numeric `columnKey` sorts correctly through the generic comparator path | Created sort misorders                        | `status` already returns a numeric rank through the same path and works                      |
| 3   | The children-within-epic re-sort applies to any recognized sort column    | Children scatter when sorting by date         | `sorted_children` in `list.js` sorts children by the active `cmp`, not a hardcoded column    |
| 4   | Epics tab still shares the row renderer on `preview/local`                | Column misaligns in Epics tab                 | Confirmed: `epics.js:58` `createIssueRowRenderer`                                            |
| 5   | Rebuild picks up `preview/local` only if the ref is pinned                | Rebuild ships `feat/nested-epic-view` instead | Dockerfile default is `feat/nested-epic-view`; pin `--build-arg` at deploy                   |

## Out of scope

- Upstream PR (deferred until #89 + the ds-c8r sort PR move).
- The pre-existing missing Deps `<th>` in the Epics tab.
- Column-header sort in the Epics tab (that view has none today).
