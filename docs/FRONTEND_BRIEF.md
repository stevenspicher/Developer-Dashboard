# Developer Dashboard: front-end design brief

A self-contained brief for redesigning the dashboard's UI and UX. It says what the product is for, what the screen has to do, the exact data it works with, and the constraints. Everything here is current as of 2026-10-06. Names and ids in the samples are made up.

**The ask:** produce alternative front ends (visual design and interaction) for the same product and data. No new features. The current implementation (React 19, Vite, Tailwind CSS v4) is one possible answer, not a requirement.

## 1. What it is for

A personal dashboard for each software developer on a small team (about 6 developers, one of whom is a lead). Each person opens it at the start of the day and keeps it open all day. It answers four questions:

1. **What should I do today?** Plan the day from the morning standup's responsibilities plus anything pulled from queues.
2. **What's next, and why?** A ranked list of items outside the plan, each with the reasons it's there.
3. **What do I need to finish this item?** One place with the description, acceptance criteria, linked branches, PRs and builds, related items and a note.
4. **What do I tell the team?** A standup update built from what got done.

**Users:** developers (primary, all day, keyboard and mouse, desktop browser, usually a wide monitor) and one lead who also sees a team view. There is no mobile use today. A narrow-window layout is welcome but not required.

**Tone:** it is a working tool, kept open for hours. It should be calm, scannable and fast. The current look is a dark "HUD" (sci-fi terminal) style. It can be kept, changed or replaced.

## 2. What exists today (screens and regions)

| Region | Content |
|---|---|
| **Header** | App title, sprint line ("Sprint 20 · Sep 23 – Oct 6"), a developer switcher (a temporary stand-in for login), sprint day counter (14/14), counts for planned and blocked items, a clock and date. |
| **Queues panel** (left) | Tabs per source with counts: Stories (Azure DevOps), Tasks, Pulse, Solarwinds, ADS. Each tab lists cards for items not yet in today's plan. A card: type chip, ref, priority, points, title, a two-line preview, state chip, assignee initials, sprint, and hover actions (＋ PLAN, ▶ start, ✓ DONE). |
| **My Day** (centre, default) | Date and sprint line; chips for brief status, STANDUP DRAFT and story progress. Left column: **Today's plan** (a checklist; each row has a checkbox, text, source tags, a LINK/CONFIRM control and ▶ START). Right column: **Up next** (ranked suggestions with reason chips), **Reviews waiting** (pull requests), **Blocked** (drop target), **Coming up** (dated events), **Team notes**. Leads also see **Team today** above the plan. |
| **Focus view** (centre, while working) | Replaces My Day. A bar with "← MY DAY" and the next plan entry. Below it the **Working space**: header (ACTIVE, type, ref, state, links, ✓ DONE, RETURN), then two columns. Left: title, description, acceptance-criteria checklist, notes. Right: dev links, project context (parent or linked initiative/issue cards), linked items. Today's plan and Blocked move to a right-hand rail. |
| **Detail modal** | The same cockpit content for any card, opened from a queue card or plan row. |
| **Reader modal** | Four tabs: Daily brief, Team items and dates, Sprint calendar, Standup draft (an editable text area with COPY and RESET). |
| **Link picker** | Links a plan entry to a board item: filterable list ranked by title similarity. |
| **Toasts** | "Marked X done" with UNDO. Writes can be undone for 6 seconds. |
| **Boot screen** | A terminal-style loading screen while the first data loads (10–20 s cold). |

**Core behaviors to preserve**
- **Lanes:** an item is in the queue, in today's plan, being worked on (only one at a time), or blocked. Lanes are saved per developer in the browser.
- **Drag and drop** moves items between the queue, plan, working and blocked. Every drag also has a button and a keyboard equivalent.
- **Mark done** removes the item at once and waits 6 seconds before the write, so UNDO works.
- **Plan entries** come from the standup brief and can be linked to a board item (by @mention, ADO number, or title match with CONFIRM/✕). Unfinished entries carry over to the next day.
- **Keyboard (on a focused row):** `j`/`k` or arrows move, `Enter` open, `s` start, `t` add to plan, `x`/space tick, `d` done, `b` block, `Alt+↑/↓` reorder, `Delete` remove. Global: `p` plan, `n` up next, `q` queues, `Esc` toggles My Day and focus.
- **Notes** save per item with SAVE NOTE (Ctrl/⌘+Enter). Acceptance-criteria ticks are local to the browser.

## 3. The data (what the UI is given)

The browser calls two same-origin prefixes, `/bridge/*` (Notion data) and `/ado/*` (Azure DevOps). There is no login: the developer is chosen in the UI and passed as `?developer=<email>`. All dates are ISO. Everything below is JSON.

