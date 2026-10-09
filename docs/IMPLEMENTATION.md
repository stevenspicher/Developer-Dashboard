# Developer Dashboard ↔ Notion Bridge: Implementation Guide (as built)

Status: implemented, tested, and pushed on 2026-09-29; updated 2026-10-02.
- **notion-bridge:** `e0108e9` on `stevenspicher/notion-bridge` (main)
- **Developer Dashboard:** `9f1cfc7` on `stevenspicher/Developer-Dashboard` (main)
- **2026-10-02 dashboard update:** `94843b2`: real sprint metrics, readable descriptions, and the design-token and legibility pass (§4 Styling, §5).
- **2026-10-02 notion-bridge fix:** `10eda90`: briefs with `heading_2` sections parse again (§2).

## 1. Overview
For the full bridge API contract (request and response shapes, errors, integration checklist), see [`Notion Bridge INTEGRATION.md`](../Notion%20Bridge%20INTEGRATION.md).

The dashboard is a React/Vite app on port 8443. It reads and writes Notion only through **notion-bridge**, an Express app on port 3100, and ADO User Stories only through **ado-bridge**, a FastAPI app on port 8000. The Vite dev server forwards `/bridge/*` and `/ado/*` to them (`vite.config.ts`; override with the `NOTION_BRIDGE_URL` and `ADO_BRIDGE_URL` env vars), so the browser never makes a cross-origin call.

```
Browser (Dashboard :8443) ──/bridge/*──▶ Vite proxy ──▶ notion-bridge :3100 ──▶ Notion API
                          ──/ado/*─────▶ Vite proxy ──▶ ado-bridge :8000 ────▶ Azure DevOps (or its mock seed)
```

The bridge drives almost everything from `config/manifest.json`. Adding or retuning a queue is a manifest edit plus a bridge restart; the manifest is read once and cached.

## 2. Notion setup (current state)
**Databases shared with the bridge integration:**
- Sprint Developer Items, Pulse Queue, Solarwinds, ADS Tickets, Sprints
- Initiatives, Issues, Analyst Issues, Deadlines and Milestones
- also shared, but unused: Upgrade Work Items

**The integration** has the Update content capability; a write test confirmed it.

**Required properties:**
| Database | Property | Type | Used for |
|---|---|---|---|
| Sprint Developer Items | Developer | Person | assignee filter |
| Sprint Developer Items | Mark Done | Checkbox | "open" filter (unchecked) and done write |
| Sprint Developer Items | Status | Status | set to Done on done |
| Sprint Developer Items | Initiative, Issue, Analyst Issue | Relation | Working Space context |
| Pulse Queue | Developer | **Person** (must be Person, not Text) | claim / release |
| Pulse Queue | Status | Status | Pending/Posted → In progress → Done |
| Pulse Queue | Initiative, Issue, Analyst Issue | Relation | Working Space context |
| Solarwinds | Assignee Name | Text | which developer sees the ticket |
| Solarwinds | State | Select | open states shown; Resolved hidden |
| Solarwinds | Initiative, Issue, Analyst Issue | Relation | Working Space context |
| ADS Tickets | Assignee | Text | which developer sees the ticket |
| ADS Tickets | Status | Status | open states shown; Done hidden |
| ADS Tickets | Priority | Select | Blocker/Critical, Major, Minor, Trivial |
| ADS Tickets | Issue Key, Issue Type, Description, URL | Text, Select, Text, URL | card ref, detail and Jira link |
| Sprints | Status = Focus, Deadline, Name "Sprint N" | | current sprint |
| Deadlines and Milestones | Label, Start Date, End Date | | calendar and ticker |

**Naming conventions the bridge relies on** (patterns are configurable in the manifest `standups` block):
- The current sprint page holds its standup pages somewhere in its block tree (toggles and columns are fine), titled `M/D Standup`.
- Each standup page has child pages titled `Sprint N – YYYY-MM-DD – Morning Brief – {FirstName}` and `Sprint N – YYYY-MM-DD – Leadership Summary`.
- Brief sections start at headings:
  - Morning Brief: `Team Items`, `Your responsibilities today`, `Aging items check`, and a closing section, which is ignored.
  - Leadership Summary: `Team Items`, then one heading per developer, `{Name} – YYYY-MM-DD`.
  - Briefs through 2026-10-01 use numbered `heading_3`s (`1) Team Items`); briefs since 2026-10-02 use `heading_2`s without numbers. The bridge starts a section at any heading level and ignores a `1)` or `1.` prefix.

**Test rows:** a row named `Bridge Test` in Pulse Queue and in Sprint Developer Items. Both are unassigned and left in their original state.

