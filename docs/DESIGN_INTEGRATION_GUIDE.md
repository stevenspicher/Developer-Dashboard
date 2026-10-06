# Design integration guide: wiring the Figma Make redesign into the dashboard

Status: plan, written 2026-10-06. Nothing in this guide is built yet. Every "Recommendation" is a proposal, not existing behaviour.

**Two codebases are involved:**
- **The current app**: this repo (`/Users/steven-macbook/Projects/Developer Dashboard`). React 19, Vite, Tailwind CSS v4. It talks to two bridges and holds the real behaviour. Its behaviour spec is `docs/IMPLEMENTATION.md`.
- **The design**: a Figma Make prototype of a redesign, built from `docs/FRONTEND_BRIEF.md`. It is committed in this repo as `Developer Dashboard Design.zip` (commit `1a9920d`). An unpacked, read-only copy was used to write this guide. In this guide, paths that start with `design/` refer to files inside that zip (for example `design/src/modes/Inbox.tsx`). Paths without a prefix are in this repo.

Line numbers are as of commit `1a9920d`. Where the docs and the code disagree, the code was trusted and the difference is flagged.

## Contents

1. [Summary and recommendation](#1-summary-and-recommendation)
2. [Architecture mapping](#2-architecture-mapping)
3. [Data contract reconciliation](#3-data-contract-reconciliation)
4. [Design system migration](#4-design-system-migration)
5. [Phased migration plan](#5-phased-migration-plan)
6. [Missing pieces to build](#6-missing-pieces-to-build)
7. [Known defects in the design to fix while wiring](#7-known-defects-in-the-design-to-fix-while-wiring)
8. [Testing and verification](#8-testing-and-verification)
9. [Risks, open questions and decisions needed](#9-risks-open-questions-and-decisions-needed)
10. [Appendix](#10-appendix)

**Terms used throughout**
- **Bridge**: a small server the browser talks to instead of Notion or Azure DevOps (ADO). `notion-bridge` is served under `/bridge/*`, `ado-bridge` under `/ado/*`.
- **Adapter** (`QueueAdapter`): the per-source object in `src/bridge.ts:544-572` that knows how to load, move, finish, annotate and describe one source's items.
- **Task**: one card or item, whatever its source (`src/types.ts:6-30`).
- **Lane**: where the dashboard has put an item: `queue`, `today` (in today's plan), `working` (at most one item) or `blocked` (`src/types.ts:3`). Lanes are dashboard state, not source state.
- **Plan**: today's checklist of entries (`src/plan.ts:11-41`). An entry may be linked to a Task.
- **Cockpit**: the item view with description, acceptance criteria, notes, dev links, linked items and project context (`src/Cockpit.tsx`).
- **Mode**: one of the design's three layouts, chosen in its header: Flow (`design/src/modes/Timeline.tsx`), Scan (`design/src/modes/Inbox.tsx`) and Calm (`design/src/modes/Document.tsx`).
- **Classic view**: the current UI (`src/App.tsx` presentation plus `src/MyDay.tsx`), kept behind a switch during the migration.

---

## 1. Summary and recommendation

### What we are doing
We replace the presentation layer of the current app with the design's layouts and visual language. We keep all of the current app's data loading, write-back, undo, plan logic, ranking, keyboard model and storage. The design is a prototype: it runs on local fixtures and local state (`design/src/App.tsx:18-24`), so none of its data handling is kept.

### Kept vs replaced

| Layer | Fate | Where it lives today |
|---|---|---|
| Bridge client, adapters, endpoints, lanes storage | **Keep unchanged** | `src/bridge.ts` |
| Plan logic (merge, carry-over, linking, duplicates) | **Keep unchanged** | `src/plan.ts` |
| Up next ranking and reasons | **Keep unchanged** | `src/ranking.ts` |
| Ticks and cross-references | **Keep unchanged** | `src/cockpitLogic.ts` |
| Standup draft text | **Keep unchanged** | `src/standup.ts` |
| Coming up and day maths | **Keep unchanged** | `src/schedule.ts` |
| Row keyboard model | **Keep, extend** (one new global key, see §6.11) | `src/keys.ts` |
| Description rendering | **Keep** (the design's renderer drops links) | `src/RichText.tsx` |
| Board state, effects and actions in `App()` | **Keep, move** into a shared hook (`useBoard`) | `src/App.tsx:550-1124` |
| Cockpit behaviour (loading, cache, notes save, ticks) | **Keep, restyle** | `src/Cockpit.tsx` |
| Every visual component (cards, rows, header, modals, panels, My Day) | **Replace** with the design's look | `src/App.tsx:76-535`, `1126-1569`; `src/MyDay.tsx` |
| Design tokens | **Extend** (light theme, extra surface and line tokens), keep the rules | `src/index.css` |
| Boot screen | **Decision needed** (§9). Recommendation: replace with a quiet loading state | `src/BootScreen.tsx` |

### Recommendation on modes: ship two layouts and one extra theme, not three layouts

Ship **Scan** and **Flow** as layouts. Ship **Calm** as a light theme plus a density setting that works in both layouts, not as a third layout.

Reasons:
1. **The brief already framed Calm as a theme.** Direction D in `docs/FRONTEND_BRIEF.md:197` is "A light, quiet theme. Any of the above in a calmer... style, with a density option". The design turned it into a third layout, but its layout adds little: a sprint sidebar, a plan column and a rail with Up next/Reviews/Brief tabs (`design/src/modes/Document.tsx:52-271`). Scan's filters and Flow's column already show the same things.
2. **Maintenance cost.** Each layout needs its own empty, loading, error, lead, drag-and-drop, keyboard and narrow-window behaviour (§6). Three layouts triple that work and the test matrix (§8). A theme costs one token block.
3. **The cockpit is shared.** All three design layouts render the same `Cockpit` component (`design/src/components/Cockpit.tsx:15`). The brief's problem 3 ("two layouts for one thing", `docs/FRONTEND_BRIEF.md:183`) argues for fewer homes for the cockpit, not more.
4. **Contrast.** The design's Calm palette fails AA for its muted text and for status colours on its darkest surface (§4.4). Fixing one light palette is cheaper than keeping three palettes compliant.

If the product owner wants the three names kept, map them as presets: Flow = Flow layout + dark, Scan = Scan layout + dark, Calm = Flow layout + light + comfortable density. That keeps the design's vocabulary without a third layout.

### Recommendation on order
Build Scan first. It gives the cockpit one permanent home (no modal), it maps one-to-one onto today's regions (queues panel becomes the list, My Day sections become filters, the Working Space becomes the reading pane), it is the keyboard-first layout, and it is where most of the design's defects are (§7), so fixing them early de-risks the rest. Flow follows and reuses everything Scan needs.

### Recommendation on the Board direction
Do not build a Board mode now. Its job is covered by the lanes, drop targets and keyboard equivalents that exist in every mode, plus Scan's Blocked filter and the header counts. The reasoning is in §6.13.

---

## 2. Architecture mapping

### 2.1 Which layer is which

| Module | Layer | Notes |
|---|---|---|
| `src/bridge.ts` | Data (keep) | `request` (104-111), endpoint helpers (123-161), ADO adapter (364-435), Notion adapters (579-622), `QUEUES` (629-706), `queueFor` (708), lanes storage (34-51), date helpers (712-747). Also `TEST_DEVELOPERS` (13-20), a temporary stand-in for login. |
| `src/plan.ts` | Logic (keep) | Storage (46-63), `rollover` (67-74), `mergeBrief` (88-103), `addItem` (105-119), `linkEntries` (179-211), `suggestLinks` (214-224), `findDuplicates` (227-240), `agingLabel`/`matchLine` (244-256). |
| `src/ranking.ts` | Logic (keep) | `WEIGHTS` (27-38), `reasonsFor` (89-91), `rankUpNext` (94-103). |
| `src/cockpitLogic.ts` | Logic (keep) | Ticks (9-48), `refsIn`/`crossRefs` (57-83). |
| `src/standup.ts` | Logic (keep) | `buildStandupDraft` (32-58). |
| `src/schedule.ts` | Logic (keep) | `comingUp` (21-46), `teamDates` (80-93), `workingDaysAfter` (100-107), labels (110-128). |
| `src/keys.ts` | Interaction logic (keep) | `rowKeys` (9-46) and `focusFirstRow` (49-51). |
| `src/RichText.tsx` | Presentation helper (keep) | Renders `[label](url)` and bare URLs safely. |
| `src/Cockpit.tsx` | Mixed | `CockpitContext` (14-28), the cached loader `useLoaded` (43-78) and the notes save flow (280-331) are logic; the JSX is presentation. |
| `src/App.tsx` `App()` | Mixed | State and effects (550-1124) are logic. The JSX (1126-1338) and every component above line 537 and below 1342 are presentation. |
| `src/MyDay.tsx` | Mostly presentation | `DayActions` (25-44), `PlanView` (47-55), `DropZone`/`ReaderTab`/`Reviews` (18-22) are contracts worth keeping. The rest is replaced. |
| `src/BootScreen.tsx` | Presentation | Boot step state comes from `App.tsx:1069-1087`. |
| `src/StandupDraft.tsx` | Presentation with a small editor state | Keep the behaviour (follows the board until edited, RESET, COPY with fallback select). |
| `src/index.css` | Tokens (extend) and component classes (replace) | Tokens 16-77; component classes 99-225; boot CRT styles 227-234. |

### 2.2 Current component to design counterpart

| Current (file:line) | What it does | Design counterpart | Notes |
|---|---|---|---|
| Header, `App.tsx:1131-1160` | Title, sprint line, TEMP switcher, SPRINT DAY, PLANNED, BLOCKED, clock | `design/src/App.tsx:60-113` | Design hardcodes "Sprint 20 · Day 14/14" and "Oct 6" (66-71, 110). Design's PLANNED is `plan.length` including done entries (87); ours is open entries (`App.tsx:992`). |
| `Stat`, `Clock`, `App.tsx:1545-1569` | Header numbers, clock isolated from re-renders | `HeaderStat`, `design/src/App.tsx:135-142`; design clock state in `App` (24-26) | Keep our isolated `Clock`: the design re-renders the whole tree every second. |
| TEMP developer `<select>`, `App.tsx:1143-1150` | Switch developer (flushes pending done) | `design/src/App.tsx:95-106` | Design's switch only sets local state; ours must call `changeDeveloper` (`App.tsx:604-625`). |
| Queues panel, `App.tsx:1166-1235` | Source tabs, counts, cards, bridge and action errors, drop-back zone | Scan "Queue" filter with source sub-tabs (`Inbox.tsx:127-142`); Flow "Queues" drawer (`Timeline.tsx:232-268`) | Design shows no errors, no loading, and does not exclude planned items. |
| `TaskCard`, `App.tsx:116-182` | Card with chips, priority, points, preview, AC progress, standup age, hover/focus actions, drag | `ListRow` task branch (`Inbox.tsx:270-309`), `MiniCard` (`Timeline.tsx:345-367`) | Design rows are not focusable and actions show on mouse hover only. |
| `MyDay`, `MyDay.tsx:67-200` | Day header, Team today, plan, Up next, Reviews, Blocked, Coming up, Team notes, key hints | Flow centre column (`Timeline.tsx:71-229`); Scan filters; Calm centre + rails (`Document.tsx:52-271`) | |
| `DayHeader`, `MyDay.tsx:245-298` | Date, sprint line, brief chip, STANDUP DRAFT, story progress | Flow day header (`Timeline.tsx:75-86`), Calm day header (`Document.tsx:120-129`), Calm sprint sidebar (54-62) | Design hardcodes all of it and has no brief chip or story progress. |
| `PlanRow`, `MyDay.tsx:320-435` | Tick, text, ref, Working/Blocked chips, origin, external state, reasons, duplicate flag, Looks like/CONFIRM/✕, LINK, START, remove, drag reorder, row keys | `ListRow` plan branch (`Inbox.tsx:239-267`), Flow `PlanRow` (`Timeline.tsx:295-341`), `DocPlanRow` (`Document.tsx:289-331`) | Design has none of: origin, reasons, duplicate, suggestion, LINK, remove, reorder, keys. |
| `UpNextRow`, `MyDay.tsx:437-473` | Ranked suggestion with reasons, ＋PLAN/＋CLAIM, START | Flow Up next cards (`Timeline.tsx:174-196`), Calm rail (`Document.tsx:216-234`), Scan "Next" filter | Design reasons are fixture text, not `ranking.ts` output. |
| `ReviewList`, `MyDay.tsx:204-243` | PRs waiting, age, REQUIRED, opens ADO; loading/error/empty | Flow reviews (`Timeline.tsx:201-216`), Scan "Reviews" filter (`Inbox.tsx:147-162`), Calm rail (`Document.tsx:236-249`) | Design PR rows are not links; Scan rows do nothing on click (§7). |
| `BlockedRow`, `MyDay.tsx:475-490` | Blocked item with UNBLOCK | Flow blocked drop zone (`Timeline.tsx:149-166`), Calm blocked section (`Document.tsx:183-200`), Scan "Blocked" filter | |
| `ComingUp`, `MyDay.tsx:498-513` | Dated events | Flow (`Timeline.tsx:219-228`), Calm sidebar (`Document.tsx:76-84`) | Design colours `deadline` red and `team` green; our rule keeps these neutral/accent. |
| `TeamToday`, `MyDay.tsx:517-556` | Lead view: summaries plus blocked ADO stories | Calm sidebar "Team Today" (`Document.tsx:101-112`) | Design shows it to everyone whenever the fixture has summaries, and has no blockers. |
| `KeyHints`, `MyDay.tsx:558-578` | Shortcut legend | Scan footer (`Inbox.tsx:186-189`) | Design advertises keys it does not implement (§7). |
| `FocusBar`, `MyDay.tsx:582-604` | ← MY DAY, next plan entry with ▶ | None | Flow shows the working item inline instead. |
| `PlanRail`, `MyDay.tsx:606-640` | Plan + Blocked beside the working item | Scan list (Plan filter) | |
| `WorkingSpace`, `App.tsx:471-535` | Active item header, two columns, Project Context, RETURN | Design `Cockpit` (`design/src/components/Cockpit.tsx:15-237`) | |
| `Checklist`, `Cockpit.tsx:82-108` | Ticks stored per developer, count | Design AC list (`design/src/components/Cockpit.tsx:92-112`) | Design ticks are local `useState` keyed by index (16, 22) and are lost on reload. |
| `AcceptanceProgress`, `Cockpit.tsx:111-117` | `AC 2/3` chip on cards | None | Keep. |
| `DevLinksPanel`, `Cockpit.tsx:166-201` | PRs, branches, builds, commits, hyperlinks; loading/error | Design right column (`design/src/components/Cockpit.tsx:153-207`) | Design shows dev links only for the working item (19) and drops commits and builds past three (187). |
| `LinkedItemsPanel`, `Cockpit.tsx:230-273` | ADO child/related and cross-source ref matches | None | Keep; the design omits it. |
| `NotesPanel`, `Cockpit.tsx:280-364` | Load, edit, save to ADO comment or Notion section, unsaved drafts across tasks | Design notes box (`design/src/components/Cockpit.tsx:115-136`) | Design's save does nothing (23) and seeds the box from `task.notes`, which in our data is the card preview. |
| `RelatedPanel`/`RelatedCard`/`RelatedModal`, `App.tsx:359-469` | Project Context cards and full view | Design "Project Context" (`design/src/components/Cockpit.tsx:213-232`) | Design has no full view and no error state. |
| `DetailModal`, `App.tsx:186-248` | Cockpit for any card, START, ＋PLAN, ✓DONE | `DetailModal`, `design/src/components/Cockpit.tsx:241-271` | Scan does not need it; Flow does (§5 Phase 5). |
| `LinkPicker`, `App.tsx:280-338` | Link a plan entry to an item | None | Must be built in the new style (§6.6). |
| `ReaderModal`, `App.tsx:1471-1496` with `BriefPanel` (1355-1412), `TickerList` (1423-1448), `CalendarList` (1500-1541), `StandupDraft` | Four tabs: brief, team items & dates, calendar, standup draft | `ReaderModal`, `design/src/components/Cockpit.tsx:277-363`. Opened from Scan's footer "Brief" (`Inbox.tsx:188`) and Calm's "Brief & Calendar" and "View brief" (`Document.tsx:89`, `137`); Flow has no way to open it | Design has three tabs (Daily Brief, Standup Draft, Sprint Calendar). The look is worth keeping; the content is fixture text (§6.7). |
| `Overlay`, `App.tsx:1452-1469` | Modal shell, Esc and outside click, `data-overlay` guard for global keys | Inline in each design modal | Keep `data-overlay`: the global key handler relies on it (`App.tsx:972`). |
| Toast, `App.tsx:1314-1324` | One toast with UNDO, `role="status"` | `Toast`, `design/src/components/atoms.tsx:115-133` | Design toasts are never given an undo (§7). |
| `BootScreen` | Terminal boot tied to five real requests | None | §6.1. |
| `Avatar`, `PriorityBadge`, `DoneButton`, `CloseButton`, `MetaBadge`, `Section`, `Tags`, `App.tsx:78-275` | Primitives | `design/src/components/atoms.tsx` | §5 Phase 2. |
| None | | `ModeSwitcher`, `design/src/components/atoms.tsx:166-194` | New; §5 Phase 6. |

### 2.3 Target file structure (Recommendation)

```
src/
  types.ts                 keep
  bridge.ts                keep
  plan.ts ranking.ts cockpitLogic.ts standup.ts schedule.ts keys.ts RichText.tsx   keep
  board/
    types.ts               BoardState, BoardActions, DropZone, ReaderTab, Reviews, PlanView (moved from MyDay.tsx)
    useBoard.ts            all state and effects now in App() (App.tsx:550-1124)
    BoardContext.tsx       <BoardProvider>, useBoardState(), useBoardActions()
    fixtureBoard.ts        optional: a BoardState built from fixtures, for Figma Make and screenshots (§10.3)
  ui/
    atoms.tsx              Chip, TypeChip, PriorityBadge, Avatar, Ref, SectionLabel, Checkbox, Button, EmptyState, ErrorNote, Kbd
    Header.tsx             brand, sprint line, mode switcher, counts, developer switcher, clock
    Toast.tsx
    Overlay.tsx            moved from App.tsx:1452-1469
    LinkPicker.tsx         moved from App.tsx:280-338, restyled
    Reader.tsx             moved from App.tsx:1355-1541 plus StandupDraft
    DetailModal.tsx        used by Flow only
    cockpit/
      CockpitPane.tsx      header + two columns + action bar
      Checklist.tsx DevLinks.tsx LinkedItems.tsx Notes.tsx ProjectContext.tsx
      context.ts           CockpitContext (from Cockpit.tsx:14-28)
      load.ts              useLoaded and the cache (from Cockpit.tsx:43-78)
    rows/
      PlanRow.tsx TaskRow.tsx SuggestionRow.tsx ReviewRow.tsx BlockedRow.tsx EventRow.tsx
  modes/
    scan/ScanMode.tsx      list + filters + pane
    flow/FlowMode.tsx      centre column + queues drawer
  classic/                 the current UI, moved here in Phase 0, deleted in Phase 7
  App.tsx                  BoardProvider + theme + mode switch only
```

Naming rules:
- Do not name a mode file `Document.tsx`. Importing `Document` shadows the DOM `Document` type in that module. Use `FlowMode`, `ScanMode`.
- Do not create two files whose names differ only by case (`Cockpit.tsx` and `cockpit.ts`): the repo is used on macOS, where they collide.
- `src/ui` and `src/modes` import from `src/bridge.ts` with `import type` only. Every runtime call goes through `useBoardActions()` or the cockpit context. This keeps the views runnable on fixtures (§10.3).

### 2.4 The shared state and actions (Recommendation)

`useBoard()` returns exactly what `App()` computes today, split into state and actions. Each mode is then a pure view: it reads `BoardState`, calls `BoardActions`, and keeps only layout state (selected filter, drawer open, expanded row) locally.

The shape below is derived from `App.tsx:550-1124`, `DayActions` (`MyDay.tsx:25-44`) and `PlanView` (`MyDay.tsx:47-55`). Field comments give the source line.

```ts
// src/board/types.ts
import type { QueueSource, Status, Task } from '../types'
import type { Deadline, QueueProgress, RelatedEntity, Sprint, StandupBrief, TeamBlocker, PullRequest } from '../bridge'
import type { Plan, PlanEntry } from '../plan'
import type { Reason, Suggestion } from '../ranking'
import type { DayEvent } from '../schedule'
import type { Ticks } from '../cockpitLogic'
import type { BootStep } from '../BootScreen'

export type DropZone = 'today' | 'working' | 'blocked' | 'queue'          // MyDay.tsx:18
export type ReaderTab = 'brief' | 'ticker' | 'calendar' | 'draft'          // MyDay.tsx:19
export type Reviews = PullRequest[] | 'loading' | { error: string } | null  // MyDay.tsx:22
export type Related = RelatedEntity[] | 'loading' | { error: string }       // App.tsx:575

export interface PlanView {                                                 // MyDay.tsx:47-55
  plan: Plan
  tasksById: Map<string, Task>
  suggestions: Map<string, Task>
  reasons: (task: Task) => Reason[]
  duplicates: Map<string, Task>
  highlight: string | null
  workingId: string | null
}

export interface BoardState {
  // Who and when
  developer: string                                   // App.tsx:563
  developers: { name: string; email: string }[]       // TEST_DEVELOPERS, bridge.ts:13
  today: string                                       // useToday, App.tsx:1344-1351
  lead: boolean                                       // App.tsx:698
  // Sprint
  sprint: Sprint | null                               // App.tsx:562
  sprintDay: number | null                            // App.tsx:1056
  sprintLength: number | null                         // App.tsx:1055
  sprintDaysLeft: number | null                       // App.tsx:1054
  workingDaysLeft: number | null                      // App.tsx:1007
  storyProgress?: QueueProgress                       // App.tsx:559, progress.stories
  // Loading and errors
  booting: boolean                                    // App.tsx:577
  bootSteps: BootStep[]                               // App.tsx:1072-1078
  bootSummary: string                                 // App.tsx:1080-1087
  queuesLoading: boolean                              // bridgeLoading, App.tsx:557
  queueErrors: Partial<Record<QueueSource, string>>   // bridgeErrors, App.tsx:558
  actionError: string | null                          // App.tsx:561
  // Items
  tasks: Task[]                                       // visibleTasks, App.tsx:733
  tasksById: Map<string, Task>                        // App.tsx:741
  working: Task | null                                // App.tsx:780
  queueTabs: { id: QueueSource; label: string; unplanned: number; total: number }[]  // App.tsx:48-58, 988-991
  queueItems: (source: QueueSource) => Task[]         // App.tsx:987
  blocked: Task[]                                     // App.tsx:990
  planned: Set<string>                                // App.tsx:986
  // The day
  plan: Plan                                          // App.tsx:564
  planView: PlanView                                  // App.tsx:1016-1024
  openEntries: number                                 // App.tsx:992
  nextUp: { entry: PlanEntry; task?: Task } | null    // App.tsx:1025-1030
  upNext: Suggestion[]                                // App.tsx:1009
  reviews: Reviews                                    // App.tsx:572
  events: DayEvent[]                                  // App.tsx:1012-1015
  brief: StandupBrief | { error: string } | null      // App.tsx:573
  teamBlockers: TeamBlocker[]                         // App.tsx:571
  calendarItems: Deadline[]                           // App.tsx:1065-1068
  tickerItems: { src: 'TEAM' | 'DATE'; text: string }[]  // App.tsx:1058-1064
  standupDraft: string                                // buildStandupDraft input, App.tsx:1099-1107
  // Per item
  ticks: Ticks                                        // App.tsx:565
  related: Record<string, Related>                    // App.tsx:575
  // UI state more than one mode needs
  view: 'myday' | 'focus'                             // App.tsx:566
  highlight: string | null                            // App.tsx:567
  toast: { id: number; text: string; undo?: () => void } | null  // App.tsx:569
  drag: { id: string | null; over: DropZone | null }  // App.tsx:552-553
  overlay: { detail: Task | null; linkFor: PlanEntry | null; reader: ReaderTab | null }  // App.tsx:555, 568, 576
}

export interface BoardActions {
  // Everything My Day already asks for (MyDay.tsx:25-44)
  toggle(entry: PlanEntry): void
  start(task: Task): void
  add(task: Task): void
  remove(entry: PlanEntry): void
  shift(entry: PlanEntry, delta: number): void
  reorder(id: string, beforeId: string | null): void
  confirm(entry: PlanEntry, task: Task): void
  reject(entry: PlanEntry, task: Task): void
  pick(entry: PlanEntry): void              // open the link picker
  open(task: Task): void                    // open an item (detail modal in Flow, pane in Scan)
  block(task: Task): void
  unblock(task: Task): void
  done(task: Task): void                    // scheduleDone, App.tsx:851-883
  resume(): void
  openReader(tab: ReaderTab): void
  doneTarget(task: Task): string | null     // 'ADO' | 'Notion' | null for read-only sources
  // Currently inline in App's JSX; promote to named actions
  returnToPlan(task: Task): void            // RETURN ×, App.tsx:1251
  unlink(entry: PlanEntry): void            // App.tsx:1294-1300
  closeDetail(): void
  closeLinkPicker(): void
  closeReader(): void
  setView(view: 'myday' | 'focus'): void
  toggleTick(task: Task, criterion: string): void   // App.tsx:738
  undoToast(): void                         // App.tsx:1320
  dismissToast(): void                      // new: the design's toast has ×; must not cancel or flush a pending done
  dismissActionError(): void                // App.tsx:1200
  changeDeveloper(email: string): void      // App.tsx:604-625
  finishBoot(): void                        // App.tsx:1334
  // Drag and drop (DOM-coupled; see §6.4)
  dragItem(e: React.DragEvent, id: string): void
  dropProps(zone: DropZone): React.HTMLAttributes<HTMLElement> & { 'data-drop'?: 'on' }
}
```

Implementation notes:
- Provide state and actions through two contexts. Make the actions object stable (hold the latest closures in a ref) so rows do not re-render on every state change.
- Keep `moveTask` private to the hook. Views call `start`, `add`, `block`, `unblock`, `remove`, `returnToPlan` or a drop. Every lane change then goes through the one function that writes to the source and offers undo (`App.tsx:799-833`).
- Keep `CockpitContext` (`Cockpit.tsx:14-28`) and fill it from the board. Recommendation: also add `loadDevLinks`, `loadNotes`, `saveNotes`, `loadRelated` and `capabilities(task)` to it, so cockpit parts stop calling `queueFor` directly (`Cockpit.tsx:121-122`, `282-283`). That is what lets the views run on fixtures.
- `related` is loaded today only for the working item (`App.tsx:784-793`). Scan shows a pane for any selected item, so generalise it: load related context through the cockpit cache (`useLoaded`, `Cockpit.tsx:62-78`) keyed `related:<queue>:<id>`.

---

## 3. Data contract reconciliation

The design's `design/src/types.ts` was written from the brief (`docs/FRONTEND_BRIEF.md` §3), which simplifies the real types. Use the current app's types everywhere. This section says what each design field maps to, and what to derive or drop.

### 3.1 `Task`

| Field | Ours (`src/types.ts`) | Design (`design/src/types.ts:7-27`) | Action |
|---|---|---|---|
| `id` | ADO number as a string, or a Notion page UUID | Fixture uses refs as ids for Notion items (`design/src/fixtures.ts:77`) | Use ours. Never treat `id` as display text. |
| `ref` | Optional (6-8) | Optional | Same. |
| `queue` | Adapter slug (9). `queueFor` needs it (`bridge.ts:708`) | Missing | Keep. Without it the cockpit can't load anything. |
| `url`, `link` | Source page, external ticket | Same | Same. |
| `notes` | **Card preview text**. For stories it is the description (`bridge.ts:348`); for Notion items the Notes or Description column (646, 662) | Used as the initial text of the developer's note (`design/src/components/Cockpit.tsx:17`) | Do not seed the notes editor from `task.notes`. The note comes from `adapter.notes.load` (`Cockpit.tsx:295`). |
| `standupAgeDays` | Tasks only | Same | Same. |
| `externalState` | Source state | Same | Same. |
| `parentId` | ADO parent (24); drives Project Context for stories (`bridge.ts:413-433`) | Missing | Keep. |
| `type` | `TaskType` | `ItemType` (same values) | Same. Tasks are always `task` today (`bridge.ts:640`); the fixture's `bug`/`spike` on Notion tasks don't occur. |
| `source` | `QueueSource` includes `zendesk` (4) | `Source` lacks it | Use ours. Zendesk has no adapter, so its tab is filtered out (`App.tsx:58`). |
| `title`, `description` | Description is text with line breaks, `• ` and `1.` markers and `[label](url)` links (`bridge.ts:243-311`) | Rendered by `DescriptionText`, which handles only `• ` lines and shows link markup raw (`design/src/components/Cockpit.tsx:367-379`) | Render with `RichText` (`src/RichText.tsx:48-54`). |
| `priority`, `priorityLabel`, `points` | Same | Same | Same. |
| `assignee` | Initials, `''` when none (`bridge.ts:526`, Pulse sets none) | Initials; `Avatar` falls back to `?` | Hide the avatar when empty, as `App.tsx:79` does. |
| `sprint`, `tags`, `acceptanceCriteria` | Same | Same | Same. |
| `status` | Lane | Lane | Same. The design also keeps a separate `workingId` (`design/src/App.tsx:21`) that can disagree with `status`; derive the working item from `status` only (`App.tsx:780`). |

### 3.2 `PlanEntry` and `Plan`

| Field | Ours (`src/plan.ts:11-41`) | Design (`design/src/types.ts:29-39`) | What breaks without it |
|---|---|---|---|
| `addedOn` | Day the entry appeared | Missing | The "Since Oct 2" origin chip (`MyDay.tsx:338`). |
| `briefDate` | Standup it came from | Missing | "From Oct 2 standup" (`MyDay.tsx:337`), and `mergeBrief`'s repeat detection (`plan.ts:97-99`). |
| `mentions` | Notion page ids @mentioned | Missing | Exact linking by mention (`plan.ts:190`). |
| `itemId`, `itemRef`, `itemSource`, `linkedBy` | Same | Same | |
| `rejected` | Suggestions turned down | Missing | ✕ on "Looks like…" would keep re-suggesting (`plan.ts:200`, `220`). |
| `done`, `missing` | Same | Same | |
| `doneAt` | Set once the done write landed | Missing | The tick lock (`MyDay.tsx:333`) and "done elsewhere" ticking (`App.tsx:774`). |
| `Plan.day`, `mergedBriefs`, `doneLog` | Plan wrapper | Design's plan is a bare `PlanEntry[]` (`design/src/App.tsx:20`) | Carry-over (`plan.ts:67-74`), merge-once, and the standup draft's Done section (`plan.ts:78-83`). |

### 3.3 Other shapes

| Design type | Ours | Differences and action |
|---|---|---|
| `UpNextSuggestion` (`design/src/types.ts:41-45`) | `Suggestion` (`src/ranking.ts:14-18`) | Same shape. The fixture's reasons ("Compliance risk", "Correlates with active incident", `design/src/fixtures.ts:219-245`) are not reasons `ranking.ts` can produce (`ranking.ts:49-86`). Design only for the real reason set: aging, standup age, sprints behind, P1/P2, sprint ending, points, Solarwinds priority and state. |
| `PullRequest` (`design/src/types.ts:47-56`) | `PullRequest` (`bridge.ts:438-446`) | Design adds `daysOld`: derive it with `reviewAge` (`MyDay.tsx:202`). Design's `author` is initials and is drawn in an `Avatar`; ours is a name (or null). Show the name, or derive initials. `repo` and `createdDate` can be null in ours. |
| `Sprint` (`design/src/types.ts:58-65`) | `Sprint` (`bridge.ts:62-67`) | Ours has nullable `number`, `start`, `end`. Design's `dayNumber`, `totalDays` don't exist: use `sprintDay`, `sprintLength` (`App.tsx:1055-1056`). Every sprint label must handle `null` ("Sprint not loaded", `MyDay.tsx:262`). |
| `StandupBrief` (`design/src/types.ts:67-75`) | `StandupBrief` (`bridge.ts:74-83`) | Ours: `date` can be null (mode `none`), `summaries` is always present but filled only in `leadership` mode, optional `title`. The fixture has summaries in `brief` mode (`design/src/fixtures.ts:30-33`), which the API never sends. Lines carry `mentions` of Notion page ids, not refs. |
| `ComingUp` (`design/src/types.ts:77-82`) | `DayEvent` (`schedule.ts:9-15`) | Ours adds `detail` (the team item a date was read from, shown as a tooltip, `MyDay.tsx:503`). |
| `DevLinks` (`design/src/types.ts:84-91`) | `DevLinks` (`bridge.ts:191-198`) | Ours types `status`/`result` as nullable strings, not unions. Map labels with `prBadge`/`buildBadge` (`Cockpit.tsx:130-144`), which also handle drafts, `canceled` and running builds. The design renders neither `commits` nor `workItems`; keep both. |
| `RelatedEntity` (`design/src/types.ts:93-101`) | `RelatedEntity` (`bridge.ts:85-95`) | Ours adds `id` (keys, `App.tsx:414`), `properties[].type` (relations filtered out, `App.tsx:423`) and `sub_pages`. Our `relation` values are `initiative`, `issue`, `analystIssue`, `parent`; the fixture uses display names ("Initiative"). Labels come from `relationLabel` (`App.tsx:354-357`); card fields from `RELATION_FIELDS` (`App.tsx:343-348`), not every property. |
| `Developer` (`design/src/types.ts:103-108`) | `{ name, email }` (`bridge.ts:13-20`) | `initials`: derive from the name. `isLead`: do **not** add to the developer list. Lead is derived from the brief: `brief.mode === 'leadership'` (`App.tsx:698`). |
| `AppState` (`design/src/types.ts:110-116`) | `BoardState` (§2.4) | `workingId` is dropped; `mode` moves to a UI preference (§5 Phase 6). |
| `WorkMode` | None | New UI preference. |
| `STANDUP_DRAFT` string (`design/src/fixtures.ts:260-272`) | `buildStandupDraft(input)` (`src/standup.ts:22-58`) | The design's draft is a fixed string. Ours is generated from `plan` (done entries and `doneLog`), `tasksById`, `blocked`, `reviews` and `ticks`. Feed the reader's draft tab from `BoardState.standupDraft`. |
| `COMING_UP` in the calendar tab (`design/src/components/Cockpit.tsx:350-356`) | `calendarItems: Deadline[]` (`App.tsx:1065-1068`) | The calendar tab must list Deadlines and Milestones through sprint end + 42 days, not the 21-day Coming up list. |

### 3.4 Fields the design assumes that we don't have

| Field | Source of truth instead |
|---|---|
| `Developer.initials`, `Developer.isLead` | Derive initials from `name`; lead from `brief.mode`. |
| `Sprint.dayNumber`, `Sprint.totalDays` | `sprintDay`, `sprintLength`. |
| `PullRequest.daysOld` | `reviewAge(pr, today)`. |
| Hardcoded "Last day", "Sprint ends today" (`Timeline.tsx:81`, `Document.tsx:59`, `126`) | Derive from `sprintDaysLeft === 0`. Use `warn`, not `danger`: it is attention, not failure. |
| Fixture reasons, fixture dev links and context for every item | Real loaders; show loading, empty and error states. |

### 3.5 Fields we have that the design omits (and must still show)

| Field | Where it shows today | Where it goes in the new UI |
|---|---|---|
| `externalState` | Card chip, plan row chip, cockpit header (`App.tsx:153`, `MyDay.tsx:399-401`, `App.tsx:486`) | Row meta line and cockpit header. Hide "Blocked" when the lane already says so (`MyDay.tsx:399`). |
| `priorityLabel` | Reasons (`ranking.ts:70-80`) | Cockpit priority line (the design already prefers it, `design/src/components/Cockpit.tsx:63`). |
| `standupAgeDays` | `STANDUP 9d`, warn when over 6 (`App.tsx:156-158`) | Row meta; warn colour over `STALE_STANDUP_DAYS`. |
| `acceptanceCriteria` progress | `AC 2/3` chip (`Cockpit.tsx:111-117`) | Row meta in Scan and Flow. |
| `linkedBy` | Not shown directly | Optional tooltip on the ref ("linked by mention / ref / title match / you"). |
| `missing` | "Not on your board" chip (`MyDay.tsx:398`) | Plan row chip. |
| `mentions` (brief lines) | Brief lines that mention a task show `DEV-… ↗` (`App.tsx:1368-1377`) | Reader brief tab. |
| `QueueProgress` | "Stories 1/5 · 3/9 pt" (`MyDay.tsx:289-294`) | Header or day header. |
| `TeamBlocker` | Lead's Team today (`MyDay.tsx:546-556`) | Lead section (§6.9). |
| `doneLog` | Standup draft Done (`plan.ts:78-83`) | Unchanged. |

---

## 4. Design system migration

### 4.1 How the two systems differ
- **Ours**: raw values on `:root` (`src/index.css:16-35`), mapped to Tailwind utilities by `@theme inline` (`37-77`). Components use utilities (`bg-surface`, `text-muted`, `text-meta`). Inline `style` only for data-driven values (`docs/IMPLEMENTATION.md:246`).
- **Design**: one token block per `[data-mode]` (`design/src/index.css:7-86`), consumed through inline `style={{ ... 'var(--x)' }}` in almost every element. Tailwind is imported but barely used.

Port the design's look into utilities and tokens. Do not copy inline styles.

### 4.2 Token mapping

| Design variable | Our token (`:root`) | Tailwind | Notes |
|---|---|---|---|
| `--bg` | `--bg` | `bg-bg` | |
| `--surface` | `--surface` | `bg-surface` | |
| `--surface2` | `--sunken` | `bg-sunken` | Flow `#0a1220` vs ours `#08101c`: keep ours. |
| `--surface3` | **new** `--raised` | `bg-raised` | Flow `#111e30`. Used by toasts, counters, selects. |
| `--border` | `--line` | `border-line` | |
| `--border-mid` | **new** `--line-strong` | `border-line-strong` | Hover and card borders. |
| `--border-bright` | **new** `--focus` | `outline-focus`, `border-focus` | Selected row, focus ring, active card. |
| `--text-title` | `--ink` | `text-ink` | |
| `--text` | `--fg` | `text-fg` | |
| `--text-secondary` | `--dim` | `text-dim` | |
| `--text-muted` | `--muted` | `text-muted` | |
| `--text-dim` | `--faint` | `border-faint`, `bg-faint` | **Decoration only.** The design uses it for text in about 60 places (section labels, refs, hints, tab labels, `.label`). Remap all of those to `text-muted`. |
| `--accent`, `--accent-bg` | `--accent` | `text-accent`, `bg-accent/10` | Tailwind v4 opacity modifiers work on `var()` colours. |
| `--green`, `--green-bg` | `--ok` | `text-ok`, `bg-ok/10` | |
| `--amber`, `--amber-bg` | `--warn` | `text-warn`, `bg-warn/10` | |
| `--red`, `--red-bg` | `--danger` (+ `--danger-fg` for error text) | `text-danger-fg`, `bg-danger/10` | |
| `--purple`, `--purple-bg` | **drop** | | No meaning in our colour rule. |
| `--panel-top` | **new** `--panel-top` | used by `.panel::before` | Today hardcoded in `index.css:162`; `none` in light. |
| `--font-mono` | `--font-mono` | `font-mono` | Same fonts: Inter and JetBrains Mono. |

Also tokenise the remaining hardcoded colours in `src/index.css` before a light theme can work: the scrollbar (`95-96`), `.chip` and `.btn-quiet` backgrounds (`129`, `140`), `.panel::before` (`162`), `.panel-header` (`177`), `.task-card` borders (`181`, `186`), drop glows (`191-198`), `.row` hover and focus (`203`, `208`), `row-flash` (`237`), and the `bg-black/…` and `bg-white/[…]` utilities in components (for example `App.tsx:1131`, `252`, `367`).

### 4.3 Themes (Recommendation)

```css
/* src/index.css, after @import 'tailwindcss' */
:root, [data-theme='dark'] { /* today's values, plus: */
  --raised: #111e30;
  --line-strong: rgba(0, 180, 220, 0.25);
  --focus: rgba(0, 212, 255, 0.5);
  --panel-top: linear-gradient(90deg, transparent, rgba(0, 212, 255, 0.35), transparent);
  color-scheme: dark;
}
[data-theme='light'] {
  --bg: #f2f0ec;  --surface: #ffffff;  --sunken: #f7f5f1;  --raised: #ede9e3;
  --line: rgba(0, 0, 0, 0.08);  --line-soft: rgba(0, 0, 0, 0.05);  --line-strong: rgba(0, 0, 0, 0.14);
  --focus: rgba(0, 107, 138, 0.5);  --panel-top: none;
  --ink: #1a2030;  --fg: #2a3344;  --dim: #4a5c70;
  --muted: #5a6676;      /* design #718096 fails AA, see 4.4 */
  --faint: #a0aec0;      /* decoration only */
  --accent: #006b8a;
  --ok: #0b6e48;         /* design #0d7a50 fails on --raised */
  --warn: #85570a;       /* design #92600a fails on --raised */
  --danger: #b91c1c;  --danger-fg: #b91c1c;
  color-scheme: light;
}
@theme inline {
  --color-raised: var(--raised);
  --color-line-strong: var(--line-strong);
  --color-focus: var(--focus);
  /* existing mappings unchanged */
}
```

Set `data-theme` on `<html>`, not on a wrapper, so modals, toasts and the body background follow. Respect `prefers-color-scheme` when the preference is "system". Add `data-density='compact'` with a small set of spacing tokens (row padding, gaps); Tailwind can target it with a custom variant (`@custom-variant compact ([data-density='compact'] &);`).

Recommendation: keep one dark palette (today's, which equals the design's Flow palette and already passes AA). Do not ship the design's Scan palette (neutral grey with blue accent) unless the product owner asks; if they do, use the fixes in 4.4.

### 4.4 Contrast (computed, WCAG 2.x relative luminance)

Each value is the ratio of the text colour against `--bg` / `--surface` / `--sunken` (surface2) / `--raised` (surface3). AA needs 4.5:1 for text under 18px. **Bold** marks a failure.

**Dark (Flow palette = current tokens)**

| Text | bg | surface | sunken | raised | Verdict |
|---|---|---|---|---|---|
| ink `#e0f0ff` | 16.96 | 15.59 | 16.14 | 14.44 | pass |
| fg `#c8dff0` | 14.33 | 13.16 | 13.63 | 12.19 | pass |
| dim (design `#9bbdd4`) | 9.97 | 9.16 | 9.48 | 8.48 | pass |
| muted `#7090a8` | 5.86 | 5.38 | 5.57 | 4.99 | pass |
| faint / design text-dim `#4a6a84` | **3.46** | **3.18** | **3.29** | **2.94** | fail: decoration only |
| accent `#00d4ff` | 11.13 | 10.23 | 10.59 | 9.47 | pass |
| ok `#00ff88` | 14.69 | 13.50 | 13.98 | 12.51 | pass |
| warn `#ffaa00` | 10.32 | 9.49 | 9.82 | 8.79 | pass |
| danger `#ff3355` | 5.50 | 5.05 | 5.23 | 4.68 | pass (use `danger-fg` `#ff7a90`, 7.28 on surface, for error sentences) |
| design purple `#a855f7` | 4.98 | 4.58 | 4.74 | **4.24** | drop the colour |
| design ADS blue `#60a5fa` | 7.75 | 7.12 | 7.37 | 6.60 | drop (sources are not colour-coded) |

Other pairs: `fg` on a selected row (accent 10% over surface) 10.92; `faint` on a selected row **2.64**; `bg` on accent (primary button hover) 11.13.

**Design Scan palette (only if kept)**

| Text | bg | surface | sunken | raised | Fix |
|---|---|---|---|---|---|
| muted `#607080` | **3.82** | **3.46** | **3.59** | **3.16** | `#8593a6`: 6.22 / 5.64 / 5.85 / 5.14 |
| text-dim `#3d5060` | **2.33** | **2.11** | **2.19** | **1.92** | decoration only |
| accent `#3b82f6` as text | 5.28 | 4.79 | 4.97 | **4.37** | `#5b9bf8`: 6.93 / 6.28 / 6.52 / 5.73 |
| red `#ef4444` as text | 5.16 | 4.68 | 4.86 | **4.27** | `#f87171`: 7.03 / 6.37 / 6.61 / 5.81 |
| purple `#8b5cf6` | 4.59 | **4.16** | **4.32** | **3.79** | drop |

White text on the Scan accent would be 3.68 (fail); the design uses dark text on accent (5.28, pass).

**Light (design Calm palette, and the proposed fixes)**

| Text | bg | surface | sunken | raised | Fix |
|---|---|---|---|---|---|
| title `#1a2030` | 14.27 | 16.24 | 14.91 | 13.43 | keep |
| text `#2a3344` | 11.15 | 12.69 | 11.65 | 10.49 | keep |
| secondary `#4a5c70` | 6.04 | 6.87 | 6.31 | 5.68 | keep as `--dim` |
| muted `#718096` | **3.53** | **4.02** | **3.69** | **3.32** | `#5a6676`: 5.13 / 5.84 / 5.36 / 4.83 |
| text-dim `#a0aec0` | **1.98** | **2.26** | **2.07** | **1.87** | decoration only |
| accent `#006b8a` | 5.32 | 6.05 | 5.56 | 5.00 | keep |
| green `#0d7a50` | 4.71 | 5.36 | 4.92 | **4.43** | `#0b6e48`: 5.53 / 6.29 / 5.78 / 5.20 |
| amber `#92600a` | 4.73 | 5.38 | 4.95 | **4.45** | `#85570a`: 5.48 / 6.24 / 5.73 / 5.16 |
| red `#b91c1c` | 5.68 | 6.47 | 5.94 | 5.35 | keep |
| ADS blue `#60a5fa` | **2.23** | **2.54** | **2.33** | **2.10** | drop |

The calculation script is simple to rerun: relative luminance per WCAG 2.1, alpha backgrounds composited over `--surface`. Recommendation: commit it as `scripts/contrast.mjs` reading the token blocks, and run it in Phase 1.

### 4.5 Type sizes

Our scale (`src/index.css:58-74`): 10 badge (counters and badges only), 11 meta, 12 note, 13 body, 14 read, 16 stat, 18 title, 21 display. Nothing below 10px.

The design uses 8px in 8 places and 9px in 49 inline places plus three CSS classes (`.mode-hint` 265, `.section-label` 285, `.avatar` 300). It uses 10px for labels, chips and buttons (`.label` 112, `.chip` 154, `.btn` 177), which our scale reserves for counters.

| Design size | Used for | Map to |
|---|---|---|
| 8px | "Work mode" label, header date, header stat labels, REQUIRED, queue sub-tabs, key hint footer, "▸ active" (`design/src/App.tsx:78,110,139`; `Inbox.tsx:133,155,187,291`; `Document.tsx:242`) | `text-meta` (11), or `text-badge` (10) for the stat labels |
| 9px | Section labels, refs, mode hints, filter tabs, tags, PR/build meta, ghost buttons | `text-meta` (11); section labels `.label` (11) |
| 10px | Chips, buttons, `.label`, counts | `text-meta` (11); counts `text-badge` (10) |
| 11px | Small body | `text-meta` or `text-note` |
| 12px | Row titles | `text-note` (12); plan and item titles should be `text-body` (13) |
| 13px | Body, header clock | `text-body` |
| 15px | Calm section headings | `text-read` (14) semibold |
| 17px | Cockpit title | `text-title` (18) |
| 22px, 24px | Day header | `text-display` (21) |

Brief problem 8 ("small mono text everywhere", `docs/FRONTEND_BRIEF.md:188`): use Inter for titles, rows, tabs and buttons; keep mono for refs, counts, chips and section labels only. The design's buttons and filter tabs are all mono uppercase; make them Inter sentence case.

### 4.6 Status colour rule (unchanged)

`accent` = interactive or selected; `ok` = done or active; `warn` = needs attention; `danger` = critical, blocked or failed (`src/index.css:13-14`). Sources and item types are not colour-coded; MED and LOW are neutral (`docs/IMPLEMENTATION.md:242-243`).

Places where the design breaks the rule, and the fix:

| Design | File:line | Fix |
|---|---|---|
| Type chips coloured: story purple, task accent, bug/alert/incident red, spike/ticket amber | `design/src/index.css:163-169` | Neutral `.chip`. A Pulse "alert" is not a failure. |
| Source chips and queue tabs coloured per source | `design/src/components/atoms.tsx:30-41`; `Timeline.tsx:20-26` | Neutral text label. |
| MED priority dot uses accent | `design/src/index.css:145` | `bg-dim` as in `App.tsx:39`. |
| Urgent reason chips red | `design/src/index.css:293` | `warn`, as `MyDay.tsx:314`. |
| Coming up: deadline red, team green | `Timeline.tsx:224`; `design/src/components/Cockpit.tsx:353` | Mark and tone from `KIND_MARK` (`MyDay.tsx:492-496`). |
| REQUIRED in red | `Inbox.tsx:155`; `Document.tsx:242`; `Timeline.tsx:211` | Neutral chip, as `MyDay.tsx:234`. |
| Abandoned PR "Closed" in red | `design/src/components/atoms.tsx:153` | Muted, label ABANDONED (`Cockpit.tsx:127`). |
| "Last day" / "Sprint ends today" red | `Timeline.tsx:81`; `Document.tsx:59,126` | `warn`. |
| Avatar colours by initials | `design/src/components/atoms.tsx:45-47` | One neutral or accent tint (`App.tsx:81`). |
| "Working" uses green, active row green background | `Inbox.tsx:282`; `Document.tsx:303` | Correct (`ok` = active). Keep. |
| Blocked section red | `Timeline.tsx:157`; `Document.tsx:186` | Correct. Keep. |

### 4.7 Spacing, shape and motion
- Header height: design 48px, ours 52px. Use 48px.
- Radii: design 3-6px, ours 2-4px (`rounded-xs`). Use `rounded-sm` (4px) for cards and `rounded-xs` for chips.
- Drop the HUD ornaments in the new modes: `hud-corner` (`index.css:214-224`) and glow shadows. The design's Flow keeps a faint panel top line (`--panel-top`); keep it in dark only.
- Motion: the design adds `slide-in-right`, `fade-in`, `toast-in` and `pulse-dot` (`design/src/index.css:225-233`) with no reduced-motion guard. Add them to the `prefers-reduced-motion` block (`src/index.css:253-258`).

---

## 5. Phased migration plan

Each phase is one pull request that can merge on its own. The classic view keeps working until Phase 7.

**Switch between old and new during the migration (Recommendation):** a URL parameter plus a stored preference, for example `?ui=scan|flow|classic`, read once in `App.tsx`. Default stays `classic` until Phase 6.

**How to run for verification:** the Vite server proxies `/bridge` and `/ado` (`vite.config.ts:37-48`). Use ado-bridge in mock mode (`ADO_MOCK=true`). Notion writes are live: only claim, release or mark done the `Bridge Test` rows (`docs/IMPLEMENTATION.md:57`), and get the owner's permission for any other write. `VITE_ADO_STORIES=false` turns off Stories and Reviews (`src/bridge.ts:627`).

**Regression checklist (R).** Every phase must keep these working. They come from `docs/IMPLEMENTATION.md` §4 and §5.

| # | Check |
|---|---|
| R1 | Queues load per source with counts; a failing source shows its own error and others still load. |
| R2 | Lanes survive a reload (`devDashboard.lanes.<email>`). |
| R3 | Pulse: adding to the plan claims it (toast with UNDO); moving back releases it. |
| R4 | Story: adding sets Active, block sets Blocked, unblock sets Active; UNDO reverts. |
| R5 | ✓ DONE hides the item at once; UNDO within 6 s leaves the source untouched; after 6 s the write happens; closing the tab sends it at once. |
| R6 | Only one item in Working; starting another returns the first to the plan. |
| R7 | Plan: standup responsibilities merge once; unfinished entries carry over; a repeated line refreshes its entry. |
| R8 | Linking: mention or ADO number links exactly; title match links or suggests "Looks like…" with CONFIRM/✕; link picker links and REMOVE LINK unlinks. |
| R9 | Ticking a linked entry marks the item done in its source (with undo); a linked item done elsewhere ticks and locks its entry. |
| R10 | Up next: ranked with reasons; planned items excluded; possible duplicates flagged. |
| R11 | Reviews waiting: oldest first, flagged after 2 days, REQUIRED, opens ADO; "needs an updated ado-bridge" on 404. |
| R12 | Cockpit: AC ticks persist per developer and clear on done; dev links load with loading/error/empty states; linked items include ref matches; notes save with ⌘/Ctrl+Enter and keep unsaved text across tasks. |
| R13 | Project context cards open a full view. |
| R14 | Reader: brief, team items and dates, calendar with sprint bars, standup draft with COPY and RESET. |
| R15 | Lead (Steven): Team today with each developer's update and blocked ADO stories. |
| R16 | Developer switch: pending done is sent first, data reloads, plan and ticks swap. |
| R17 | Keyboard: j/k, Enter, s, t, x/space, d, b, Alt+↑/↓, Delete; p/n/q; Esc. No shortcut fires while typing or with a modal open. |
| R18 | `npx tsc --noEmit` and `npm run build` are clean; no console errors on load. |
| R19 | No text under 10px; no text under 4.5:1 (measure on the live page, as `docs/IMPLEMENTATION.md:275`). |
| R20 | No horizontal scroll at 1280×720, 1440×900, 1920×1080 (and 1024×768 once the new modes ship). |

### Phase 0: safety net and shared state, no visual change

**Status (2026-10-06): built.** 88 tests cover `plan.ts`, `ranking.ts`, `cockpitLogic.ts`, `standup.ts`, `schedule.ts` and `keys.ts` (`npm test`). `App()`'s state moved to `src/board/useBoard.ts` and the current UI to `src/classic/`. The rendered HTML matched the pre-refactor build for My Day, the focus view, the detail modal, all four reader tabs, the link picker and a developer switch. Two small bug fixes came with it: `plan.ts` now links `#12345` mentions after a space, and one known flaw is a todo in `schedule.test.ts`. The `?ui=classic` switch isn't needed until a second layout exists (Phase 4).

**0a. Tests for the pure logic (Recommendation, see §8.2).** Add Vitest and tests for `plan.ts`, `ranking.ts`, `cockpitLogic.ts`, `standup.ts`, `schedule.ts`. This locks behaviour before the refactor.

**0b. Extract `useBoard`.**
- **Files:** new `src/board/types.ts`, `src/board/useBoard.ts`, `src/board/BoardContext.tsx`; move presentation from `src/App.tsx` into `src/classic/*.tsx` (TaskCard, DetailModal, LinkPicker, WorkingSpace, Related*, BriefPanel, TickerList, Overlay, ReaderModal, CalendarList, Stat, Clock) and `src/MyDay.tsx` to `src/classic/MyDay.tsx`. `App.tsx` becomes `<BoardProvider><ClassicApp/></BoardProvider>`.
- **Build:** move lines 550-1124 into the hook unchanged. Turn the inline JSX handlers into named actions (`returnToPlan`, `unlink`, `closeDetail`, …) as listed in §2.4. Move `DropZone`, `ReaderTab`, `Reviews`, `PlanView` types into `board/types.ts` and re-export them from `classic/MyDay.tsx`.
- **Verify in the browser:** the app looks and behaves exactly as before. Walk R1-R17. Diff a screenshot of My Day, the focus view and each overlay against `main`.
- **Must still work:** all of R.

### Phase 1: token layer and theme switch

**Status (2026-10-06): built.** `index.css` has the dark and light token blocks and no hardcoded colours; `src/ui/theme.ts` stores and applies the preferences (layout, theme, density); `npm run contrast` and `/?ui=tokens` check and show both themes; the boot screen follows the theme (Q5). Dark is unchanged: the computed styles of all 363 elements matched the previous build, with identical values. `FORCE_DARK` keeps the classic layout dark until the new layouts ship. The HUD ornaments (Q4) are still in place, and the option to turn them off is part of the theme picker in Phase 6.

- **Files:** `src/index.css`; new `src/ui/theme.ts` (read and store `theme` and `density`, set `data-theme`/`data-density` on `<html>`); optional `scripts/contrast.mjs`.
- **Build:** add the tokens in §4.3; tokenise the hardcoded colours listed in §4.2. Keep the classic view forced to dark (`data-theme='dark'` while `ui=classic`): it still uses `bg-black/…` utilities in places.
- **Verify:** classic view unchanged in dark. Temporarily set `data-theme='light'` on a test page that renders a sample of chips, buttons and text tokens; check the contrast script passes for both themes.
- **Must still work:** R18, R19.

### Phase 2: shared atoms

**Status (2026-10-06): built.** `src/ui/atoms.tsx`, `Overlay.tsx`, `Toast.tsx` and `labels.ts` are in, with the `/?ui=atoms` gallery and 44 tests (including keyboard behaviour for tabs and the overlay's focus trap, checked in a real browser too). `Button` is Inter sentence case, and the overlay drops the HUD corner brackets. The classic layout still uses its own copies and is untouched.

- **Files:** new `src/ui/atoms.tsx`, `src/ui/Toast.tsx`, `src/ui/Overlay.tsx`.
- **Build:** in Tailwind utilities, with the design's proportions and our rules:
  - `Chip` (neutral; variants only for status: ok, warn, danger),
  - `TypeChip` (neutral, label from `TYPE_LABELS`, `App.tsx:44-46`),
  - `PriorityBadge` (dot + label; rules from `PRIORITY_CONFIG`, `App.tsx:36-42`),
  - `Avatar` (hidden when empty),
  - `Ref`, `SectionLabel` (with count and right slot),
  - `Checkbox` (a `<button role="checkbox" aria-checked>`, not a `div`),
  - `Button` (quiet, primary, done, danger),
  - `EmptyState`, `ErrorNote` (dismissible variant),
  - `Kbd`, `Tabs` (`role="tablist"`, arrow keys),
  - `PrStatus`, `BuildStatus` (labels from `Cockpit.tsx:124-144`),
  - `Toast` (UNDO, ×, `role="status"`).
- **Verify:** a temporary `?ui=atoms` gallery page, in both themes and both densities.
- **Must still work:** classic view untouched (atoms are not used yet).

### Phase 3: the cockpit pane, reusing existing logic

**Status (2026-10-06): built.** `src/Cockpit.tsx` is split into `src/ui/cockpit/` (context, load cache, `Checklist`, `DevLinks`, `LinkedItems`, `Notes`, `ProjectContext`, lane rules in `actions.ts`, and `CockpitPane`), restyled with the shared components. The classic detail modal and Working Space are now thin frames around the pane, so dev links and project context load for any item (defect D4) and the pane is keyed by item (D7). Project context loads inside the pane, so `useBoard` no longer holds `related`. 44 new tests; checked in the browser for a story, a Task, a Pulse item, a Solarwinds ticket and an ADS ticket, and for Start, Block, Unblock and Return through the pane.

- **Files:** `src/ui/cockpit/*` (split `src/Cockpit.tsx`), `src/ui/cockpit/ProjectContext.tsx` (from `App.tsx:359-469`), `src/ui/cockpit/CockpitPane.tsx`.
- **Build:**
  - Header: type, ref, source label, external state, `NOTION ↗`/`ADO ↗`/`TICKET ↗`, priority line, points, sprint, avatar.
  - Action bar by lane: queue → `▶ Start`, `＋ Plan` (`＋ Claim` for Pulse); today → `▶ Start`, `Block`; working → `Return to plan`, `Block`; blocked → `Unblock`; any doneable → `✓ Done` (`doneTarget`). This fixes defect D4 (§7).
  - Main column: title, description (`RichText`), `Checklist`, `Notes`, tags.
  - Side column (280px at ≥1200px wide, stacked below it): `DevLinks` for any story, not only the working one; `ProjectContext` for any item with a queue; `LinkedItems`.
  - Key the pane by `task.id` so local state can't leak between items (defect D7).
  - Replace the classic `DetailModal` body and `WorkingSpace` with `CockpitPane`, so the pane is proven in the classic view before any new mode depends on it.
- **Verify:** open a story, a Task, a Pulse item, a Solarwinds ticket and an ADS ticket in the detail modal and while working. Check loading, empty and error states for dev links, notes and context (stop ado-bridge to force errors).
- **Must still work:** R5, R6, R12, R13.

### Phase 4: Scan mode

**Status (2026-10-06): built.** `src/modes/scan/` (layout, entry, pull request and team panes, typed selection), `src/ui/` (`Header`, `rows`, `LinkPicker`, `Reader`, `keymap`, `Clock`, `useMediaQuery`). Reachable at `/?ui=scan`; the classic layout stays the default. Fixes D1 (a plan row shows its item), D2 (reviews have a pane), D3 (hints come from the key table and a test presses every key), D4 and D7 (via the pane). 34 new tests. Checked in the browser: every list, the entry pane, start and add by key, the link picker, the reader, a lead's Team tab, drag onto the Blocked tab, Enter and Esc between list and pane, light theme, and an 800px window. Two bugs found and fixed on the way: the overlay overrode `autoFocus`, and it forgot what opened it when it had an `autoFocus` input.

- **Files:** `src/modes/scan/ScanMode.tsx`, `src/ui/rows/*`, `src/ui/Header.tsx` (minimal), `src/ui/LinkPicker.tsx`, `src/ui/Reader.tsx`.
- **Build:**
  - Left list (320px, `clamp(280px,24vw,360px)`): filter tabs Plan / Queue / Next / Reviews / Blocked with counts; a sixth **Team** tab for leads (§6.9). Queue has source sub-tabs with unplanned counts (`App.tsx:1180-1193`).
  - Rows are focusable `data-row` elements inside `data-rows="<filter>"`, with `rowKeys` (§6.11). Focus is the selection: `onFocus` sets the selected id.
  - Selection is a typed union, not a bare id: `{ kind: 'entry', id } | { kind: 'task', id } | { kind: 'review', id }`. This fixes D1 and D2.
  - Pane: `CockpitPane` for a task; an **entry pane** for an unlinked plan entry (§6.6); a **PR pane** for a review (§6.8); when nothing is selected and an item is in Working, show it; otherwise an empty state.
  - Errors and loading per source in the list; action error banner above the list.
  - Footer key hints generated from the same table as the handlers (§6.11), so they can't drift again (D3).
  - Drag and drop: rows are draggable; filter tabs Plan, Blocked and Queue accept drops; the pane header accepts a drop to start (§6.4).
- **Verify:** the manual script for Scan (§8.1).
- **Must still work:** all of R in Scan, plus classic.

### Phase 5: Flow mode

**Status (2026-10-06): built.** `src/modes/flow/` (`FlowMode`, `sections`, `dayStrip`, `sprintLine`), `src/ui/QueueDrawer.tsx`, `src/ui/DetailModal.tsx` (Scan uses it too), `src/board/paneHandlers.ts` (shared by both modes), and a `layout` option on `CockpitPane` (`pane`, `flow`, `compact`). Reachable at `/?ui=flow`. Flow's keys live in `src/ui/keymap.ts` (`FLOW_KEYS`, and `hintsFor(…, 'flow')`). Checked in the browser: expand and collapse a plan row (Enter, Esc, focus returns), `q` opens the drawer and focuses its first card, Esc closes it and returns focus, a card dragged from the drawer onto the plan, a plan row dragged onto Blocked (the section appears while dragging), the reader from the calendar link, and an 800px window (no sideways scroll, drawer full width). Differences from the plan above: a plan row dragged onto Working starts its item and onto the drawer removes it from the plan; Enter on an *unlinked* row opens the picker (§6.6) while a click expands it to show the suggestion; Esc does not toggle the Working card.

- **Files:** `src/modes/flow/FlowMode.tsx`, `src/ui/DetailModal.tsx`, `src/ui/QueueDrawer.tsx`.
- **Build:**
  - Centre column (max 720px): day header (date, sprint line, brief chip, standup draft, story progress); lead's Team today; Today's plan (rows with reorder by drag and Alt+↑/↓); the Working card (full `CockpitPane`, not the compact one); Blocked (drop zone); Up next; Reviews; Coming up; Team notes.
  - Inline expansion of a plan row shows the compact cockpit *plus* a "Open full" button; the compact layout must still show dev links and context below the notes, not hide them (design hides the side column when compact, `design/src/components/Cockpit.tsx:149`).
  - Queues drawer (right, 360px, `q` opens and focuses it, Esc closes and returns focus). The drawer is a `queue` drop zone.
  - "+ Add item" opens the drawer (the design's button does nothing, `Timeline.tsx:128-130`).
  - Detail modal for items opened from Up next, Blocked or the drawer.
- **Verify:** the manual script for Flow (§8.1).
- **Must still work:** all of R in Flow.

### Phase 6: header, mode switcher, theme, density, persistence

- **Files:** `src/ui/Header.tsx`, `src/ui/ModeSwitcher.tsx`, `src/App.tsx`.
- **Build:**
  - Header: brand; sprint line from data; switcher (Scan, Flow; theme Dark/Light/System; density); PLANNED (open entries), BLOCKED; TEMP developer switcher (kept visibly temporary); clock.
  - The switcher is a `role="radiogroup"` (or tabs) with arrow-key support and `aria-checked`.
  - Persist per developer, matching the existing key scheme: `devDashboard.ui.<email>` = `{ mode, theme, density }`. The design's key `devdash:mode` (`design/src/App.tsx:10`) is not per developer and doesn't follow the scheme.
  - Default for a developer with no saved preference: Scan (decision needed, §9).
  - Narrow windows: below 1100px default to Flow if the developer has not chosen (§6.12).
  - Keep `classic` reachable through `?ui=classic` until Phase 7.
- **Verify:** switch modes with an item in Working, a pending done, an open overlay and an unsaved note: nothing is lost, the pending done still completes or undoes, the note draft survives (`Cockpit.tsx:278`).
- **Must still work:** R5, R12, R16.

### Phase 7: cleanup

- **Files:** delete `src/classic/`, unused parts of `src/MyDay.tsx`, `hud-corner`, CRT and boot styles if the boot screen is retired; update `docs/IMPLEMENTATION.md` §4 (layout, keyboard, styling) and the brief's §2; remove the `?ui=` switch.
- **Verify:** `tsc`, build, full R list in both modes and both themes; check `git grep` finds no references to removed components.

---

## 6. Missing pieces to build

The design shows the happy path only. Each item below says whether it is still needed and how it should behave.

### 6.1 Loading and boot
**Needed.** First load takes 10-20 s cold (`docs/IMPLEMENTATION.md:317`).
- Recommendation: replace the terminal boot with a quiet state that does not block the page.
  - Header shows a thin progress line and the five steps as a small list (uplink, sprint, queues, brief, deadlines) from `bootSteps` (`App.tsx:1072-1078`), each pending, OK or failed.
  - Lists show three skeleton rows per section.
  - The page is usable as soon as queues resolve; the brief and deadlines fill in later.
  - On a developer switch, the same state shows again (`changeDeveloper` resets everything, `App.tsx:604-625`).
- If the product owner keeps the boot screen, keep `BootScreen` as is and show it only on a cold start (no cached data), since the brief calls it "slow, theatrical" (`docs/FRONTEND_BRIEF.md:189`).

### 6.2 Empty and error states per source

| Source | Loading | Empty | Error | Code today |
|---|---|---|---|---|
| A queue tab | "Loading…" in the list | "No items in this queue" vs "Everything here is in your plan" | Banner "Bridge error · …" on that tab only | `App.tsx:1204-1214` |
| A failed write | | | Dismissible banner above the list; the card moves back | `App.tsx:1199-1203`, `830-831` |
| Sprint | "Sprint —" | | "Sprint not loaded" | `App.tsx:1053`, `MyDay.tsx:262` |
| Brief | "Loading brief…" chip | "No standup brief this sprint"; plan empty text depends on mode | "Brief unavailable" chip with the message as tooltip | `MyDay.tsx:264-276`, `124-130` |
| Plan | | Two messages (brief posted or not) | | `MyDay.tsx:124-130` |
| Up next | | "Nothing waiting outside your plan." | | `MyDay.tsx:148` |
| Reviews | "Loading…" | "No reviews waiting on you." | "Reviews need an updated ado-bridge" on 404, else "Reviews unavailable · …"; hidden when stories are off | `MyDay.tsx:204-213`, `151` |
| Deadlines | | "Nothing dated in the next three weeks." | **Gap**: only the boot step shows the failure (`App.tsx:690`). Recommendation: show "Calendar unavailable" in Coming up. | |
| Team blockers (lead) | | | **Gap**: errors are swallowed (`App.tsx:709`). Recommendation: "Blocked stories unavailable" under Team today. | |
| Dev links | "Loading…" | "No branch, PR or build linked yet" | "Dev links need an updated ado-bridge" / "Dev links unavailable · …" | `Cockpit.tsx:172-180`, `187` |
| Linked items | "Loading…" | "Nothing linked or mentioned" | (inherits dev links) | `Cockpit.tsx:268-270` |
| Notes | "Loading…" | placeholder text | "Couldn't save: …" or load error | `Cockpit.tsx:287`, `329`, `356-358` |
| Project context | "Loading context…" | "No linked initiative, issue, or parent" | message in danger text; a failing card says "Unavailable — …" | `App.tsx:396-408`, `370-371` |

In the new UI, use one `EmptyState` and one `ErrorNote` atom for all of these, keep the wording, and put the error where the data would be. The design's empty state for an empty queue ("Drag items here or check another tab", `Inbox.tsx:164`) should become the two messages above.

### 6.3 Undo toast and pending done
**Needed.** Behaviour to keep, from `App.tsx`:
- `UNDO_MS = 6000` (70). One toast at a time; a new one replaces the old (`584-589`).
- Done: the item is hidden at once (`hidden` set, 856), its plan entries ticked (857), the detail closes (858), the next plan entry is highlighted if it was the working item (859, 836-847). The write runs after 6 s (881). UNDO or unticking the plan entry cancels it (885-892, 913-918). Closing the page or switching developer sends it at once (593-602, 605).
- On success: removed from the board, lane forgotten, ticks cleared, entry gets `doneAt`, story progress bumped (861-873). On failure: entry unticked, banner shown (874-876).
- Moves (claim, release, ADO state) write at once and offer UNDO, which reverts the write and the lane (816-828).

New UI:
- The toast sits bottom centre in every mode, `role="status"`, with UNDO and ×.
- × only hides the toast. It must not cancel or send the pending done; the developer can still cancel by unticking the entry until the timer ends.
- Recommendation: while a done is pending, show the plan entry ticked with a small "Sending in 6 s · Undo" hint, so a dismissed toast is not the only way back.

### 6.4 Drag and drop, with keyboard equivalents
**Needed** (brief, `docs/FRONTEND_BRIEF.md:36`), but secondary to buttons and keys.

| Drop zone | Effect | Action | Key on a focused row |
|---|---|---|---|
| `today` (plan) | Add to plan (claims Pulse) | `add` (`App.tsx:941`) | `t` |
| `working` | Start | `start` (942) | `s` |
| `blocked` | Block | `moveTask(…,'blocked')` (943) | `b` |
| `queue` | Back to queue (releases Pulse) | `moveTask(…,'queue')` | `Delete` on a plan entry (`removeFromPlan`, 925-929) |
| Plan entry onto plan entry | Reorder | `reorder` (`MyDay.tsx:353-359`) | `Alt+↑/↓` |

Where the zones are:
- **Scan:** the Plan, Blocked and Queue filter tabs highlight while dragging and accept drops; the pane header accepts `working`. Plan rows reorder within the Plan filter.
- **Flow:** the plan section, the Working card, the Blocked section (always visible while dragging, as `MyDay.tsx:162`) and the queues drawer.
- Use the existing `dragItem`/`dropProps` pair (`App.tsx:931-967`) and the `.drop-zone[data-drop='on']` style.

What the design actually implements (checked in code): the only drop target in any mode is Flow's Blocked section (`Timeline.tsx:149-155`), and its drop writes a raw lane (`Timeline.tsx:61-65`). Flow's Up next cards and the drawer's cards are draggable (`Timeline.tsx:176-177`, `351-352`), and Scan's task rows are draggable (`Inbox.tsx:276-277`), but nothing else accepts a drop: the plan has no drop handler, Scan has no drop targets, and Calm has no drag at all. While the queues drawer is open, a full-screen click-catcher covers the page (`Timeline.tsx:235`), so a card dragged out of the drawer can't reach any zone. The drawer's "Drag to plan · press P" hint (`Timeline.tsx:239`) describes neither a working drag nor a working key. Build drag and drop from scratch on our `dropProps`; and close the drawer's click-catcher on drag start (or make the drawer non-modal) so drawer cards can reach the plan.

### 6.5 The Blocked lane
**Needed.**
- Lane `blocked`, saved per browser; for stories it also writes ADO Blocked (`bridge.ts:170`).
- Shows UNBLOCK, which puts the item back in the plan (`App.tsx:1044`).
- Scan: a Blocked filter with a danger count; Flow: a section that appears when anything is blocked or while dragging.
- Notion items blocked on the board are visible only in that developer's browser (`docs/IMPLEMENTATION.md:324`). Say so in a tooltip on the lead's Team today.

### 6.6 Plan entry linking (LINK, CONFIRM, the picker)
**Needed.** The design has none of it.
- On a plan row: if unlinked and a suggestion exists, show "Looks like DEV-…" with CONFIRM and ✕ (`MyDay.tsx:406-411`); otherwise "Not linked" and LINK. Clicking the ref opens the picker to change or remove the link (`MyDay.tsx:390-394`).
- Enter on an unlinked row opens the picker (`MyDay.tsx:362`).
- **Scan entry pane (new):** selecting an unlinked entry shows its full text, origin, the suggestion with CONFIRM/✕ and a short preview of the suggested item, a LINK button, the tick, and Remove from plan. A linked entry shows the item's cockpit with a strip above it: entry text (when it differs from the item title), origin, "Change link".
- Picker: overlay with a filter box, candidates ranked by `rankByTitle` (`App.tsx:280-338`), candidates limited to the current link plus unplanned items (`App.tsx:1122-1124`), Enter links the first, ↓ moves into the list, REMOVE LINK records a rejection.

### 6.7 Reader: brief, team items, calendar, standup draft
**Needed, and the design already has a version of it.** `ReaderModal` (`design/src/components/Cockpit.tsx:277-363`) has three tabs:
- **Daily Brief:** team items, responsibilities and aging items.
- **Standup Draft:** an editable text area with "⎘ Copy" and "↺ Reset".
- **Sprint Calendar:** the sprint range and day, then dated events with kind chips.

Use its look. Its content and behaviour differ from ours as follows:

| Aspect | Design | Ours (keep) |
|---|---|---|
| Draft text | A fixed string, `STANDUP_DRAFT` (`design/src/fixtures.ts:260-272`). Its Done, Today and Blocked lines are static text. | Built from the board: Done from the plan's done entries and `doneLog`; Today from open entries with criteria progress, then each review waiting; Blocked from blocked items (`src/standup.ts:32-58`). |
| Following the board | The text is seeded once with `useState(STANDUP_DRAFT)` (`Cockpit.tsx:280`) and never updates. | Follows the board until you edit it, then keeps your text (`src/StandupDraft.tsx:6-11`). |
| Reset | Puts the fixture string back (`Cockpit.tsx:338`), always enabled. | Rebuilds from the board; disabled until edited; the hint says which state you're in (`StandupDraft.tsx:38-41`). |
| Copy | `navigator.clipboard.writeText(...).then(...)`, with no handling when the clipboard is refused (`Cockpit.tsx:283-285`). | Falls back to selecting the text (`StandupDraft.tsx:14-25`). |
| Brief tab | Fixture lines; always shows a Morning Brief, never a Leadership Summary; no "not posted yet" state; mentions not clickable (`Cockpit.tsx:304-333`). | `BriefPanel` (`App.tsx:1355-1412`): loading, error, "no standup this sprint", stale warning, lead summaries, mention links. |
| Team items & dates | No tab (team items are inside the brief tab). | Own tab with deadlines within 14 days (`App.tsx:1423-1448`). |
| Calendar | The 21-day Coming up fixture with coloured kind chips (`Cockpit.tsx:347-357`). | Deadlines through sprint end + 42 days with sprint position bars (`App.tsx:1500-1541`). Kind chips stay neutral (§4.6). |
| Opened from | Scan footer, Calm sidebar and plan header. Not reachable in Flow. | Brief chip, STANDUP DRAFT, CALENDAR ⤢, BRIEF ⤢ (`MyDay.tsx:269-288`, `175`, `184`). |

Keep the four tabs (`App.tsx:1416-1421`) in one overlay for now, in the design's style.
- Brief: responsibilities and aging, or a lead's summaries; "Today's not posted yet" when stale; lines that mention a task open it (`App.tsx:1355-1412`).
- Team items and dates: team items plus deadlines within 14 days (`App.tsx:1423-1448`).
- Calendar: deadlines through sprint end + 42 days, with sprint position bars (`App.tsx:1500-1541`; bar positions are the one place inline styles stay).
- Standup draft: `StandupDraft` behaviour unchanged.
- Entry points: the brief chip and STANDUP DRAFT in the day header (both modes), "Coming up · Calendar" and "Team notes · Brief" links, and in Scan a footer "Brief" button (as the design has, `Inbox.tsx:188`).
- Drop the reader's `zoom: 1.15` (`App.tsx:1491`); use `text-read` sizes instead.

### 6.8 Reviews waiting
**Needed.**
- Rows as in `MyDay.tsx:216-239`: #id, title, repo, author, age (warn after 2 days), REQUIRED, open in ADO.
- Scan PR pane: the same fields larger and an "Open in Azure DevOps ↗" button. The API gives nothing more (`bridge.ts:438-446`); don't add diff or comment views.
- Enter on a review row opens the PR in a new tab.

### 6.9 Lead's team view
**Needed** for the lead.
- Shown only when `brief.mode === 'leadership'`.
- Content as `TeamToday` (`MyDay.tsx:517-556`): each developer's update, their blocked ADO stories under them, "Also blocked" for unmatched names.
- Scan: a Team filter tab (leads only) with one row per developer; the pane shows that developer's update and blockers. Flow: a section above the plan.
- The design's Calm sidebar has a "Team Today" list, but it shows only each developer's summary text, with no blocked stories, and it shows it to every developer whenever the fixture has summaries (`Document.tsx:101-112`). Gate it on `lead` and add the blockers.

### 6.10 Developer switcher
**Needed** until real login.
- Keep it visibly temporary (dashed warn border, "TEMP" title, `App.tsx:1143-1150`).
- On change call `changeDeveloper`; it flushes pending done and resets state.
- Options from `TEST_DEVELOPERS`; the design's hardcoded list (`design/src/fixtures.ts:3-8`) is fixture data.

### 6.11 Keyboard shortcuts

| Key | Current (`keys.ts`, `App.tsx:970-983`) | Design (`Inbox.tsx:68-81`) | Target |
|---|---|---|---|
| `j` `k` `↓` `↑` | Move focus between rows of a list | Scan only: change a selected id; arrows are captured even in a `<select>` | Row focus, as today. In Scan, focus is the selection. |
| `Enter` | Open (detail, or link picker for unlinked entries) | None | Scan: move focus into the pane (unlinked entry: open picker; review: open PR). Flow: open detail. |
| `s` | Start | Advertised, not implemented | Start (`rowKeys`). |
| `t` | Add to plan | Advertised, not implemented | Add to plan. |
| `x`, Space | Tick plan entry | None | Tick. |
| `d` | Done | Advertised, not implemented | Done. |
| `b` | Block | None | Block. |
| `Alt+↑/↓` | Reorder plan | None | Reorder. |
| `Delete`, `Backspace` | Remove from plan | None | Remove. |
| `p` `n` `q` | Focus first row of plan, up next, queues | Switch Scan filter (focus not moved) | Scan: switch filter and focus its first row. Flow: focus plan / up next; `q` opens the drawer. |
| `r` | None | None | Recommendation: Scan Reviews filter. |
| `Esc` | Toggle My Day and the working item | Close modal | Close the top overlay first. Then: Scan, from the pane back to the list row; Flow, collapse an expanded row, else toggle the working card. |
| `⌘/Ctrl+Enter` | Save note | Save note (fake) | Save note. |

Guards to keep (`App.tsx:972-973`): ignore keys with Ctrl, Cmd or Alt; ignore when an overlay is open (`[data-overlay]`); ignore in `input`, `textarea`, `select` and `contenteditable`. The design's handler checks only inputs and textareas, so Cmd+P switches its filter and arrows break the developer `<select>`.

Generate the key-hint footer from one table that also drives the handlers, so the hints can't advertise keys that do nothing (D3).

### 6.12 Narrow windows (about 1024px and below)
The brief asks for 1024px (`docs/FRONTEND_BRIEF.md:203`).
- **Scan at ≥1200px:** list 320px; pane with two columns (main + 280px side).
- **Scan 900-1199px:** list 280px; pane stacks the side column under notes.
- **Scan under 900px:** list full width; selecting a row opens the pane as a full-height sheet with "← List" (Esc returns).
- **Flow:** the column is max 720px and centres; under 900px the drawer becomes full width; the Working card stacks.
- **Header under 1100px:** hide mode hints, collapse PLANNED/BLOCKED into one chip, keep the clock time only.
- Check at 1024×768 and 800×600 that nothing scrolls sideways (R20).

### 6.13 The Board direction: not needed now

The brief proposed a Board: columns Plan, Working, Blocked and Done today, queues in a drawer, drag as the main model (`docs/FRONTEND_BRIEF.md:195`). The design did not include it. Recommendation: **don't build it now.** Reasons from the docs and code:
1. **Working is a lane of one.** Starting an item returns the previous one to the plan (`App.tsx:799-810`, `docs/IMPLEMENTATION.md:151`). A Working column would hold at most one card, which is what Flow's Working card and Scan's pane already show.
2. **Done today is not a lane.** A done item leaves the board (`App.tsx:865`); only plan entries remember it (`done`, `doneAt`, `doneLog`, `plan.ts:24-25`, `78-83`). A Done column would show entries, not cards, including unlinked standup lines with no card behind them.
3. **The plan is entries, not cards.** Several plan entries are standup sentences with no linked item (`plan.ts:11-26`; on 10/02 only 4 of 6 linked, `docs/IMPLEMENTATION.md:255`). A board of cards can't show them without inventing a card type for them.
4. **Drag is already supported, and is not discoverable.** The brief's own problem 6 says drag and shortcuts are "powerful but undiscoverable" (`docs/FRONTEND_BRIEF.md:186`). Every drag has a button and a key (§6.4). Making drag the primary model works against that finding.
5. **Cost.** A third layout carries all of §6 again (§1).

6. **The design already gives Blocked its own place in every mode.** Flow has a Blocked section that is also its one drop target (`Timeline.tsx:149-166`). Calm has a Blocked stat in its sidebar (`Document.tsx:70`) and a Blocked section in the centre (`Document.tsx:183-200`). Scan has a Blocked filter (`Inbox.tsx:53-54`, `113`). A Board's Blocked column would duplicate these.

What replaces the Board's job (a spatial overview of where everything is):
- The header counts (open plan entries, blocked) and the filter tab counts in Scan (Plan, Queue, Next, Reviews, Blocked).
- Flow's single column already reads top to bottom as Plan → Working → Blocked → Up next. Calm's sidebar stats (Planned, Done today, Up next, Blocked, Reviews, `Document.tsx:66-72`) are a compact form of the same overview; reuse them in the Flow day header.
- Recommendation: a one-line "day strip" in Flow's day header: `5 to do · 1 working · 2 blocked · 3 done today`, each part a link that scrolls to its section.

Revisit if the team asks for a shared team board. That needs lanes stored on a server (today they live in each browser, `bridge.ts:34-51`), which is a separate decision.

---

## 7. Known defects in the design to fix while wiring

Each was checked in the design's code. "Observed" means it was also seen in the running prototype at 1440×900 by the person who commissioned this guide.

| # | Defect | Verified in | Fix |
|---|---|---|---|
| D1 | **Scan: selecting a plan row leaves the pane empty.** `selectedId` holds a plan entry id for plan rows, but `selectedTask` looks it up in `tasks` and `UP_NEXT` by task id, so it finds nothing. If an item is in Working the pane shows that item instead, which is also wrong. Unlinked entries have no pane at all. Observed. | `design/src/modes/Inbox.tsx:60-62`, `167`, `175`, `194-209` | Typed selection union (§5 Phase 4); a linked entry resolves to its task; an unlinked entry gets the entry pane (§6.6). |
| D2 | **Scan: reviews can't be selected; j/k does nothing on the Reviews tab.** The click handler is empty, and `listItems` returns `[]` for reviews, so the key handler has no ids. Observed. | `Inbox.tsx:150`, `56` (falls through to `return []`), `71` | Reviews are rows with a PR pane (§6.8). |
| D3 | **Scan footer advertises keys that don't exist.** It says "s start · t plan · d done"; the handler implements only j/k, arrows and p/q/n. Observed. | `Inbox.tsx:187`, `68-81` | Use `rowKeys`; generate hints from the handler table (§6.11). |
| D4 | **Scan: no Start in the pane; dev links and context are gated on "working".** The cockpit shows "Dev links load when active / Start this item to see PRs…", but the cockpit has no start action; the only start control is a hover-only ▸ on task rows (none on plan rows' keyboard path). Dev links and context load only when `isWorking`. The same happens in Flow's and Calm's DETAIL modal (opened by a plan row's ⋯), which always passes `isWorking={false}`, so it shows the placeholders for every item. Observed. | `design/src/components/Cockpit.tsx:19-20`, `209`, `231`, `266`; `Inbox.tsx:176`, `263`, `302-307`; `Timeline.tsx:337` | Action bar by lane (§5 Phase 3). Load dev links and context for any opened item, as the current detail modal does (`App.tsx:231-232`). |
| D5 | **Starting an item empties its Queue tab with a misleading message.** After start the item leaves the `queue` lane (correct), and the tab shows "Nothing in queue / Drag items here or check another tab". Observed. | `Inbox.tsx:48`, `164` | Use our two messages (§6.2). |
| D6 | **Done is a lane change back to the queue, with no write, no plan tick and no undo.** All three modes call `onTaskUpdate(id, 'queue')`; the toast says "undo?" but has no undo button. A done item reappears in its queue. | `Inbox.tsx:83-88`; `Timeline.tsx:41-46`; `Document.tsx:36-41`; `design/src/components/atoms.tsx:115-133` | Call `actions.done` (§6.3). |
| D7 | **Cockpit state leaks between items.** The Scan pane renders one `Cockpit` without a `key`; its ticks (keyed by index) and note text (initialised once from `task.notes`) carry over to the next selected item. Save does nothing but shows "✓ Saved". | `Inbox.tsx:195`; `design/src/components/Cockpit.tsx:16-23`, `117-119` | Key by `task.id`; use our `Checklist` and `NotesPanel` (§5 Phase 3). |
| D8 | **Two sources of truth for the working item.** The fixture puts DEV-E5ADEC in `working` while `workingId` starts null; starting another item doesn't clear the first. Start and Return also send items to `queue`, not back to the plan. | `design/src/fixtures.ts:81`; `design/src/App.tsx:21`; `Timeline.tsx:48-59`; `Inbox.tsx:90-94`, `200` | Derive working from `status`; use `start` and `returnToPlan` (R6). |
| D9 | **"+ Plan" can tick an entry done.** `togglePlan` toggles `done` if any entry is linked to the id, and Up next lists items already in the plan (US-12241, SW-4021, BLUEADS-222), so "+ Plan" on them ticks their entry. It also only finds tasks in `INITIAL_TASKS`. | `design/src/App.tsx:35-48`; `design/src/fixtures.ts:39-43`, `219-245` | Separate `add` and `toggle` actions; Up next excludes planned items (`ranking.ts:96`). |
| D10 | **Adding to the plan doesn't change the lane, and queue lists don't exclude planned items.** "+ Plan" in the drawer adds a plan entry (the header's Planned count goes up, 8 → 9 when observed) but leaves the item in `queue`, so it stays in the drawer and in Up next. No claim or ADO state write happens. | `design/src/App.tsx:35-48`; `Inbox.tsx:48`; `Timeline.tsx:38`, `260` | `actions.add` (moves to `today`, claims Pulse, sets ADO Active, with undo); `queueItems(source)` (§2.4). |
| D11 | **Dead controls.** "+ Add item" buttons have no handler; the drawer says "press P" with no handler; the App-level reader state is never set to open (the modes open their own copies). | `Timeline.tsx:128-130`, `239`; `Document.tsx:158`; `design/src/App.tsx:23`, `128` | Wire "+ Add item" to the queues drawer (Flow) or the Queue filter (Scan); remove the rest. |
| D12 | **Hardcoded day and sprint.** "Sprint 20 · Day 14/14", "Oct 6", "Tuesday, October 6", "Last day". | `design/src/App.tsx:70`, `110`; `Timeline.tsx:76-81`; `Document.tsx:55-59`, `121-126` | From `sprint`, `today` (§3.4). |
| D13 | **Lead section shown to everyone.** | `Document.tsx:101-112` | Gate on `lead` (§6.9). |
| D14 | **Global key handler lacks guards.** Ignores only inputs and textareas: Cmd+P switches filter; arrows are captured inside the developer `<select>`. | `Inbox.tsx:69-78` | Guards in §6.11. |
| D15 | **Not keyboard accessible.** Rows are clickable `div`s without `tabIndex`; `Checkbox` is a `div role="checkbox"` without `tabIndex` or key handling; row actions appear on mouse hover only. | `Inbox.tsx:242-252`, `272-283`; `design/src/components/atoms.tsx:73-79`; `Inbox.tsx:263`, `302` | Focusable rows; button checkbox; actions also visible on focus (as `App.tsx:167`). |
| D16 | **Text under 10px.** 8px in 8 places, 9px in 49 inline places plus `.mode-hint`, `.section-label`, `.avatar`. Observed. | e.g. `design/src/App.tsx:78`; `Inbox.tsx:187`; `design/src/index.css:265`, `285`, `300` | §4.5. |
| D17 | **Text below 4.5:1.** `--text-dim` is used as a text colour (`.label`, section labels, refs, hints) at 3.18:1 (dark) and 2.26:1 (light) on surface; Scan and Calm `--text-muted` also fail. | `design/src/index.css:116`, `287`; atoms `Ref` (`atoms.tsx:99`) | §4.4. |
| D18 | **Colour carries source and type.** Type chips and source chips are coloured; red on Pulse "alert" type reads as failure. | `design/src/index.css:163-171`; `atoms.tsx:30-41` | §4.6. |
| D19 | **Description links shown as raw markup.** | `design/src/components/Cockpit.tsx:367-379` | `RichText`. |
| D20 | **Cockpit omits commits, linked items, and builds after the third.** | `design/src/components/Cockpit.tsx:153-207`, `187` | Our `DevLinksPanel` and `LinkedItemsPanel`. |
| D21 | **Missing states and pieces.** No loading, error or partial-failure states; no 6-second undo for done (D6); no plan-entry link picker, LINK or CONFIRM; no per-source error banners; developers hardcoded and switching only changes local state (no reload, no flush); no lead blockers; nothing reads real data. Observed. | throughout; `design/src/App.tsx:3`, `98`; `design/src/fixtures.ts` | §6. |
| D22 | **Drag and drop mostly doesn't work.** Only Flow's Blocked section accepts a drop; the plan, Working and queue accept none; Scan rows drag to nowhere; the drawer's click-catcher blocks drops from drawer cards; plan rows can't be reordered. | `Timeline.tsx:149-155`, `235`, `239`; `Inbox.tsx:276-277` | §6.4. |
| D23 | **The reader's content is fixture text.** The standup draft is a fixed string that never follows the board, Reset restores the fixture, Copy has no fallback, the brief tab can't show a Leadership Summary or a stale brief, and the calendar uses the Coming up list without sprint bars. The reader can't be opened from Flow. | `design/src/components/Cockpit.tsx:277-363`; `design/src/fixtures.ts:260-272` | §6.7. |

Feature parity items the design does have (verified in code and observed; keep their look):
- **Reading pane / cockpit:** description, criteria checklist with a count and progress bar, notes with "Save note ⌘↵", tags and ✓ Done (`design/src/components/Cockpit.tsx:55-145`); for the working item, pull requests, branch, builds, links and project-context cards (`153-232`).
- **Flow:** one scrolling column. Today's plan with "+ from queue", per-row ▸ and ⋯ (the ⋯ opens the DETAIL modal with description, notes, tags, "+ Plan" and "▸ Start"), "+ Add item"; an inline Working panel; Blocked; Up next with reason chips and "+ Plan"; Reviews waiting with Required and author initials; Coming up; a "Queues ▸" drawer with Stories/Tasks/Pulse/SW/ADS tabs and per-card "+ Plan" (`Timeline.tsx:71-275`).
- **Calm:** a light theme with a left sidebar (sprint progress bar and day, stats for Planned, Done today, Up next, Blocked and Reviews, Coming up, "Brief & Calendar", "Compact view", "Team today"); a centre plan with a "● Working" marker on the active row and an inline Working panel; a right rail with Up next / Reviews / Brief tabs (`Document.tsx:52-271`, `319`).
- **Reader:** three tabs, Daily Brief, Standup Draft (Copy, Reset) and Sprint Calendar (`design/src/components/Cockpit.tsx:277-363`); see D23 for its gaps.

---

## 8. Testing and verification

### 8.1 Manual test scripts

Run each in dark and light theme, comfortable and compact density, at 1440×900 and 1024×768. Use ado-bridge mock and the `Bridge Test` Notion rows for writes.

**Scan**
1. Load as Philip (a developer with a Morning Brief). The Plan filter is selected; the plan lists today's responsibilities with origin chips.
2. Press `j` until a linked entry is focused: the pane shows that item's cockpit. Press `j` to an unlinked entry: the entry pane shows the suggestion; CONFIRM links it; the pane switches to the item.
3. On an unlinked entry press Enter: the picker opens; type part of a title; Enter links; reopen and REMOVE LINK.
4. Press `q`: Queue filter, first row focused. Use the source sub-tabs; counts match unplanned items. Press `t` on a story: toast "Set US-… to Active" with UNDO; the item leaves the queue and joins the plan. UNDO puts it back.
5. On a Pulse row press `t`: "Claimed PULSE-…". Drag it back onto the Queue tab: "Released…".
6. Press `n`: Next filter with reasons. Press `s`: the item starts; the pane shows it with "Return to plan" and "✓ Done"; dev links load for a story.
7. In the pane tick two criteria; reload: still ticked. Type a note, press ⌘/Ctrl+Enter: "Saved to a comment on the ADO story". Type more, select another item and come back: the unsaved text is still there.
8. Press `d`: the item disappears, toast with UNDO. Click ×: the toast goes; within 6 s untick the plan entry: the done is cancelled. Repeat and wait 6 s: the story is Closed in the mock.
9. Press `b` on a plan row: the Blocked count rises; Blocked filter shows it; UNBLOCK returns it.
10. Press `r` (if added): Reviews; select a review: PR pane; Enter opens ADO in a new tab.
11. Stop ado-bridge and reload: the Stories tab shows its error; other tabs load; Reviews shows "Reviews unavailable"; dev links show their error.
12. Switch to Steven: the Team tab appears with five updates and blocked stories.
13. Try keys while typing in the note and with the reader open: nothing fires.

**Flow**
1. Day header shows the real date, sprint day and working days left, the brief chip and story progress.
2. Plan rows: tick, reorder by drag and by Alt+↑/↓, remove with Delete (a linked queue item returns to its queue).
3. Expand a plan row: compact cockpit with dev links and context below notes; "Open full" opens the detail modal.
4. Start an item: the Working card shows the full cockpit; starting another returns the first to the plan.
5. `q` opens the drawer and focuses its first card; drag a card onto the plan; Esc closes the drawer and returns focus.
6. Drag a plan row onto Blocked; the Blocked section appears while dragging.
7. Reader from the brief chip, STANDUP DRAFT, Calendar and Brief links; all four tabs work; COPY and RESET.
8. Narrow to 1024px and 800px: no horizontal scroll.

**States (both modes)**
- Cold load with the bridge just restarted: loading state, steps resolve, page usable once queues arrive.
- Brief not posted today: warn chip "showing Oct 2"; plan empty text for that case.
- `VITE_ADO_STORIES=false`: no Stories tab, no Reviews section, no story progress.
- Pending done, then switch developer: the write is sent before the switch.
- Pending done, then close the tab: the write lands (check the mock).

### 8.2 Automated checks

What exists: `npx tsc --noEmit` and `npm run build` (`docs/IMPLEMENTATION.md:253`). There are no tests in this repo.

Recommendation: add Vitest (no DOM needed for most logic) in Phase 0a. Notes:
- `plan.ts`, `ranking.ts`, `standup.ts` and `schedule.ts` import `bridge.ts` for date helpers. `bridge.ts` reads `import.meta.env` at module load (`bridge.ts:627`), which Vitest supports.
- `loadPlan`/`savePlan`/`loadTicks` touch `localStorage`; use Vitest's `jsdom` environment for those files, or stub `localStorage`.
- `htmlToText` (`bridge.ts:246`) is not exported and needs `DOMParser`. If tested, export it and use `jsdom`.
- Adding a dev dependency changes `package.json` and both lockfiles (§9 R6).

Tests worth writing first:

| Module | Cases |
|---|---|
| `plan.ts` | `rollover` keeps unfinished, logs finished, trims to 7 days; `mergeBrief` merges once per date, refreshes a repeat, ignores `leadership`; `addItem` dedupes, makes a second entry after done; `linkEntries` prefers mention, then ADO ref, then best title match with margin, never links one item twice, respects `rejected`; `suggestLinks` thresholds; `findDuplicates`; `agingLabel` with em and en dash; `reorder`/`shift` bounds. |
| `ranking.ts` | Each signal and weight; planned and non-queue items excluded; stable order on ties. |
| `cockpitLogic.ts` | `toggleTick` adds and removes, drops empty keys; `clearTicks` returns the same object when nothing changes; `refsIn` finds `US-123`, `#12345`, `BLUEADS-222`; `crossRefs` both directions, capped at 5. |
| `standup.ts` | Sections omitted when empty; "Nothing planned yet"; criteria progress only when some are ticked; ref appended only when missing from the text. |
| `schedule.ts` | `teamDates` on "Code Jam at HQ on Oct. 8", ranges "Oct 8–9", year rollover; `comingUp` dedupes a team date that repeats a deadline; `workingDaysAfter` skips weekends. |
| `keys.ts` (jsdom) | j/k move focus; Alt+↑ runs `up`; `t` moves focus to a neighbour when the row leaves. |

Recommendation for later: one Playwright smoke test per mode against `fixtureBoard` (§10.3), checking that rows render, j/k moves focus and the pane changes. Not needed before Phase 6.

Static checks to add to CI (cheap):
- `tsc --noEmit`.
- A grep that fails when `src/ui` or `src/modes` import `bridge.ts` other than `import type`.
- A grep that fails on `fontSize: [0-9]` and `text-[8px]`/`text-[9px]` in `src/ui` and `src/modes`.

### 8.3 Accessibility checks
- **Keyboard only:** every action reachable without a mouse (R17); row actions visible on focus, not only hover.
- **Focus order:** header → mode switcher → list (or plan) → pane. Overlays trap focus and return it to the opener on close. (Our `Overlay` closes on Esc but does not trap focus today, `App.tsx:1452-1469`; add it.)
- **Roles:** filter tabs and reader tabs `role="tablist"`/`tab` with `aria-selected`; checkboxes `role="checkbox"` with `aria-checked` (as `MyDay.tsx:371-376`); mode switcher a radio group; toast `role="status"` (`App.tsx:1315`); error banners `role="alert"`.
- **Contrast and size:** R19 on the live page in both themes, including selected and hover rows.
- **Colour not alone:** priority shows a label with its dot; blocked shows the word "Blocked"; build results show PASSED/FAILED text.
- **Reduced motion:** all new animations stop under `prefers-reduced-motion`.

### 8.4 Performance notes
- Keep the board hook above the mode switch, so switching modes never refetches or resets data.
- Split state and actions contexts; keep actions stable. Keep `Clock` isolated (`App.tsx:1554-1569`); the design's App-level clock re-renders everything every second (`design/src/App.tsx:24-26`).
- Memoise `upNext` (`App.tsx:1009` recomputes on every render).
- The cockpit cache dedupes requests and keeps results for 60 s (`Cockpit.tsx:45-59`). Scan selects items quickly with j/k: debounce pane loads by about 150 ms, or rely on the cache and load only the focused item.
- Register one global key listener with stable handlers; the design re-registers its listener on every render (`Inbox.tsx:81`).
- Lists are small (20-30 queue items, 5-14 plan entries, `docs/FRONTEND_BRIEF.md:82`); no virtualisation needed.

---

## 9. Risks, open questions and decisions needed

### 9.1 Decisions for the product owner (with recommendations)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Keep three modes? | Two layouts (Scan, Flow) plus a light theme and density option. Optionally keep the names as presets (§1). |
| Q2 | Default mode for someone who hasn't chosen? | Scan on windows ≥1100px wide, Flow below. |
| Q3 | Persist the mode per developer? | Yes, in `devDashboard.ui.<email>` with theme and density. Matches the existing per-developer keys. |
| Q4 | Is the sci-fi HUD look retired? | Retire the ornaments (corner brackets, glows, boot terminal, uppercase mono everywhere); keep the dark palette as the dark theme. The 2026-10-01 roadmap said "keep the HUD look"; this redesign changes that, so confirm explicitly. |
| Q5 | Keep the boot screen? | Replace with a non-blocking loading state (§6.1). |
| Q6 | Default theme? | Follow the operating system ("System"), dark when unknown. |
| Q7 | Keep the design's Scan palette (neutral grey, blue accent)? | No. One dark palette. |
| Q8 | Build a Board? | Not now (§6.13). |
| Q9 | Split the reader (standup draft on its own)? | Keep one reader in this migration; revisit after use. |
| Q10 | Add `r` for Reviews in Scan? | Yes. |
| Q11 | Should Figma Make remain the design tool for this UI? | Yes for exploration, using the fixture board (§10.3); production code changes land in this repo only. |

### 9.1a Decisions made (product owner, 2026-10-06)

| # | Decision |
|---|---|
| Q1 | **Two layouts (Scan and Flow) plus the light theme.** Calm is not a third layout. |
| Q8 | **Skip the board.** Not built in this migration (§6.13). |
| Q2 | **Follow the guide:** Scan on windows 1100px wide or more, Flow below. |
| Q3 | **Per developer, stored locally** in `devDashboard.ui.<email>` (layout, theme, density). |
| Q4 | **The HUD look is kept as an option for now**, not retired. How it is offered (a theme, or an ornaments switch on the dark theme) is settled in Phase 1. |
| Q5 | **Keep the boot screen; recolour it to match the saved theme** and change nothing else for now. This replaces the guide's recommendation to swap it for a non-blocking loading state. |
| Q6 | **Default to Dark for the first release.** The theme picker offers Dark, Light and System. Once Light has had real use, make System the default. A saved choice always wins. |
| Q7 | **One dark palette (option A).** Dark is today's navy and cyan without the HUD ornaments, and the HUD look is a switch that adds them. Scan's grey and blue palette is not shipped, and it can be reconsidered later without redoing the layouts. |
| Q9 | **Keep one reader** with four tabs for this migration, and revisit after use. The standup draft stays a standalone component, so splitting it later is cheap. |
| Q10 | **Yes:** add `r` for Reviews in Scan. |
| Q11 | **No further role for Figma Make.** The design project is a one-off reference; production changes land in this repo only, and the guide's notes on keeping a fixture board for round-tripping (§10.3) are not needed. |
| R6 | **`package-lock.json` is the source of truth.** Dependencies change through `npm install`, and the lockfile is committed with `package.json`. `pnpm-lock.yaml` is left alone: Figma Make regenerates it (`--no-frozen-lockfile`), and it is not kept in sync by hand. |

Every question in §9.1 is now decided. Q4, Q5 and Q6 above change the earlier recommendations in §9.1; where a row there disagrees with this table, this table wins.

### 9.2 Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Refactoring `App()` into a hook changes effect timing (the plan-linking effect depends on `plan` itself, `App.tsx:747-756`). | Move code verbatim in Phase 0; logic tests first; run R7-R9. |
| R2 | Mode switching unmounts the cockpit mid-edit. | Notes drafts are module-level (`Cockpit.tsx:278`) and survive; pending done lives in the hook. Test in Phase 6. |
| R3 | Live writes during testing. | Use ado-bridge mock and `Bridge Test` rows; never test against the host. |
| R4 | Light theme leaks dark hardcodes. | Tokenise every colour in Phase 1; classic forced dark. |
| R5 | Scan's focus-as-selection loads too many panes. | Cache plus debounce (§8.4). |
| R6 | Two lockfiles drift. The repo has `package-lock.json` (used by Docker, `Dockerfile` `npm ci`) and `pnpm-lock.yaml` (used by Figma Make's `install`, `.figma/make/install`). | **Decided:** `package-lock.json` is the source of truth (§9.1a). Add Vitest with `npm install` and commit the lockfile; leave `pnpm-lock.yaml` for Figma Make to regenerate. |
| R7 | Copying design files brings fixtures or the proxy-less Vite config into production. | §10.3 lists what not to copy. |

### 9.3 Discrepancies between docs and code (flagged, code trusted)
- `docs/IMPLEMENTATION.md:194` says the reader has three tabs; the code has four, including the standup draft (`App.tsx:1416-1421`; the same doc's line 167 says the draft opens in the reader).
- `docs/IMPLEMENTATION.md:88-102` does not list `GET /pages/:id`, which the dashboard calls to check whether a planned Notion item was finished (`bridge.ts:156-161`). It is documented in `Notion Bridge INTEGRATION.md:433-439`.
- `docs/FRONTEND_BRIEF.md` §3 simplifies the types (no `queue`, `parentId`, `addedOn`, `briefDate`, `mentions`, `rejected`, `doneAt`, `RelatedEntity.id`, `sub_pages`; `Source` without `zendesk`). The design inherited those gaps (§3).
- The comment at `App.tsx:56-57` says Stories is off while ado-bridge serves mock data; Stories is on by default (`bridge.ts:627`, `docs/IMPLEMENTATION.md:140`).
- The design project's `src/imports/IMPLEMENTATION.md` and `FRONTEND_BRIEF.md` are the same text as `docs/` with CRLF line endings; they are copies, not newer versions.

---

## 10. Appendix

### 10.1 Data sources, bridges and endpoints the UI uses

All calls are same-origin. Vite proxies `/bridge` to notion-bridge (`NOTION_BRIDGE_URL`, default `http://localhost:3100`) and `/ado` to ado-bridge (`ADO_BRIDGE_URL`, default `http://localhost:8000`) (`vite.config.ts:37-48`); in Docker, nginx does the same (`nginx.conf.template`). The developer is passed as `?developer=<email>` or in the JSON body.

**notion-bridge** (`/bridge`)

| Method and path | Used for | Client |
|---|---|---|
| `GET /sprint/current` | Sprint name, number, dates | `fetchCurrentSprint`, `bridge.ts:126` |
| `GET /queues/:slug?developer=` | Items and claimed items per queue | `fetchQueue`, `bridge.ts:123-124` |
| `GET /standup/today?developer=` | Brief or leadership summary | `fetchStandup`, `bridge.ts:128` |
| `GET /items/:id/related?queue=` | Project context | `fetchRelated`, `bridge.ts:130-131` |
| `GET /items/:id/notes?queue=` | Developer note | `bridge.ts:618` |
| `PUT /items/:id/notes` | Save note | `bridge.ts:619` |
| `POST /items/:id/claim` | Pulse claim | `claimItem`, `bridge.ts:145-146` |
| `POST /items/:id/release` | Pulse release | `releaseItem`, `bridge.ts:148-149` |
| `POST /items/:id/done` | Mark done | `markItemDone`, `bridge.ts:151-152` |
| `GET /pages/:id` | Was a planned item finished elsewhere? | `fetchPageDone`, `bridge.ts:156-161` |
| `GET /databases/deadlines-milestones/query` | Calendar | `fetchDeadlines`, `bridge.ts:133-143` |

Queues (`bridge.ts:629-706`): `sprint-developer-items` (Tasks, doneable), `pulse-queue` (Pulse, claimable, doneable), `solarwinds` (read-only), `ads-tickets` (read-only).

**ado-bridge** (`/ado`)

| Method and path | Used for | Client |
|---|---|---|
| `GET /workitems?assignedTo=&iteration=&includeClosed=true` | Stories and sprint progress | `bridge.ts:370-392` |
| `GET /workitems?iteration=` | Lead's blocked stories | `fetchTeamBlockers`, `bridge.ts:463-468` |
| `GET /workitems/:id` | Parent for project context | `bridge.ts:416` |
| `PUT /workitems/:id/state` | Active, Blocked, Closed | `setAdoState`, `bridge.ts:230` |
| `GET /workitems/:id/links` | Dev links and linked work items | `bridge.ts:404` |
| `GET /workitems/:id/comments` | Read the note | `bridge.ts:406` |
| `POST /workitems/:id/comments` | First note | `bridge.ts:410` |
| `PUT /workitems/:id/comments/:commentId` | Edit the note | `bridge.ts:409` |
| `GET /pullrequests?reviewer=` | Reviews waiting | `fetchReviews`, `bridge.ts:450-451` |

**Browser storage** (per developer, this browser only): `devDashboard.developer` (`bridge.ts:21`), `devDashboard.lanes.<email>` (`bridge.ts:34`), `devDashboard.plan.<email>` (`plan.ts:46`), `devDashboard.criteria.<email>` (`cockpitLogic.ts:11`), `devDashboard.lastLogin.<login>` (`BootScreen.tsx:36`). Proposed: `devDashboard.ui.<email>`.

**Refresh intervals:** queues and sprint 60 s (`BRIDGE_REFRESH_MS`), brief, deadlines and reviews 5 min (`CONTEXT_REFRESH_MS`) (`bridge.ts:6-7`); cockpit loads cached 60 s (`Cockpit.tsx:45`).

### 10.2 Inventory of the design's components

| Component | File:line | What it is |
|---|---|---|
| `App` | `design/src/App.tsx:17-131` | Header with mode switcher, developer select, counts and clock; renders one mode; fixture state. |
| `HeaderStat` | `design/src/App.tsx:135-142` | Number over a tiny label. |
| `PriorityDot` | `design/src/components/atoms.tsx:5-12` | Coloured dot per priority. |
| `TypeChip` | `atoms.tsx:21-23` | Coloured chip per item type. |
| `SourceChip` | `atoms.tsx:35-41` | Coloured chip per source. |
| `Avatar` | `atoms.tsx:49-59` | Initials square, colour per known initials. |
| `ProgressBar` | `atoms.tsx:63-69` | 3px bar. |
| `Checkbox` | `atoms.tsx:73-79` | `div` with `role="checkbox"`. |
| `SectionLabel` | `atoms.tsx:83-93` | Uppercase 9px label, count, right-hand action. |
| `Ref` | `atoms.tsx:97-103` | Mono ref text. |
| `Divider` | `atoms.tsx:107-111` | 1px line. |
| `Toast` | `atoms.tsx:115-133` | Bottom toast with optional Undo and ×. |
| `EmptyState` | `atoms.tsx:137-145` | Icon, title, subtitle. |
| `PRChip` | `atoms.tsx:149-155` | Draft / Open / Merged / Closed. |
| `BuildStatus` | `atoms.tsx:159-164` | ✓ ✗ ~ · glyph. |
| `ModeSwitcher` | `atoms.tsx:176-194` | Flow / Scan / Calm buttons with hints. |
| `Cockpit` | `design/src/components/Cockpit.tsx:15-237` | Item view: header, title, description, AC, notes, tags; side column with PRs, branch, builds, links, project context. |
| `DetailModal` | `design/src/components/Cockpit.tsx:241-271` | Cockpit in a modal with ＋ Plan and ▸ Start. |
| `ReaderModal` | `design/src/components/Cockpit.tsx:277-363` | Tabs: Daily Brief, Standup Draft, Sprint Calendar (fixtures). |
| `DescriptionText` | `design/src/components/Cockpit.tsx:367-379` | Renders `• ` lines; no links. |
| `useEscClose` | `design/src/components/Cockpit.tsx:385-391` | Esc closes. |
| `Timeline` (Flow) | `design/src/modes/Timeline.tsx:28-291` | One column: day header, plan with inline expansion, Working card, Blocked drop zone, Up next, Reviews, Coming up; queues drawer. |
| `PlanRow` (Flow) | `Timeline.tsx:295-341` | Card row: checkbox, text, chips, ▸ and ⋯. |
| `MiniCard` | `Timeline.tsx:345-367` | Compact draggable item card. |
| `Inbox` (Scan) | `design/src/modes/Inbox.tsx:30-224` | Filter tabs, list, status bar, reading pane. |
| `ListRow` | `Inbox.tsx:228-310` | Plan-entry row or task row with hover actions. |
| `Document` (Calm) | `design/src/modes/Document.tsx:19-285` | Light layout: sprint sidebar with metrics, coming up, brief button, density toggle, team today; centre plan, working, blocked; right rail tabs Up next / Reviews / Brief. |
| `DocPlanRow` | `Document.tsx:289-331` | Plan row with density. |
| `SideMetric` | `Document.tsx:335-342` | Label and number. |
| Fixtures | `design/src/fixtures.ts` | `DEVELOPERS`, `SPRINT`, `STANDUP`, `INITIAL_PLAN`, `INITIAL_TASKS` (21 items), `UP_NEXT`, `REVIEWS`, `COMING_UP`, `STANDUP_DRAFT`, `COCKPIT_DEV_LINKS`, `COCKPIT_RELATED`. |

### 10.3 How the design project relates to this repo (Figma Make)

**What a Figma Make project is.** A Vite + React 19 + Tailwind v4 app that Figma Make runs, previews and deploys. Its `AGENTS.md` says a dev server is already running on `$PORT` (default 8443) with hot reload. The scripts in `.figma/make/`:

| File | What it does |
|---|---|
| `install` | `pnpm install --prefer-offline --no-frozen-lockfile` |
| `dev` | `pnpm run dev` |
| `dev.json` | Files that trigger a reinstall and dev-server restart (`package.json`, `pnpm-lock.yaml`); app source is left to Vite's hot reload. |
| `deploy-preview` | Development-mode build with inline sourcemaps, then `figma make deploy-preview --build-dir dist`. |
| `deploy` | Production build, then `figma make deploy --build-dir dist`. |
| `format` | `pnpm run format` (oxfmt). |
| `langserver` | Starts the vtsls TypeScript language server. |
| `analyze-routes` | Runs `figma-analyze routes`. |
| `site.json` | Page description, `robots.index: false`, accessibility options. `vite.config.ts` injects it into the `<!-- figma:… -->` slots of `index.html` (`figmaSiteConfiguration`, `vite.config.ts:89-141`). |
| `import-assets.mjs` | A Vite plugin that would copy every non-config file into `dist`. Neither `vite.config.ts` uses it. |

`.mise.toml` pins Node 22 and pnpm 10.34.3. `vite.config.ts` also adds a dev-only kit page at `/.figma/make/kit.html` that registers every `src/**/*.stories.{ts,tsx,js,jsx}` file for Figma's design surface (`vite.config.ts:316-387`). The expected shape of a stories module is not documented in the scaffold; this guide did not verify it.

**Same scaffold.** This repo started from the same template. Compared file by file:
- Identical: `package.json` (still named `figma-make-app`), `index.html`, `tsconfig.json`, `src/main.tsx`, `AGENTS.md`, `CLAUDE.md`, `.mise.toml`, `.gitattributes` and every file in `.figma/make/`.
- Different: `vite.config.ts` (ours adds the `/bridge` and `/ado` proxy, lines 37-48; nothing else); `.gitignore` (ours ignores `certs/*.crt` and `*.pem`); lockfiles (the unpacked design's `package-lock.json` was generated locally after unpacking and resolves slightly newer versions; the zip itself has only `pnpm-lock.yaml`).

So design source files drop into this repo without dependency changes.

**Deployment differs.** This repo ships through Docker: `npm ci` from `package-lock.json`, `npm run build`, nginx with the bridge proxies (`Dockerfile`, `nginx.conf.template`). Do not run `.figma/make/deploy` from this repo: it would publish to Figma's hosting, where `/bridge` and `/ado` don't exist.

**Do not copy from the design into this repo:**
- `.figma/` (ours is identical already), `node_modules/`, `pnpm-lock.yaml`, `package-lock.json`.
- `vite.config.ts` (it lacks the bridge proxy; copying it breaks every request).
- `src/fixtures.ts` and `src/types.ts` (fixtures don't belong in the production path; our types are the contract).
- `src/App.tsx` (replaced by the board-driven App).
- `src/imports/` (CRLF copies of our two docs, and three screenshots of unrelated third-party dashboards used as mood references; the screenshots are already in `src/imports/` here).
- `AGENTS.md`, `CLAUDE.md`, `index.html`, `tsconfig.json`, `src/main.tsx` (identical).

**Do port, by rewriting into our structure:** the layouts in `src/modes/*`, the cockpit layout in `src/components/Cockpit.tsx`, the atoms' proportions, and the token values in `src/index.css`.

**Keeping round-trips with Figma Make possible (Recommendation).**
1. Keep `src/ui` and `src/modes` pure views: they read `BoardState`, call `BoardActions`, and use the cockpit context's loaders (§2.4). They import `bridge.ts` only with `import type`.
2. Add `src/board/fixtureBoard.ts`: a `BoardState` built from fixtures that match `docs/FRONTEND_BRIEF.md` §3 (at least 12 plan entries, 20 queue items, a lead brief), with no-op or local-state actions and fixture loaders for dev links, notes and context. Select it with `VITE_FIXTURES=true` (a build-time constant, so production builds drop it).
3. To iterate in Figma Make: copy `src/ui/`, `src/modes/`, `src/board/types.ts`, `src/board/fixtureBoard.ts`, the fixtures, `src/RichText.tsx`, the logic modules the fixture board uses, and `src/index.css` into the Figma Make project, with an `App.tsx` that renders the fixture board. The scaffolds match, so no other setup is needed.
4. Bring changes back as a diff limited to `src/ui/`, `src/modes/` and `src/index.css`. Review it against §4 (tokens, sizes, contrast, colour rule) and §6.11 (keyboard), then merge here. Never copy `.figma/`, lockfiles or `vite.config.ts` back.
5. Optional: write `*.stories.tsx` files for the atoms so they show on the kit page, once the stories format is confirmed.