### 3.1 Item (a card), shared by every source
```ts
type Source = 'stories' | 'tasks' | 'pulse' | 'solarwinds' | 'ads'
type Lane = 'queue' | 'today' | 'working' | 'blocked'
type Priority = 'critical' | 'high' | 'medium' | 'low' | 'none'
type ItemType = 'story' | 'task' | 'bug' | 'spike' | 'alert' | 'ticket' | 'incident'

interface Task {
  id: string; ref?: string            // "US-12236", "DEV-CBB875", "PULSE-4440F0", "SW-4021", "BLUEADS-222"
  source: Source; type: ItemType
  title: string
  description: string                 // plain text with line breaks, "• " list markers, [label](url) links
  notes?: string                      // short text shown in card previews
  priority: Priority; priorityLabel?: string   // source wording: "P2", "Major"
  points?: number
  externalState?: string              // the source's state: "Active", "Client Review", "Monitoring"
  assignee: string                    // initials, e.g. "AL"
  sprint?: string                     // "SPR-20"
  standupAgeDays?: number             // Tasks only: days the item has sat in standup
  tags: string[]
  acceptanceCriteria?: string[]       // stories only
  url?: string; link?: string         // source page, external ticket
  status: Lane                        // assigned by the dashboard, not the source
}
```
Sample:
```json
{ "id": "12236", "ref": "US-12236", "source": "stories", "type": "story",
  "title": "Update developer diary template", "priority": "medium", "priorityLabel": "P2",
  "points": 1, "externalState": "Active", "assignee": "AL", "sprint": "SPR-20", "tags": ["docs"],
  "description": "As a developer I want a diary template so that lessons are captured.\n• What broke?\n• What did you fix?",
  "acceptanceCriteria": ["Diary lists the last 30 days", "Entries can be edited", "Empty state shows a prompt"],
  "status": "today" }
```

### 3.2 Queue sizes today (for realism)
A developer typically has 20–30 items outside the plan across all tabs, and one source rarely goes above about 10 (for example Stories 3, Tasks 2, Pulse 7, Solarwinds 1, ADS 8). The plan holds 5–14 entries.

### 3.3 Day and sprint
```json
// GET /bridge/sprint/current
{ "name": "Sprint 20", "number": 20, "start": "2026-09-23", "end": "2026-10-06" }
// derived: day 14 of 14, 0 working days left after today
```

### 3.4 Standup brief (drives the plan)
```json
// GET /bridge/standup/today?developer=ada.lee@example.com
{ "date": "2026-10-06", "isToday": true, "mode": "brief",        // 'brief' | 'leadership' | 'none'
  "teamItems":       [ { "text": "Code Jam at HQ on Oct. 8", "mentions": [] } ],
  "responsibilities":[ { "text": "Investigate the transfer error (HELOC pull)", "mentions": ["<pageId>"] } ],
  "aging":           [ { "text": "Late-fees email, aging since Aug 31", "mentions": ["<pageId>"] } ],
  "summaries":       [ { "developer": "Ben Okafor", "text": "Finishing the QSO config; blocked on access." } ] }  // leads only
```
Plan entries are built from `responsibilities`. Lines can be long (one or two sentences).

### 3.5 Plan entry (stored in the browser)
```ts
interface PlanEntry {
  id: string; text: string; origin: 'standup' | 'added'
  itemId?: string; itemRef?: string; itemSource?: Source     // link to a board item
  linkedBy?: 'mention' | 'ref' | 'match' | 'you'
  done?: boolean; missing?: boolean                          // missing = linked item left the board
}
```

### 3.6 Up next suggestion
```ts
{ task: Task, score: number, reasons: { text: string; urgent?: boolean }[] }
// reasons e.g. "Aging since Aug 31" (urgent), "In standup 36 days" (urgent), "2 sprints old", "P1", "Sprint ends Tue"
```

### 3.7 Coming up
```ts
{ date: '2026-10-08', end?: '2026-10-09', label: 'Code Jam', kind: 'deadline' | 'sprint' | 'team' }
```

### 3.8 Cockpit data (loaded when an item opens)
```ts
// Stories only, from GET /ado/workitems/{id}/links
interface DevLinks {
  pullRequests: { id: number; title?: string; status?: 'active' | 'completed' | 'abandoned'; isDraft?: boolean; repo?: string; url: string }[]
  branches:     { name: string; repo?: string; url: string }[]
  builds:       { id: number; name?: string; definition?: string; status?: string; result?: 'succeeded' | 'failed' | 'partiallySucceeded' | 'canceled'; url: string }[]
  commits:      { sha: string; repo?: string; url: string }[]
  hyperlinks:   { title: string; url: string }[]
  workItems:    { adoId: number; relation: 'parent' | 'child' | 'related'; title?: string; state?: string; workItemType?: string; url?: string }[]
}
// Notion items: related context cards (Initiative, Issue, Analyst Issue)
interface RelatedEntity { relation: string; title?: string; url?: string; properties?: { name: string; value: string }[]; content?: string; empty?: boolean; error?: string }
// Notes (both sources): a single string, saved explicitly.
```
Cross-source links are computed in the UI: any item whose text contains another item's ref (`US-12345`, `#12345`, `BLUEADS-222`) links to it, in both directions.

### 3.9 Reviews waiting
```ts
interface PullRequest { pullRequestId: number; title: string; repo?: string; author?: string; createdDate?: string; isRequired: boolean; url: string }
// oldest first; waiting 2+ days is flagged
```