## 3. notion-bridge
### Manifest (`config/manifest.json`, schema in `manifest.schema.json`)
| Queue slug | Source | Behavior |
|---|---|---|
| `sprint-developer-items` | Sprint Developer Items | Lists items where Mark Done = False and the Developer is the viewer or empty. `done: {Mark Done: true, Status: Done}`. No claimed state. |
| `pulse-queue` | Pulse Queue | Claimable in Pending or Posted. `claimedState: In progress`, `releaseState: Pending`, `done: {Status: Done}`, assignee `Developer`. |
| `solarwinds` | Solarwinds | `readOnly`. `assigneeTextProperty: Assignee Name`. Every State except Resolved is listed. |
| `ads-tickets` | ADS Tickets | `readOnly`. `assigneeTextProperty: Assignee`. Listed in Not started, To Do, Blocked, On Hold, Waiting for Information or Client Review; Done is hidden. |
| `team-initiatives`, `issues`, `analyst-issues` | relation targets | Read-only context. |
| `deadlines-milestones` | Deadlines and Milestones | Read via `/databases/:slug/query`. |

The three work queues share this `relations` block:
```json
{ "initiative":   {"property":"Initiative",    "targetQueue":"team-initiatives"},
  "issue":        {"property":"Issue",         "targetQueue":"issues"},
  "analystIssue": {"property":"Analyst Issue", "targetQueue":"analyst-issues"} }
```

New manifest fields:
- **Queue fields:**
  - `readOnly`
  - `assigneeTextProperty`
  - `filterByAssignee` (default true)
  - `releaseState`
  - `done` (a map of property → value)
  - `statusProperty` can now be a checkbox, read as `"True"`/`"False"`.
- **`sprint` block:** source, `statusProperty`, `currentState` (Focus), `endDateProperty` (Deadline), `lengthDays` (14).
- **`standups` block:** title regexes and section names.

### Endpoints
| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness, Notion connectivity, and whether each queue's data source resolves. |
| `GET /sprint/current` | `{id, url, name, number, start, end}`. The number is parsed from the title; start = Deadline − 13 days. Cached 5 min. |
| `GET /queues/:slug?developer=` | `{items, claimed}`. `claimed` = rows in `claimedState` assigned to the developer. |
| `GET /queues?developer=` | All queues at once. |
| `GET /standup/today?developer=` | `{date, isToday, mode: brief\|leadership\|none, teamItems, responsibilities, aging, summaries}`. Each line is `{text, mentions: [pageId]}`. It uses today's standup, or the latest earlier one with briefs. It returns the developer's Morning Brief matched by first name, otherwise the Leadership Summary. Cached 5 min (page tree 10 min). |
| `GET /items/:id/related?queue=` | Item plus its related entities (properties, content, sub_pages). A related entity that has no link returns `{empty:true}`. |
| `GET /items/:id/notes?queue=` | `{notes}`: the developer's note on the item, read from a "Dashboard notes" section at the end of the item's page (`''` when there is none). 400 if the page isn't a row of that queue. |
| `PUT /items/:id/notes` | Body `{developer, queue, notes}` (max 10,000 characters). Edits that section in place, or adds the heading and paragraph on first save, and never touches the rest of the page or its properties. Allowed on `readOnly` queues, since that flag guards claims and done. |
| `POST /items/:id/claim` | Body `{developer, queue}`. Writes the assignee and claimedState. 409 if the item belongs to someone else or isn't claimable. |
| `POST /items/:id/release` | Only the current assignee can release. Clears the assignee and writes releaseState. |
| `POST /items/:id/done` | Writes the queue's `done` map. The assignee or anyone may do this when the item is unassigned. |
| `GET /databases/:slug/query` | Raw rows of any manifest queue (used for deadlines). |

**Write safety:**
- Every write re-reads the page fresh, runs under a per-item lock, and invalidates that queue's cache.
- `readOnly` queues return 400.
- If the assignee property isn't a Person field, writes return 400 with a clear message.
- Property writes are shaped by type (`buildPropertyWrite` in `notionHelpers.js`: status, select, checkbox, people, rich_text).
- The developer can be passed as `?developer=`, the `X-Developer` header, or a `developer` field in the JSON body.

**Key files:**
- `src/services/sprintService.js`: the `/sprint/current` logic.
- `src/services/standupService.js`: finding and parsing standup pages and briefs.
- `src/services/claimService.js`: claim, release and done.
- `src/services/queueService.js`: queue filtering and the `claimed` list.
- `src/services/noteService.js`: reading and writing the "Dashboard notes" section; `npm test` runs its tests (`test/`).
- `src/services/identity.js`: resolves a developer to a Notion user; now also returns the user's name.
- `src/notionClient.js`: gained `listBlockChildren`.
- Routes: `src/routes/{sprint,standup,items,queues}.js`.

**Running it:** `npm run start:work` from `notion-bridge/`; it reads `config/manifest.json` by default. Restart after any manifest change.

