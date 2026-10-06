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
| `ads-tickets` | ADS Tickets | `readOnly`. No assignee property, so every developer sees the same tickets. Listed in Not started, To Do, Blocked, On Hold, Waiting for Information or Client Review; Done is hidden. |
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
- `src/App.tsx`: UI (queues, working space, brief, calendar, reader, overlays).
- `src/index.css`: design tokens and shared classes (see Styling below).

**Queues (left panel):**
| Tab | Source | Card | Actions |
|---|---|---|---|
| Stories | ado-bridge `/workitems`: User Stories assigned to the developer in the current sprint's iteration (`Blue Digital\Sprint N YYYY`). Off unless the dev server starts with `VITE_ADO_STORIES=true`. | `US-{id}`, state, points, description, acceptance criteria. ADO priority 1 = HIGH, 2 = MED, 3+ = LOW. | Today or Working sets Active, Blocked sets Blocked, ✓ DONE sets Closed. Active stories start in Today and Blocked ones in Blocked. |
| Tasks | `sprint-developer-items` | `DEV-xxxxxx`, Notes, developer initials, `SPR-N`, standup age. HIGH if the standup is more than 6 days old. | ✓ DONE; lanes are dashboard-only |
| Pulse | `pulse-queue` | `PULSE-xxxxxx`, Description, `SPR-N`. Priority MED for the current sprint, HIGH 1 sprint behind, CRIT 2 or more. | Drag out = claim, drag back = release, ✓ DONE |
| Solarwinds | `solarwinds` | `SW-{Number}`, Priority, Description, State | Read-only; lanes are dashboard-only |

Zendesk has no queue yet, so its tab is hidden. The queues list only items that aren't in today's plan, and the tab counts do the same.

**Board behavior:**
- **Lanes:** Todo, Working and Blocked are saved in localStorage per developer (`devDashboard.lanes.<email>`), so they survive reloads.
| ADS | `ads-tickets` | Issue Key (`BLUEADS-222`), Priority, Description, Status, Jira link. Blocker and Critical = CRIT, Major = HIGH, Minor = MED, Trivial = LOW. | Read-only; lanes are dashboard-only. A team-wide queue, not filtered per developer |
- **Rebuilt on refresh:** each refresh rebuilds the bridge-backed cards from the bridge. Claimed Pulse items default to Todo.
- **One item in Working:** dropping a new item there moves the previous one to Todo.
- **Claim and release:** moves are shown immediately. If the claim or release fails, the card moves back and the queue panel shows a dismissible error.
- **Mark done:** removes the card once the write succeeds.

**Working Space:**
- Shows the active item with its state, NOTION ↗ or ADO ↗ and TICKET ↗ links, and ✓ DONE.
- Its Project Context column lists the linked Initiative, Issue and Analyst Issue as cards (Notion items), or the parent work item (ADO stories).
- Clicking a card opens a full view: every property with a value, full Description or Notes, full page content, and sub-page links.

**Descriptions:**
- `htmlToText` in `bridge.ts` turns ADO HTML into text that keeps line breaks, blank lines between paragraphs, `•` and `1.` list markers (indented when nested), and links as `[label](url)`. Bold, italics and colours are dropped.
- `RichText` renders that text, and plain Notion text, keeping line breaks and making `[label](url)` and bare URLs clickable in a new tab. It never renders HTML.
- Card previews use `plainText`, which strips the URLs and collapses the text to one line.

**Header and centre panels:**
- **Header:** live sprint name and dates, the sprint day (`10/14`), Today and Blocked counts, the clock and date, and a TEMP developer switcher.
- **Sprint panel:**
  - Time: the day of the sprint, with a bar.
  - Stories (when Stories are on): closed/committed stories and points for the developer, with a bar. The ADO query includes closed items for this; the board still hides Closed and Removed stories.
  - Tasks and Pulse + tickets: open counts. notion-bridge returns only open items, so there is no done/total for them.
- **Daily Brief:** the developer's responsibilities and aging items. Lines linked to a Task show `DEV-… ↗` and open that Task. Leads see the per-developer Leadership Summary. The panel says "TODAY'S NOT POSTED YET" when showing an older brief.
- **Ticker:** Team Items plus deadlines starting or ending within 14 days. It scrolls at a constant 35 px/s, pauses on hover, and a click opens the reader.
- **Sprint Calendar:** Deadlines and Milestones from today through the sprint end plus 42 days, grouped "This sprint" / "Upcoming", with a bar showing where each falls in the sprint.
- **Reader overlay:** opened by clicking the brief or calendar panel, the ⤢ button, or the ticker. It has three tabs (Daily Brief, Team Items & Dates, Sprint Calendar) and shows content at 1.15× size. Esc or a click outside closes it.

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
- `src/App.tsx`: `TICKER_PX_PER_SEC` (35), `RELATION_FIELDS`.
- `src/BootScreen.tsx`: `GREETINGS` and the timing constants.

**Styling (design tokens in `src/index.css`):**
- **Where values live:** raw values are CSS variables on `:root`, so a light or high-contrast theme only needs to override them. `@theme inline` maps them to Tailwind utilities such as `bg-surface`, `text-muted`, `border-line` and `text-meta`.
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
- **Shared classes:** `.label`, `.ref`, `.chip`, `.btn-quiet`, `.link`, `.panel`, `.panel-header` and `.task-card`, in `@layer components`.
- **Fonts:** monospace is for IDs, labels and metadata. Titles, body text and tab names use Inter.
- **Inline styles:** inline `style` is only for data-driven values, such as progress widths, ticker speed, calendar bar positions and the boot fade.
- **Layout:** the side columns and the brief strip scale with the window (`clamp()` in `App.tsx`).
- **Motion:** the ticker, pulse dots and cursor blink stop when the OS asks for reduced motion.

## 5. Verification performed
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
- **ADO Stories run on mock data:**
  - The Stories tab is off unless the dev server starts with `VITE_ADO_STORIES=true`.
  - While `ADO_MOCK=true`, ado-bridge serves a local seed. Moves and ✓ DONE change only its in-memory copy, which resets when it restarts.
- **No done/total for Notion queues:** notion-bridge returns only open Sprint Developer Items and Pulse rows, so the Sprint panel shows open counts for them.
- **Solarwinds re-imports:** replacing rows via CSV re-import loses any relations set by hand.
- **Brief matching:** briefs are matched by the Notion user's first name, so two developers with the same first name would collide.
- **Release target:** Pulse release always goes to `Pending`, not back to the item's previous status.
- **Bridge process:** during development the bridge ran as a Claude session background task. Run it from your own terminal for anything long-lived.