### 3.10 Team view (leads)
```ts
{ assignee: string; ref: string; title: string; url?: string }   // blocked stories across the sprint
```

### 3.11 Standup draft (generated text)
```
Standup · Tuesday, Oct 6

Done
• Merged the CUSO hotfix into the upgrade branch (DEV-923660)

Today
• Investigate the transfer error (DEV-E5ADEC) — 2/3 criteria done
• Review PR 482: Holiday loans merge fix (loans-api, 3 days old)

Blocked
• US-12277 Create ticket for removing voided transactions
```

## 4. States every screen needs
- **Loading:** first load takes 10–20 s; later refreshes are quiet (data refreshes every 60 s, context every 5 min).
- **Empty:** no plan yet (before the brief is posted), empty queue, nothing waiting for review, no dev links, no linked items.
- **Partial failure:** one source can fail while others work. Show the error against that source only (for example a queue's error banner, or "Reviews unavailable").
- **Pending write:** a done item is hidden but undoable for 6 seconds; a failed write moves the item back and shows a dismissible error.
- **Lead vs developer:** leads see an extra team section; their own plan works the same.

## 5. Current design system (reference, change freely)
- **Palette:** background `#060b14`, panel `#0d1626`, text `#c8dff0`, titles `#e0f0ff`, secondary `#9bb8cf`, muted `#7090a8`; accent cyan `#00d4ff` for interactive or selected, green `#00ff88` for done or active, amber `#ffaa00` for needs attention, red `#ff3355` for critical, blocked or failed. Colour carries status only.
- **Type:** Inter for text and JetBrains Mono for refs, labels and chips. Sizes 10 (badges), 11, 12, 13 (body), 14, 16, 18, 21 px. Section labels are small caps with letter spacing. Nothing text-bearing goes below 10px; body text is 13px.
- **Contrast:** all text is at least 4.5:1 (WCAG AA).
- **Components:** panels with a faint top highlight, mono chips, quiet bordered buttons, cards with a hover border, drop zones that glow while dragging.

## 6. Observed UX problems worth solving
These are observations from using it, not user research.
1. **Density and width.** Three columns plus a header need a wide screen. At about 800px the focus view's text column is cramped. There is no real responsive behavior.
2. **Long, stacked item pages.** In the detail modal a long description pushes acceptance criteria, dev links, linked items and notes below the fold, so the "everything to finish this" promise needs scrolling.
3. **Two layouts for one thing.** The detail modal and the focus view show the same cockpit in different arrangements.
4. **Queues and Up next overlap.** Both list items outside the plan. The difference (a list per source versus one ranked list) isn't obvious.
5. **Heavy plan rows.** Plan lines are standup sentences, sometimes two lines long, with several tags and controls each.
6. **Hidden affordances.** Drag and drop and the row shortcuts are powerful but undiscoverable. Actions appear only on hover.
7. **A grab-bag reader.** Brief, team items, calendar and standup draft share one modal because they're "things to read", not because they belong together.
8. **Small mono text everywhere.** It suits the style but is tiring over a full day at 11–12px.
9. **Slow, theatrical start.** The boot screen covers a 10–20 s load but adds nothing once data is cached.
10. **No light theme or density option.**

## 7. Directions worth exploring
Offer two or three, each with a short rationale, and the same sample data in each.
- **A. Today timeline.** One calm column down the centre: the plan as the day's spine, the working item expanded inline, queues and reviews in a collapsible side drawer. Optimises for "what am I doing right now".
- **B. Board.** Columns for Plan, Working, Blocked and Done today, with the queues as a left drawer. Drag and drop is the primary model. Optimises for a visual, spatial overview.
- **C. Inbox and reading pane.** A list on the left (queues, reviews and Up next as filters), the full cockpit on the right, like a mail client. Optimises for triage speed and keyboard use, and gives the cockpit one consistent home.
- **D. A light, quiet theme.** Any of the above in a calmer, higher-legibility, low-ornament style, with a density option.

## 8. Deliverables to ask for
1. A short rationale per direction (who it favours and what it trades away).
2. Screens for My Day, the focus view with the full cockpit, the queues, and the standup draft, with realistic data from section 3 (at least 12 plan entries and 20 queue items, including long titles).
3. States from section 4: empty, loading, error, a pending undo, and a lead's team section.
4. A desktop layout at about 1440px and one at about 1024px.
5. Keyboard behavior notes for the main flows.
6. If it is code: React and Tailwind, running against fixtures that match section 3, so it can be dropped in place of `src/App.tsx` and `src/MyDay.tsx`.

## 9. Out of scope
New data sources or features (calendar, mentions and CI are deferred). Changing the bridges' APIs. Authentication, which is a separate piece of work: for now the developer is picked in the UI.

## 10. Where to find more
`docs/IMPLEMENTATION.md` in the repo describes the current behavior in detail (queues, board rules, My Day, cockpit, standup draft, limitations). The current UI code is `src/App.tsx`, `src/MyDay.tsx` and `src/Cockpit.tsx`, with the design tokens at the top of `src/index.css`.