## 4. Developer Dashboard
**Files:**
- `src/types.ts`: shared `Task`/`Status`/`QueueSource` types.
- `src/bridge.ts`: API client, the `QUEUES` adapters (Notion queues and ADO Stories), saved lanes, the ADO HTML-to-text conversion, date helpers, tunable constants.
- `src/RichText.tsx`: renders description text with its line breaks and clickable links.
- `src/BootScreen.tsx`: the terminal-style loading screen.
- `src/App.tsx`: mounts the board, the saved look (`PrefsProvider`) and the chosen layout, Scan or Flow.
- `src/board/useBoard.ts`: all the board's state and behaviour with no markup: queues, writes and undo, the plan, lanes, ticks, the standup, and derived views. `board/BoardContext.tsx` provides it, `board/types.ts` holds the shared types (`DayActions`, `PlanView`, `Toast`…) and `board/constants.ts` the source tabs and timings.
- `src/modes/scan/` and `src/modes/flow/`: the two layouts (each a view over the board). `src/ui/` holds what they share: `Header`, `rows`, `LinkPicker`, `Reader`, `keymap` and the components described under Styling.
- `src/plan.ts`: the day's plan: storage, carry-over, merging the standup, and linking entries to board items.
- `src/ranking.ts`: the "Up next" ranking and its reasons.
- `src/schedule.ts`: "Coming up" (including dates read from team items) and day arithmetic.
- `src/keys.ts`: row keyboard shortcuts.
- `src/index.css`: design tokens and shared classes (see Styling below).

**Queues (left panel):**
| Tab | Source | Card | Actions |
|---|---|---|---|
| Stories | ado-bridge `/workitems`: User Stories assigned to the developer in the current sprint's iteration (`Blue Digital\Sprint N YYYY`). On by default; `VITE_ADO_STORIES=false` hides them. | `US-{id}`, state, points, description, acceptance criteria. ADO priority 1 = HIGH, 2 = MED, 3+ = LOW. | Adding to the plan or starting it sets Active, blocking sets Blocked, ✓ DONE sets Closed. Active stories start in the plan and Blocked ones in Blocked. |
| Tasks | `sprint-developer-items` | `DEV-xxxxxx`, Notes, developer initials, `SPR-N`, standup age. HIGH if the standup is more than 6 days old. | ✓ DONE; lanes are dashboard-only |
| Pulse | `pulse-queue` | `PULSE-xxxxxx`, Description, `SPR-N`. Priority MED for the current sprint, HIGH 1 sprint behind, CRIT 2 or more. | Adding to the plan, starting or dragging out claims it ("＋ CLAIM"); dragging back releases it; ✓ DONE |
| Solarwinds | `solarwinds` | `SW-{Number}`, Priority, Description, State | Read-only; lanes are dashboard-only |
| ADS | `ads-tickets` | Issue Key (`BLUEADS-222`), Priority, Description, Status, Jira link. Only the assignee sees it. Blocker and Critical = CRIT, Major = HIGH, Minor = MED, Trivial = LOW. | Read-only; lanes are dashboard-only |

Zendesk has no queue yet, so its tab is hidden. The queues list only items that aren't in today's plan, and the tab counts do the same.

**Board behavior:**
- **Lanes:** Todo (now "in today's plan"), Working and Blocked are saved in localStorage per developer (`devDashboard.lanes.<email>`), so they survive reloads.
- **Rebuilt on refresh:** each refresh rebuilds the bridge-backed cards from the bridge. Claimed Pulse items default to Todo.
- **One item in Working:** starting a new item moves the previous one back to Todo.
- **Writes with undo:** a Pulse claim or release and an ADO state change happen immediately and show a toast with UNDO, which reverses the write. If the write fails, the card moves back and the queue panel shows a dismissible error.
- **Mark done:** the card leaves at once, and the write waits 6 seconds so the toast's UNDO (or unticking the plan entry) can cancel it. A pending done is sent straight away if the page closes or the developer is switched.
- **No drag needed:** cards, plan entries and Up next rows have buttons, and keyboard shortcuts when focused: `j`/`k` move, `Enter` open, `s` start, `t` add to the plan, `x` tick, `d` done, `b` block, `Alt+↑/↓` reorder the plan, `Delete` remove from the plan. `p`, `n`, `r` and `q` jump to the plan, Up next, Reviews and the queues (a list in Scan, a section or the drawer in Flow); `Esc` closes the top overlay.

**The day (Flow shows it as one column; Scan splits it across its lists):**
- **Header:** the date, the sprint day and working days left, whether today's brief is in (click to read it), STANDUP DRAFT, and Stories closed/committed.
- **Today's plan:** a checklist built from today's standup responsibilities, plus anything added from the queues or Up next. It's saved per developer in localStorage (`devDashboard.plan.<email>`), and unfinished entries carry over to the next day. A responsibility repeated in a later standup refreshes its entry instead of adding a second one.
- **Linking entries to board items:**
  - An @mention in the brief line, or an ADO number in its text, links exactly.
  - Otherwise a clear title match links the entry. A weaker one shows "Looks like DEV-…", with CONFIRM or ✕.
  - LINK (or Enter on the entry) opens a picker to choose or remove a link.
  - A linked entry can be started, and ticking it marks the item done in its source.
