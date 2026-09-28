# Connecting an Application to notion-bridge

## Purpose

This document instructs an LLM (or developer) on how to connect an existing application to the **notion-bridge** service. notion-bridge is a caching, authorizing proxy over Notion. It exposes a REST API that lets a developer dashboard pull task queues, resolve related context, and claim items — all without the application talking to Notion directly.

Read this document top to bottom before writing any code. The sections are ordered: understand the model → know the endpoints → implement the integration → handle edge cases.

---

## 1. Mental Model

Before connecting, understand what notion-bridge is and is not.

**notion-bridge is:**
- A stateless HTTP service sitting between your application and Notion.
- The single component that talks to Notion. Your application does **not** call the Notion API directly.
- A read-through cache with short TTLs, so repeated reads are fast.
- The sole owner of Notion **writes** (claiming an item updates Notion properties so Notion stays the source of truth).

**notion-bridge is not:**
- An authentication system. Your application authenticates its own users. The bridge trusts the identifier your application passes.
- A database. It does not persist data. Notion is the source of truth.
- A generic Notion API passthrough. It exposes a curated set of endpoints shaped for the developer-dashboard workflow.

**The core workflow:**
1. Your application loads **queues** — lists of claimable items assigned to (or unassigned for) a developer.
2. The developer selects an item and **claims** it. The bridge writes the claim back to Notion and returns the item's **related context bundle** (parent initiative/issue/project with its properties and content).
3. Your application renders the item + related context on the dashboard.

---

## 2. Prerequisites

Before integrating, confirm the following:

1. **notion-bridge is running.** It listens on a configurable port (default `3100`). Verify with:
   ```
   GET http://<bridge-host>:3100/health
   ```
   A healthy response includes `bridge: "ok"`, `notion.connected: true`, and a `queues` map showing each queue's resolved `sourceId`. If `notion.connected` is false, the bridge's `NOTION_TOKEN` is missing or invalid — that is a bridge-side config issue, not an application issue.

2. **You know the bridge host and port.** All examples below use `http://localhost:3100`. Substitute your actual bridge URL.

3. **Your application already authenticates users.** The bridge does not authenticate. It expects your application to pass a **developer identifier** with each request. This is typically a stable user id, email, or username that the bridge can resolve to a Notion person (see §4).

4. **You know which queue slugs are configured.** The bridge's manifest defines queues by slug (e.g., `work-items`, `issues`, `epics`). Ask the bridge operator for the list, or inspect the `/health` response's `queues` keys. Your application references queues by slug.

---

## 3. Authentication & Developer Identity

### How the bridge identifies the developer

Every queue and claim request must identify the developer. Pass the developer identifier in one of two ways:

- **Query parameter:** `?developer=<identifier>`
- **HTTP header:** `X-Developer: <identifier>`

The bridge uses this identifier to:
- Filter queues to items assigned to (or unassigned for) that developer.
- Write the developer's Notion user id into the assignee property on claim.

### How the identifier is resolved

The bridge resolves the developer identifier to a Notion user id using its manifest `identity` config:
1. **Explicit overrides** — a manual mapping of `developerId → notionUserId` in the manifest. These take precedence.
2. **Notion user list match** — if no override matches, the bridge looks up the identifier against Notion's user list using the manifest's `matchBy` field (`email`, `id`, or `name`).

**Important:** Your application must pass the *same* identifier value the bridge expects. If the manifest uses `matchBy: "email"`, pass the developer's email. If overrides are configured, pass the override's `developerId` value. Coordinate with the bridge operator on which identifier to use.

### Security note

The bridge trusts whatever developer identifier your application passes. It does not verify that the identifier belongs to the authenticated user. Your application is responsible for ensuring the identifier is legitimate — do not accept it from client-side input without server-side validation.

---

## 4. API Reference

All responses are JSON. Errors return `{ "error": "<message>" }` with an appropriate HTTP status. All `GET` queue/item endpoints are cached (short TTL); `POST /claim` invalidates the relevant cache.

### 4.1 Health Check

```
GET /health
```

No developer parameter required. Returns the bridge's status, Notion connectivity, cache stats, and per-queue source resolution.

**Response:**
```json
{
  "bridge": "ok",
  "time": "2026-09-25T20:51:00.000Z",
  "config": { "port": 3100, "notionRps": 2.5, "cacheTtlSeconds": 30 },
  "cache": { "hits": 142, "misses": 18, "invalidations": 4, "entries": 7 },
  "notion": { "connected": true, "user": "Story Manager" },
  "queues": {
    "work-items": { "sourceId": "abc123..." },
    "issues": { "sourceId": "def456..." }
  }
}
```