- **Linked items that leave the board:** if a linked item disappears, the entry ticks itself when the source says it's finished (ADO Closed, or the Notion page's Status or Mark Done). Otherwise it's flagged "Not on your board".
- **Up next:** queue items not in the plan, ranked by the brief's aging items, standup age, how many sprints a Pulse item has been open, ADO priority, the sprint ending, and Solarwinds priority. Each shows its reasons. Possible duplicates (near-identical titles) are flagged.
- **Open pull requests:** every active pull request in the repos organization, oldest first, from ado-bridge `GET /pullrequests` (no reviewer filter, so every developer sees the same list). Each shows the repo, author and how long it has waited (flagged after 2 days), and opens the PR in Azure DevOps. Drafts are left out, and pull requests aren't added to the standup draft. It refreshes every 5 minutes and is hidden when stories are switched off (`VITE_ADO_STORIES=false`).
- **Standup draft:** the header's STANDUP DRAFT opens the reader on an editable update with COPY and RESET (`src/standup.ts`, `src/StandupDraft.tsx`). It lists **Done** (the last day that had anything finished, plus today's), **Today** (open plan entries with `REF` and criteria progress such as "2/3 criteria done") and **Blocked**. It follows the board until you edit it; RESET rebuilds it. Finished entries are kept for a week in the plan's `doneLog` when a new day rolls the plan over.
- **Blocked:** shown when anything is blocked, or while dragging, as a drop target.
- **Coming up:** the next 21 days from Deadlines and Milestones, the sprint end, and dates read from today's team items ("Code Jam at HQ on Oct. 8"). A team-item date that repeats a calendar entry is left out.
- **Team notes:** today's team items, replacing the old ticker.
- **Leads:** someone who gets the Leadership Summary sees "Team today" first: each developer's update, plus their ADO stories in the Blocked state. Notion tasks blocked on the board live in each developer's browser, so they don't appear here.

**Working on an item:**
- Starting an item shows it in Flow's Working card, or in Scan's pane. Marking it done highlights the next plan entry.

**Working card, Scan's pane and the detail modal:** all show the same cockpit pane (`src/ui/cockpit/CockpitPane.tsx`), the working one with a green "Working" marker.
- **Header:** type, ref, source, state, "Open in ADO/Notion ↗" and "Ticket ↗", priority, points, sprint and avatar.
- **Action bar, by the item's lane:** queue → ▶ Start and ＋ Plan (＋ Claim and plan for a Pulse item; "In today's plan" instead when it already is); today → Start and Block; working → Return to plan (draggable back to the queue) and Block; blocked → Unblock. ✓ Done is added wherever the source can be written to. In the modal the buttons follow the item as its lane changes.
- **Body:** title, description, checklist and notes, with dev links, project context and linked items beside them (below them when the pane is narrow, using a container query). Dev links and project context load for any item opened, not only the one being worked on, and the pane is keyed by the item so notes and ticks don't carry over to the next.
- **Project context:** the linked Initiative, Issue and Analyst Issue as cards (Notion items), or the parent work item (ADO stories). A card opens a full view: every property with a value, full Description or Notes, full page content, and sub-page links.

**Task cockpit** (`src/ui/cockpit/`, logic in `src/cockpitLogic.ts`): the parts below appear in the pane.
- **Acceptance criteria checklist:** each criterion can be ticked, with a count (3/5) in the heading and an `AC 3/5` chip on queue cards. Ticks are stored in this browser per developer (`devDashboard.criteria.<email>`, keyed by criterion text) and nothing is written to ADO. They are cleared when the item is marked done in the dashboard, or when ADO reports it Closed.
- **Dev links** (stories): pull requests (OPEN, DRAFT, MERGED or ABANDONED), branches, builds (PASSED, FAILED, PARTIAL or RUNNING), commits and hyperlinks, from ado-bridge `GET /workitems/{id}/links`. Against an ado-bridge without that endpoint the panel says it needs updating.
- **Linked items:** ADO child and related work items (the parent stays under Project Context), plus loaded items that name this one by ref (`US-12345`, `#12345`, `BLUEADS-222`, `SW-4021`) or are named by it. Matching is on ref text only. Items on the board open in the detail view; others link out to ADO.
- **Notes:** one note per item, saved with SAVE NOTE (Ctrl or ⌘ + Enter). On a story it is a single ADO comment starting with `[Dev Dashboard note]`, edited in place on later saves. On a Notion item it is the "Dashboard notes" section of the item's page. Unsaved text is kept while you switch tasks.