**Use this at application startup** to confirm the bridge is reachable and Notion is connected before showing the dashboard.

---

### 4.2 Get All Queues

```
GET /queues?developer=<identifier>
```

Returns every configured queue's claimable items for the developer, grouped by queue slug. This is the dashboard's home view — load it once on page open.

**Response:**
```json
{
  "developer": "jdoe",
  "notionUserId": "a1b2c3d4-...",
  "queues": {
    "work-items": [
      {
        "id": "page-uuid-1",
        "url": "https://www.notion.so/...",
        "title": "Implement login flow",
        "properties": [
          { "name": "State", "type": "status", "value": "New" },
          { "name": "Priority", "type": "number", "value": "1" }
        ],
        "display": [
          { "name": "Work Item Type", "value": "User Story" },
          { "name": "Platform", "value": "Web - Chrome" }
        ],
        "last_edited": "2026-09-24T10:00:00.000Z"
      }
    ],
    "issues": [
      { "id": "page-uuid-2", "url": "...", "title": "...", "properties": [...], "display": [...], "last_edited": "..." }
    ]
  }
}
```

**Filtering rules applied by the bridge:**
- If the queue has an `assigneeProperty`: items assigned to this developer **or** unassigned items are included. Items assigned to other developers are excluded.
- If the queue has `claimableStates`: only items whose status matches one of those states are included.

**Error cases:**
- `400` — developer identifier missing.
- `404` — developer could not be resolved to a Notion user.
- `500` — internal error (check the `error` message).

**Note:** If a single queue fails (e.g., its data source is unreachable), that queue's value will be `{ "error": "<message>" }` rather than an array. Other queues are still returned. Your application should handle this gracefully — render the failed queue with an error state, not a blank list.

---

### 4.3 Get a Single Queue

```
GET /queues/:slug?developer=<identifier>
```

Returns one queue's claimable items. Use this to refresh a single list without re-fetching all queues.

**Response:**
```json
{
  "queue": "work-items",
  "developer": "jdoe",
  "items": [
    { "id": "...", "url": "...", "title": "...", "properties": [...], "display": [...], "last_edited": "..." }
  ]
}
```

**Error cases:** same as §4.2, plus `500` if the queue slug is unknown (the error message will say `Unknown queue`).

---

### 4.4 Get a Single Item

```
GET /items/:id?content=true
```

Returns a single item's normalized view. By default, content (page body text) is excluded for speed; pass `?content=true` to include it.

**Response (without content):**
```json
{
  "id": "page-uuid-1",
  "url": "https://www.notion.so/...",
  "title": "Implement login flow",
  "properties": [ { "name": "State", "type": "status", "value": "New" }, ... ],
  "display": [ { "name": "Work Item Type", "value": "User Story" }, ... ],
  "last_edited": "2026-09-24T10:00:00.000Z"
}
```

**Response (with `?content=true`):** same shape plus a `content` field containing the page body as markdown-ish plain text (newline-separated).

---

### 4.5 Get Related Context Bundle

```
GET /items/:id/related?queue=<slug>
```

Returns the item plus its **related context** — the parent initiative/issue/project entities resolved by following the item's relation properties (as configured in the manifest for that queue). This is what the dashboard renders when a developer selects an item to view its full context.

The `queue` parameter is **required** — it tells the bridge which relation properties to follow (different queues have different relation configs).

**Response:**
```json
{
  "item": {
    "id": "page-uuid-1",
    "url": "...",
    "title": "Implement login flow",
    "properties": [...],
    "display": [...],
    "content": "## Description\n\nThe login flow should...",
    "last_edited": "..."
  },
  "related": [
    {
      "relation": "initiative",
      "queue": "epics",
      "id": "epic-page-uuid",
      "url": "https://www.notion.so/...",
      "title": "Authentication Overhaul",
      "properties": [
        { "name": "Work Item Type", "type": "select", "value": "Epic" },
        { "name": "State", "type": "status", "value": "Active" }
      ],
      "content": "# Authentication Overhaul\n\nThis initiative covers...",
      "sub_pages": [
        { "id": "sub-page-uuid", "title": "Design Spec" }
      ]
    }
  ]
}
```