**Scan layout (`src/modes/scan/`; `/?ui=scan` shows it until a layout is picked in the header):** a list on the left and the selected thing in full on the right. Focus is the selection: j and k move through the list and the pane follows.
- **Lists (tabs):** Plan, Queue (with a tab per source and its unplanned count), Next (Up next, with its reasons), Reviews, Blocked, and Team for a lead. Counts show on each tab. Switching lists clears the selection, so the pane shows what is being worked on, or nothing.
- **The pane:** the cockpit pane for an item (a linked plan entry shows its item); an entry pane for a plan entry with no item (link it, confirm a suggestion, tick or remove it); a pull request pane (open in Azure DevOps); a team pane (a developer's update and blocked stories). The selection is a typed value (entry, task, review or team), so ids of different kinds can't be confused.
- **Keys:** one table (`src/ui/keymap.ts`) drives the row handlers and the footer hints, and a test presses every key in it. Row keys are Enter, s, t, x or space, d, b, Delete and Alt+↑/↓; `p q n r` jump to the Plan, Queue, Next and Reviews lists and focus the first row. Enter on a row moves focus into the pane (an unlinked entry opens the link picker, a review opens the pull request); Esc in the pane returns to the row. The footer shows only keys some row in the current list responds to. Keys are ignored with Ctrl, Cmd or Alt, while an overlay is open, and while typing in a field.
- **Drag and drop:** task and plan rows drag; the Plan, Blocked and Queue tabs accept drops (add to plan, block, return to queue) and highlight while a drag is over them; the pane accepts a drop to start it. A plan row dropped on Blocked blocks its item, on Queue removes it from the plan, and on the pane starts its item. Plan rows reorder by dropping one on another.
- **Narrow windows (under 900px):** the list fills the width and clicking a row opens the pane as a full-width sheet with "← List" (Esc also returns, to the selected row). Under 1100px the header folds Planned and Blocked into one chip and shows only the time.
- **Overlays:** the reader (brief, team items and dates, calendar, standup draft), the link picker and an item's full view use the shared overlay with a focus trap; the toast and the error banner come from the shared components.

**Header, layouts and look (`src/ui/prefs.tsx`, `LookControls.tsx`, `theme.ts`):** the header's switcher chooses Auto, Scan or Flow; the Look menu chooses theme (Dark, Light, System), density (comfortable, compact) and the HUD ornaments. They are saved per developer in `devDashboard.ui.<email>` as `{ theme, density, layout, hud }` and applied to `<html>` as `data-theme`, `data-density` and `data-hud`; changing the developer loads theirs. Defaults: Dark, comfortable, Auto, no ornaments. Switching layouts keeps everything, because the board sits above them and note drafts live outside the layouts.

**Flow layout (`src/modes/flow/`; `/?ui=flow` shows it until a layout is picked in the header):** the day as one centred column (max 720px), read top to bottom.
- **Sections:** the day header (date, sprint line, brief chip, standup draft, story progress, and a day strip `7 to do · 1 working · 1 blocked · 0 done today` whose parts scroll to their sections); Team today (leads); Today's plan; Working; Blocked (shown when anything is blocked, or while dragging); Up next; Open pull requests; Coming up; Team notes.
- **Plan rows** tick, start, block, remove and reorder (drag, or Alt+↑/↓). Enter or a click expands a row in place into a compact cockpit (dev links and context below the notes) with "Open full" (the dialog) and Collapse; an unlinked entry expands to its suggestion and link controls. Esc collapses it and returns focus to the row. Enter on an unlinked row opens the link picker.
- **Working** shows the full cockpit. Up next, Blocked and the drawer open an item in the dialog.
- **Queues drawer** (right, 360px; full width under 900px): `q` or "＋ Add item" opens it and focuses its first card, Esc or a click outside closes it and returns focus. It has a tab per source with unplanned counts. It is a drop zone for returning items to the queue; its click-catcher steps aside while a card is dragged so the card can reach the plan.
- **Drag and drop:** task cards drop on the plan (add), Working (start) and Blocked (block). A plan row dropped on Working starts its item, on Blocked blocks it, and on the drawer removes it from the plan.
- **Keys:** the row keys of Scan, plus `p n r` to focus the first row of Plan, Up next and Reviews and `q` for the drawer; all from `src/ui/keymap.ts`, with a footer built from the keys some row responds to.

**Descriptions:**
- `htmlToText` in `bridge.ts` turns ADO HTML into text that keeps line breaks, blank lines between paragraphs, `•` and `1.` list markers (indented when nested), and links as `[label](url)`. Bold, italics and colours are dropped.
- `RichText` renders that text, and plain Notion text, keeping line breaks and making `[label](url)` and bare URLs clickable in a new tab. It never renders HTML.
- Card previews use `plainText`, which strips the URLs and collapses the text to one line.

**Header:** the sprint name and dates, the sprint day (`10/14`), open plan entries, the Blocked count, the clock and date, and a TEMP developer switcher.

**Reader overlay (`src/ui/Reader.tsx`):** opened from the day header and sections (the brief chip, Standup draft, Brief ⤢, Calendar ⤢) and Scan's footer. It has four tabs; Esc or a click outside closes it.
- **Daily Brief:** the responsibilities and aging items, or a lead's Leadership Summary. Lines that @mention a Task show `DEV-… ↗` and open it.
- **Team Items & Dates:** team items plus deadlines starting or ending within 14 days.
- **Sprint Calendar:** Deadlines and Milestones through the sprint end plus 42 days, with bars showing where each falls in the sprint.
- **Standup Draft:** the editable update described under Standup draft above.

Stories closed/committed comes from the ADO query, which includes closed items for this; the board still hides Closed and Removed stories.

**Boot screen:**
- Shows on first load and whenever the developer is switched.
- **Login banner:** it types a login banner, including a last-login line saved per developer in localStorage.
- **Steps tied to real requests:** the five steps are uplink, sprint, queues, brief and deadlines. Each shows a spinner until its request finishes, then `[ OK ]` or `[FAIL]`.
- **Greeting and summary:** a random greeting from 14 templates using `{name}`, `{tod}` and `{sprint}`, then a summary line. It fades out, and any key or click skips it.

**Refresh intervals:** queues and sprint every 60 seconds; brief and deadlines every 5 minutes.

**Tunable constants:**
- `src/bridge.ts`:
  - `BRIDGE_REFRESH_MS`, `CONTEXT_REFRESH_MS`
  - `STALE_STANDUP_DAYS` (6), `DEADLINE_TICKER_DAYS` (14), `CALENDAR_LOOKAHEAD_DAYS` (42)
  - `TEST_DEVELOPERS`
- `src/board/constants.ts`: `UNDO_MS` (6000, the undo window). `src/ui/cockpit/ProjectContext.tsx`: `RELATION_FIELDS`.
- `src/plan.ts`: `LINK_AT` (0.6), `SUGGEST_AT` (0.4), `LINK_MARGIN` (0.1) and `DUPLICATE_AT` (0.8) for title matching.
- `src/ranking.ts`: `WEIGHTS` for each "Up next" signal, and `SPRINT_ENDING_DAYS` (3).
- `src/schedule.ts`: `COMING_UP_DAYS` (21).
- `src/modes/flow/FlowMode.tsx`: `UP_NEXT_SHOWN` (6).
- `src/BootScreen.tsx`: `GREETINGS` and the timing constants.

**Styling (design tokens in `src/index.css`):**
- **Where values live:** raw values are CSS variables on `:root` (the dark theme, also `[data-theme='dark']`), and `[data-theme='light']` overrides every one of them. `@theme inline` maps them to Tailwind utilities such as `bg-surface`, `text-muted`, `border-line` and `text-meta`.
- **No hardcoded colours:** components and classes use tokens only. `--tint` and `--shade` give the washes that lighten or darken a surface (`bg-tint/5`, `bg-shade/40`). Hover and focus washes, card and drop-target colours, shadows, scrollbar and the boot screen (`--boot-bg`, `--scanline`, `--glow-text`…) are tokens too, so the boot screen follows the theme: a CRT in dark, plain in light.
- **Theme and density:** `src/ui/theme.ts` loads and saves a developer's look (`devDashboard.ui.<email>`: theme dark, light or system; density comfortable or compact; layout auto, scan or flow; the HUD ornaments on or off) and applies `data-theme`, `data-density` and `data-hud` to `<html>` before the first paint. `compact:` is a Tailwind variant for the compact density.
- **Shared components (`src/ui/`, used by both layouts):** `atoms.tsx` has `Chip` (neutral unless it reports a status), `TypeChip`, `Ref`, `PriorityBadge`, `Avatar`, `SectionLabel`, `Kbd`, `Button` (quiet, primary, done, danger), `Checkbox` (a real `role="checkbox"`), `Tabs` (arrow keys, Home and End), `RadioGroup`, `EmptyState`, `ErrorNote` (announced, optionally dismissible), `PrStatus` and `BuildStatus`. `Overlay.tsx` is a labelled modal that traps Tab, closes on Esc (only the top one, when one opens from another) or an outside click and returns focus to what opened it; `Toast.tsx` is the announced message with Undo. `labels.ts` holds the words and tones (priority, type, PR and build status) as plain functions. Colour carries status only, and Inter is used except for refs, counts, chips and section labels. `/?ui=atoms` shows them all in either theme and density.
- **Checking it:** `npm run contrast` tests every text token against every surface in both themes (AA, 4.5:1) and fails otherwise; the same check runs in `npm test`. `/?ui=tokens` shows every token, the type scale, the shared classes and a boot sample, in either theme and density (`&theme=light&density=compact` picks the look from the address).
- **Type scale:**

  | Token | Size | Use |
  |---|---|---|
  | `text-badge` | 10px | counters and badges only |
  | `text-meta` | 11px | mono labels, IDs, chips |
  | `text-note` | 12px | secondary text, card previews |
  | `text-body` | 13px | titles and body text |
  | `text-read` | 14px | modals and the reader |
  | `text-stat` | 16px | header numbers |
  | `text-title` | 18px | the active item's title |
  | `text-display` | 21px | modal titles |

  Nothing goes below 10px.
- **Text colours:**
  - `ink` for titles, `fg` for body text, `dim` for secondary text, `muted` for labels and metadata.
  - All of them are at least 4.5:1 against the background and the panels (WCAG AA).
  - `faint` is for borders and decoration only, never text.
- **Colour meanings:**
  - Each colour has one meaning: `accent` = interactive or selected, `ok` = done or active, `warn` = needs attention (HIGH, a stale standup, aging items), `danger` = critical, blocked or failed.
  - Sources aren't colour-coded; type tags are neutral chips, and MED and LOW priorities are neutral.
- **Shared classes:** `.label`, `.ref`, `.chip`, `.btn-quiet`, `.link`, and `.panel`, in `@layer components`.
- **Fonts:** monospace is for IDs, labels and metadata. Titles, body text and tab names use Inter.
- **Inline styles:** inline `style` is only for data-driven values, such as calendar bar positions and the boot fade.
- **Layout:** Scan's list width scales with the window (`clamp()`); Flow's column is at most 720px.
- **Focus:** keyboard-focusable rows (`.row`) show an accent outline; `.row-flash` briefly highlights the next plan entry.
- **Motion:** the pulse dots, cursor blink and row highlight stop when the OS asks for reduced motion.

## 5. Verification performed
**2026-10-02 (My Day), against ado-bridge in mock mode.** No Notion item was claimed or marked done.
- **Build:** `npx tsc --noEmit` and `npm run build` are clean, with no console errors on a fresh load. No text is under 10px or below AA contrast.
- **Plan from Philip's 10/02 brief:**
  - 4 of 6 responsibilities linked to their tasks by title.
  - The PR review stayed unlinked, and the product-ingestion line had no confident match.
  - The aging task was flagged, and DEV-923660 / DEV-9EB23B were flagged as possible duplicates.
  - The two Active stories joined the plan.
- **Up next:** led by the aging late-fees task, then Pulse items 2+ sprints old, then P2 stories with "Sprint ends Tue".
- **Coming up:** Code Jam (Oct 8), Dev Day (Oct 9) and Oct 13 events were read from team items; "BPM pen testing begins" wasn't duplicated.
- **Keyboard:** `p`/`j` moved through the plan, `x` ticked and unticked an unlinked entry, and `Alt+↑/↓` reordered it.
- **Linking:** Enter opened the link picker, filtering and Enter linked an entry, and REMOVE LINK unlinked it (the item isn't suggested again for that entry).
- **Working on an item:** START opened it with the plan rail, and Esc toggled between it and My Day ("Working on … RESUME").
- **Done and undo:** ✓ DONE then UNDO left ADO untouched after the window. `d` on an Up next story closed it after 6 seconds, and Stories went to 1/5.
- **Adding and blocking:**
  - Adding a story set it Active, and UNDO set it back to New and removed the plan entry.
  - Adding a Notion task wrote nothing.
  - `b` set a story Blocked, and UNBLOCK set it Active again.
- **Lead view:** Steven saw Team today with 5 updates, and Taylor's blocked story under Taylor.
- **Done elsewhere:** closing a planned story directly in ADO ticked and locked its entry on the next load.
- **Layout:** no clipping or horizontal scroll at 1280×720, 1440×900 or 1920×1080.

**2026-10-02 (sprint metrics, descriptions, legibility pass), against ado-bridge in mock mode:**
- **Build:** `npx tsc --noEmit` and `npm run build` are clean, with no console errors.
- **Legibility, measured on the live page at 1440×900:** visible text under 10px went from 105 nodes to 0, and text under 4.5:1 contrast from 44 nodes to 0.
- **Layout:** there's no clipping or horizontal scroll at 1280×720, 1440×900 or 1920×1080. At 1920×1080 the brief strip is 320px tall, up from 174px.
- **Descriptions:**
  - US-12148: numbered steps, nested bullets, and a link whose text differs from its URL.
  - US-12236: a heading, paragraphs and a Notion link.
  - US-12277: the PULSE service-request link.

  All three render with their structure and working links.
- **States:** stories show New, and Active after a move to Working; the Solarwinds ticket shows Monitoring. The detail modal labels it STATE.
- **Sprint panel:** Day 10/14 on 2026-10-02. Philip's stories showed 0/5 · 0/9 PT from the mock seed.
- **Briefs after the notion-bridge heading fix:**
  - Philip's 10/02 Morning Brief parses to 4 team items, 6 responsibilities and 3 aging lines.
  - Steven gets the 10/02 Leadership Summary with 5 developer updates.
  - The 10/01 `heading_3` briefs still parse the same way.
  - The dashboard shows the brief and the team items in the ticker again.

**2026-09-29 (notion-bridge integration):**
- **Write access:** Task done set Mark Done ✓ and Status Done; I reverted it afterwards.
- **Pulse on `Bridge Test`:**
  - claim set In progress and Developer = Steven;
  - Philip's claim got 409;
  - the row appeared in Steven's claimed list;
  - Philip's release got 409;
  - Steven's release set Pending and cleared Developer;
  - done set Done;
  - the row was reset to Pending afterwards.
- **Read-only guard:** a Solarwinds claim returns 400.
- **Guards before the field fixes:**
  - a Pulse claim against the Text-type Developer field returned 400;
  - in the UI, the card moved back and the error was shown.
- **Standup:** Philip got his 9/29 Morning Brief (5 team items, 5 responsibilities, 3 aging). Steven got the Leadership Summary (5 developer summaries).
- **Queue counts:** Solarwinds shows Steven 6 tickets and Philip 1. Tasks are filtered per developer.
- **Browser checks:**
  - brief and ticker content; calendar with 7 items;
  - context card and full view, using a temporary relation that was later removed;
  - lanes kept after reload;
  - the reader's three tabs;
  - the ticker at 35 px/s;
  - the boot screen with both warm and cold caches.
- **Type check:** `npx tsc --noEmit` is clean.

## 6. Known limitations and next steps
- **Cold-start latency:** the bridge allows 2.5 Notion requests/sec, and the queue cache lasts 30 seconds. Right after a bridge restart, the first load takes about 10–20 seconds, mainly walking the sprint page tree and loading all 779 rows of Sprint Developer Items. The boot screen covers it. A longer queue TTL or warming the cache in the background would fix it properly.
- **Temporary developer switcher:** the TEMP switcher (`TEST_DEVELOPERS`, and the `TEMP` `<select>` in `App.tsx`) should be replaced by real login.
- **ADO Stories need credentials:**
  - The Stories tab is on by default and reads real Azure DevOps data through ado-bridge, which needs `ADO_PAT` in its `.env`. Moves and ✓ DONE write to Azure DevOps.
  - With `ADO_MOCK=true`, ado-bridge serves a local seed instead, and moves change only its in-memory copy, which resets when it restarts. Use `VITE_ADO_STORIES=false` to hide the tab when ado-bridge isn't available.
- **No done/total for Notion queues:** notion-bridge returns only open Sprint Developer Items and Pulse rows, so only Stories shows closed/committed.
- **Briefs don't link to items:** the 10/02 briefs have no @mentions of tasks, so plan entries link by title (4 of 6 that day), with CONFIRM or LINK for the rest. If the brief generator @mentioned the task on each responsibility, linking would be exact.
- **Blocked Notion items stay private:** Notion has no Blocked status. Sprint Developer Items uses Backlog / In Progress / Done; Pulse uses Not started / Pending / Posted / In progress / Done. A blocked Notion task is therefore only visible in its developer's browser, and a lead sees ADO blockers only. A Blocked status in Notion, written by the board, would fix this.
- **No meetings yet:** the team uses Outlook; showing meetings and free time in My Day waits for the calendar integration.
- **Ranking weights are a first pass:** they're in `WEIGHTS` in `src/ranking.ts`; tune them once the team has used Up next for a while.
- **Notes are one per item:** a story's note is the latest ADO comment that starts with `[Dev Dashboard note]`. Notion notes need the integration to have update-content access to that database.
- **Dev links need an ado-bridge that has `/workitems/{id}/links`:** the host's ado-bridge must be updated before stories show dev links, notes history or related work items.
- **Open pull requests need ado-bridge `/pullrequests`:** the host's ado-bridge must be updated. The list is the same for every developer; it doesn't show who is asked to review.
- **Standup draft is a starting point:** plan lines are the standup's wording, so long lines need trimming by hand. Done history exists only from the day the done log was introduced.
- **Plan lives in one browser:** like lanes, the plan is per developer per browser.
- **Solarwinds re-imports:** replacing rows via CSV re-import loses any relations set by hand.
- **Brief matching:** briefs are matched by the Notion user's first name, so two developers with the same first name would collide.
- **Release target:** Pulse release always goes to `Pending`, not back to the item's previous status.
- **Bridge process:** during development the bridge ran as a Claude session background task. Run it from your own terminal for anything long-lived.