**Related entity shapes:**
- A successfully resolved relation: has `id`, `title`, `properties`, `content`, `sub_pages`.
- A relation that is set but the target page is inaccessible: has `id` and `error` (e.g., the page wasn't shared with the integration). Render as "unavailable."
- A relation that is not set (empty): has `id: null` and `empty: true`. Render as "unlinked."

**Error cases:**
- `400` — `queue` parameter missing.
- `500` — item not found or internal error.

---

### 4.6 Claim an Item

```
POST /items/:id/claim
Content-Type: application/json

{
  "queue": "work-items",
  "includeRelated": true
}
```

Plus the developer identifier via `?developer=<identifier>` or `X-Developer` header.

This is the **only write operation**. The bridge:
1. Reads the item fresh (bypassing cache).
2. Checks it is still claimable (assigned to this developer or unassigned; status in a claimable state).
3. Writes the assignee (developer's Notion user id) and status (the queue's `claimedState`) back to Notion.
4. Invalidates the queue's cache.
5. Returns the updated item plus the related bundle (unless `includeRelated: false`).

**Request body:**
| Field | Required | Description |
|---|---|---|
| `queue` | recommended | The queue slug. Enables assignee/status writes and relation resolution. Without it, the claim skips property writes. |
| `includeRelated` | optional | Default `true`. Set `false` to skip the related bundle (faster, use if you'll fetch it separately). |

**Success response (`201`):**
```json
{
  "item": {
    "id": "page-uuid-1",
    "url": "...",
    "title": "Implement login flow",
    "properties": [ { "name": "State", "type": "status", "value": "Active" }, ... ],
    "display": [...],
    "last_edited": "..."
  },
  "related": [
    { "relation": "initiative", "queue": "epics", "id": "...", "title": "...", "properties": [...], "content": "...", "sub_pages": [...] }
  ]
}
```

**Error responses:**
| Status | Meaning | Body |
|---|---|---|
| `400` | Developer not resolvable to a Notion user | `{ "error": "Could not resolve developer..." }` |
| `404` | Item not found in Notion | `{ "error": "<Notion API message>" }` |
| `409` | Already claimed by another developer, or not in a claimable state | `{ "error": "Item already claimed", "assignees": ["..."] }` or `{ "error": "Item not in a claimable state (current: \"Closed\")" }` |
| `502` | Notion write failed | `{ "error": "Failed to write claim to Notion: ..." }` |

**Concurrency:** The bridge serializes concurrent claims on the same item id using an in-memory lock. If two developers claim the same item simultaneously, the first succeeds and the second gets `409`. Handle `409` by refreshing the queue list and showing the item as unavailable.

**Idempotency:** If the same developer claims an item they already claimed, the bridge treats it as a no-op success (`201`) — it re-asserts the assignee and status without error.

---

### 4.7 Generic Page Read (Escape Hatch)

```
GET /pages/:id
GET /pages/:id/full
```

Reads an arbitrary Notion page by id, outside the queue workflow. Useful for rendering linked documentation or non-queue pages.

- `GET /pages/:id` — properties + content + sub-pages list.
- `GET /pages/:id/full` — the page plus all sub-pages' content merged into `sub_pages` (each with its own `content`).

No developer parameter required. Cached by page id.

---

### 4.8 Generic Database Query (Escape Hatch)

```
GET /databases/:slug/query?status=<value>
```

Returns all rows of a queue's database **without** assignee/status filtering. Use this for custom views (e.g., "all high-priority items regardless of assignee").

- `:slug` — the queue slug (must be configured in the manifest).
- `?status=<value>` — optional in-memory status filter.

**Response:**
```json
{
  "queue": "work-items",
  "count": 47,
  "items": [ { "id": "...", "title": "...", "properties": [...], "display": [...], "last_edited": "..." } ]
}
```

---

## 5. Implementation Guide

Follow these steps to connect an existing application. Each step includes what to do and what to watch for.

### Step 1: Configuration

Add the bridge URL to your application's configuration. Do not hardcode it.

```
# Example environment variable
NOTION_BRIDGE_URL=http://localhost:3100
```

Create a single HTTP client or service module that all bridge calls go through. Centralize:
- The base URL.
- The developer identifier injection (query param or header).
- Error handling and logging.

### Step 2: Startup Health Check

On application startup (or when the dashboard loads), call `GET /health`. If the response has `notion.connected: false` or any queue has an `error`, show a warning banner. Do not block the entire UI — the bridge may still serve other queues.

```javascript
// Example (Node.js / fetch)
async function checkBridgeHealth(bridgeUrl) {
  const res = await fetch(`${bridgeUrl}/health`);
  if (!res.ok) throw new Error(`Bridge health check failed: ${res.status}`);
  const health = await res.json();
  if (!health.notion?.connected) {
    console.warn('Notion is not connected via the bridge');
  }
  return health;
}
```

### Step 3: Load Queues

When the dashboard loads, call `GET /queues?developer=<id>` to get all claimable lists at once. Render each queue as a list. Use the `display` array for the list item summary (it contains the manifest's `displayProperties` in order), and `title` as the primary label.

```javascript
async function loadQueues(bridgeUrl, developer) {
  const res = await fetch(`${bridgeUrl}/queues?developer=${encodeURIComponent(developer)}`);
  if (res.status === 404) {
    // Developer not resolved — this is a config issue, surface it clearly
    const body = await res.json();
    throw new Error(`Developer "${developer}" not recognized by the bridge: ${body.error}`);
  }
  if (!res.ok) throw new Error(`Failed to load queues: ${res.status}`);
  const data = await res.json();
  return data.queues;
}
```

**Handle per-queue errors:** If a queue's value is `{ "error": "..." }` instead of an array, render that queue with an error state and continue showing the others.

**Refresh strategy:** Poll `GET /queues/:slug?developer=<id>` for individual queues on a timer (e.g., every 30–60s) or on user action. Do not poll all queues rapidly — the bridge caches, but respect the rate limit. A manual "refresh" button is a good UX pattern.

### Step 4: Claim an Item

When the developer clicks "claim" on an item, call `POST /items/:id/claim`. Pass the `queue` slug in the body so the bridge knows which assignee/status properties to write.

```javascript
async function claimItem(bridgeUrl, developer, itemId, queueSlug) {
  const res = await fetch(`${bridgeUrl}/items/${itemId}/claim?developer=${encodeURIComponent(developer)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue: queueSlug, includeRelated: true }),
  });

  if (res.status === 201) {
    const data = await res.json();
    // data.item — the updated item
    // data.related — the related context bundle
    return data;
  }

  if (res.status === 409) {
    const body = await res.json();
    // Item was claimed by someone else or is not in a claimable state.
    // Refresh the queue and show the item as unavailable.
    throw new ClaimConflictError(body.error, body.assignees);
  }

  if (res.status === 400) {
    const body = await res.json();
    throw new Error(`Cannot claim: ${body.error}`);
  }

  throw new Error(`Claim failed: ${res.status}`);
}
```

**After a successful claim:**
1. Remove the item from the queue list (or move it to a "claimed" section).
2. Use the returned `related` array to render the context panel — show the parent initiative/issue/project's title, properties, content, and sub-pages.

**After a `409`:**
1. Refresh the affected queue (`GET /queues/:slug?developer=<id>`).
2. Show the user that the item is no longer available.

### Step 5: Render Related Context

The claim response (or `GET /items/:id/related?queue=<slug>`) returns a `related` array. Each entry is a resolved entity (initiative, issue, project, etc.) linked via a relation property.

Render each related entity as a panel:
- **Title** — `related[i].title`
- **Properties** — `related[i].properties` (array of `{ name, type, value }`)
- **Content** — `related[i].content` (markdown-ish plain text; render as preformatted or run through a markdown parser)
- **Sub-pages** — `related[i].sub_pages` (array of `{ id, title }`); make each clickable to load via `GET /pages/:id`

Handle the three related-entity states:
- **Resolved** — has `title`, `properties`, `content`, `sub_pages`. Render normally.
- **Inaccessible** — has `error` but no `title`. Show "This item's parent could not be loaded."
- **Unlinked** — has `empty: true` and `id: null`. Show "No parent linked to this item."

### Step 6: Optional — Generic Page Reads

If your dashboard needs to render arbitrary Notion pages (e.g., a sub-page the user clicks into), use `GET /pages/:id` or `GET /pages/:id/full`. These work with any page id shared with the integration, no queue or developer context needed.

---

## 6. Data Shapes Reference

### Normalized Item

Returned by queue lists, single item, and claim responses.

```json
{
  "id": "uuid",
  "url": "https://www.notion.so/...",
  "title": "string",
  "properties": [
    { "name": "State", "type": "status", "value": "New" },
    { "name": "Priority", "type": "number", "value": "1" },
    { "name": "Assigned To", "type": "people", "value": "Jane Doe" }
  ],
  "display": [
    { "name": "Work Item Type", "value": "User Story" },
    { "name": "Platform", "value": "Web - Chrome" }
  ],
  "content": "optional — only when requested",
  "last_edited": "2026-09-24T10:00:00.000Z"
}
```

- `properties` — all non-title properties, in Notion's property order. Each has a `type` (e.g., `status`, `select`, `number`, `people`, `date`, `relation`, `formula`, `rollup`, etc.) and a `value` (plain-text rendering).
- `display` — a subset of properties listed in the manifest's `displayProperties`, for quick list rendering. Use this for list items; use `properties` for detail views.
- `content` — present only when explicitly requested (`?content=true` or via the related bundle). Markdown-ish plain text, newline-separated.

### Related Entity

An element of the `related` array in the context bundle.

```json
{
  "relation": "initiative",
  "queue": "epics",
  "id": "uuid",
  "url": "https://www.notion.so/...",
  "title": "Authentication Overhaul",
  "properties": [ { "name": "State", "type": "status", "value": "Active" } ],
  "content": "# Authentication Overhaul\n\n...",
  "sub_pages": [ { "id": "uuid", "title": "Design Spec" } ]
}
```

Error/empty variants:
```json
{ "relation": "initiative", "queue": "epics", "id": "uuid", "error": "Could not retrieve page: ..." }
```
```json
{ "relation": "initiative", "queue": "epics", "id": null, "empty": true }
```

---

## 7. Error Handling Summary

| Scenario | HTTP Status | What to do |
|---|---|---|
| Developer not recognized by bridge | `404` | Surface a config error — the developer identifier doesn't match any Notion user or override |
| Item already claimed | `409` | Refresh the queue; show item as unavailable |
| Item not in a claimable state | `409` | Refresh the queue; the item's status changed since the list was loaded |
| Item not found in Notion | `404` | Remove the item from the list; it may have been deleted or archived |
| Notion write failed on claim | `502` | Retry once; if it persists, show a transient error and let the user retry |
| Single queue fails in `/queues` | `200` (queue value is `{ error }`) | Render that queue with an error state; show the rest |
| Bridge unreachable | network error | Show "bridge offline" state; retry on a timer |

**General principles:**
- Never crash the dashboard on a bridge error. Degrade gracefully — show error states per queue or per item.
- The bridge caches responses with a short TTL. If data seems stale, it will refresh within the TTL window. For immediate freshness after a claim, the bridge invalidates the relevant cache automatically.
- Retry transient failures (network errors, `502`) once or twice with a short delay. Do not retry `409` — it is a deliberate conflict, not a transient failure.

---

## 8. Integration Checklist

Use this checklist to verify your integration is complete:

- [ ] Bridge URL is configurable (not hardcoded).
- [ ] All bridge calls go through a single client/service module.
- [ ] Developer identifier is passed on every queue and claim request.
- [ ] Developer identifier is validated server-side (not accepted from untrusted client input).
- [ ] Startup health check is implemented and degrades gracefully.
- [ ] Queue lists render `title` and `display` fields.
- [ ] Per-queue errors (queue value is `{ error }`) are handled without crashing.
- [ ] Claim handles `201` (success), `409` (conflict), `400` (developer not resolved), and `502` (write failure).
- [ ] After a successful claim, the item is removed/moved in the UI and the related context is rendered.
- [ ] Related entities handle all three states: resolved, inaccessible (`error`), unlinked (`empty: true`).
- [ ] `409` conflict triggers a queue refresh.
- [ ] Sub-pages in related entities are clickable and load via `GET /pages/:id`.
- [ ] Transient errors retry once; `409` does not retry.
- [ ] No direct Notion API calls exist in the application — all Notion access goes through the bridge.

---

## 9. Common Mistakes to Avoid

1. **Calling the Notion API directly.** The bridge exists to centralize Notion access (rate limiting, caching, writes). If your application calls `api.notion.com` directly, you bypass all of that. Route everything through the bridge.

2. **Passing the developer identifier from client-side input without validation.** The bridge trusts it. If your frontend sends `?developer=admin` and your backend doesn't verify that the authenticated user is actually "admin," any user can claim items as anyone.

3. **Ignoring the `queue` parameter on claim.** Without `queue`, the bridge doesn't know which assignee/status properties to write. The claim will "succeed" but won't actually update Notion. Always pass the queue slug.

4. **Treating `409` as a transient error and retrying.** A `409` means the item is genuinely unavailable (claimed by someone else or wrong status). Retrying will just produce another `409`. Refresh the list instead.

5. **Assuming `related` is always populated.** A relation can be empty (`empty: true`), inaccessible (`error`), or point to multiple entities. Handle all cases.

6. **Polling all queues rapidly.** The bridge caches, but aggressive polling still generates Notion API calls on cache misses. Use a reasonable interval (30–60s) or manual refresh.

7. **Forgetting to URL-encode the developer identifier.** If the identifier is an email (e.g., `jane.doe@example.com`), the `@` and `.` are technically safe but other characters may not be. Always `encodeURIComponent` it.
