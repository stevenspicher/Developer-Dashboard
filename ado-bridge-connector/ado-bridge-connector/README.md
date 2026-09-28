# ADO Bridge Connector — Integration Guide

Drop-in connector that lets your Story Manager application push work items
directly to Azure DevOps through the ADO Bridge service, replacing the
CSV export → manual import workflow.

---

## What this replaces

Your current flow:

```
Story Manager  →  GET /export/sprint  →  CSV file  →  manual ADO import
```

New flow with the connector:

```
Story Manager  →  GET /push/sprint  →  ADO Bridge  →  Azure DevOps (live)
```

No CSV, no manual import step. The bridge handles ADO authentication, creates
the work items, and maintains the external-ID → ADO-ID mapping. The connector
syncs the returned ADO IDs back into your local `work_items.ado_id` column so
future pushes update the same items instead of creating duplicates.

---

## Files

```
ado-bridge-connector/
├── lib/
│   └── adoBridgeClient.js     # HTTP client + field mapper (framework-agnostic)
├── routes/
│   └── adoBridgeRoutes.js     # Express routes mirroring csv.js export routes
└── README.md                  # this file
```

---

## Installation

### 1. Copy the files into your application

```bash
# From your application root (where csv.js's routes/ and lib/ live):
cp ado-bridge-connector/lib/adoBridgeClient.js    lib/
cp ado-bridge-connector/routes/adoBridgeRoutes.js routes/
```

The connector assumes the same directory structure as `csv.js`:
- `../db` — your SQLite database module
- `../lib/adoBridgeClient` — the client (one directory up from routes)

### 2. Add environment variables to your `.env`

```env
# ADO Bridge service URL (the FastAPI app from the ADO Bridge project)
ADO_BRIDGE_URL=http://localhost:8000

# How the bridge identifies your application in its mapping table
ADO_BRIDGE_SOURCE_SYSTEM=StoryManager
```

### 3. Mount the router in your app

Wherever you register `csv.js` (e.g. `app.js` or `index.js`):

```js
// Existing CSV routes
app.use('/', require('./routes/csv'));

// New ADO Bridge push routes
app.use('/ado-bridge', require('./routes/adoBridgeRoutes'));
```

### 4. Start the ADO Bridge service

In a separate terminal (from the `ado-bridge` project directory):

```bash
pip install -r requirements.txt
# Set your real ADO PAT in .env
uvicorn app.main:app --reload
```

Verify the bridge is up:

```bash
curl http://localhost:8000/health
# {"status":"healthy","ado":"connected","database":"connected"}
```

---

## Endpoints

All routes are mounted under `/ado-bridge`.

### Push a sprint

```
GET /ado-bridge/push/sprint?sprint_id=5
GET /ado-bridge/push/sprint?ids=1,2,3
```

Pushes all items in a sprint (or a specific list of item IDs) to ADO. Epics/
Features are pushed first so child stories can nest under them. Mirrors
`GET /export/sprint`.

**Response:**

```json
{
  "pushed": 12,
  "created": 8,
  "updated": 4,
  "failed": 0,
  "results": [
    { "id": 1, "title": "Enable report exports", "adoId": 15241, "action": "created", "error": null },
    { "id": 2, "title": "Add trend chart", "adoId": 15242, "action": "updated", "error": null }
  ]
}
```

### Push the backlog

```
GET /ado-bridge/push/backlog
```

Pushes all `export_ready` items not yet in a sprint. Mirrors
`GET /export/backlog`.

### Push a release

```
GET /ado-bridge/push/release?release_id=3
```

Pushes the Release record (as a "Release" work item type) followed by its
child stories. Mirrors `GET /export/release`.

### Push a single item

```
POST /ado-bridge/push/item/42
```

Pushes one work item by local DB ID. Optional body applies secondary
operations after the sync:

```json
{
  "comment": "Pushed from Story Manager",
  "state": "Active",
  "assignedTo": "someone@bluefcu.com"
}
```

### Check bridge status

```
GET /ado-bridge/push/status
```

Proxies the bridge's health check so your UI can show whether the bridge and
ADO are reachable.

```json
{ "status": "healthy", "ado": "connected", "database": "connected" }
```

---

## How the field mapping works

The connector translates your local `work_items` row into the bridge's
standard payload contract:

| Local field            | Bridge field                          | Notes                                |
|------------------------|---------------------------------------|--------------------------------------|
| `id`                   | `externalId` (as `SM-{id}`)          | Stable, unique key for mapping       |
| `work_item_type`       | `workItemType`                        | Defaults to "User Story"             |
| `title`                | `title`                               |                                      |
| `description` + `acceptance_criteria` | `description`            | AC folded in as HTML (same as CSV)   |
| `assigned_to`          | `fields.assignedto`                   |                                      |
| `state`                | `fields.state`                        |                                      |
| `priority`             | `fields.priority`                     |                                      |
| `story_points`         | `fields.Microsoft.VSTS.Scheduling.StoryPoints` |                          |
| `tags`                 | `fields.tags`                         |                                      |
| `iteration_path`       | `fields./fields/System.IterationPath` |                                      |

The acceptance-criteria folding uses the exact same `descriptionWithAC()`
logic as `csv.js`, so the bridge produces identical output to the CSV export.

---

## How create-vs-update is decided

The connector doesn't require you to know whether an item already exists in
ADO. For each item it:

1. Calls `GET /external/StoryManager/SM-{id}` on the bridge
2. If the bridge returns a mapping → **update** the existing ADO work item
3. If the bridge returns 404 → **create** a new work item
4. After creating, syncs the returned `adoId` back to `work_items.ado_id`

This means you can push the same sprint repeatedly — new items get created,
existing items get updated, and nothing gets duplicated.

---

## Requirements

- **Node.js 18+** (uses built-in `fetch`)
- **Express** (same as your existing app)
- **ADO Bridge service running** (the FastAPI app from the `ado-bridge` project)
- The bridge's `.env` must have a valid `ADO_PAT` for your Azure DevOps project

No additional npm packages are needed — the connector uses only `express`
(which you already have) and Node's built-in `fetch`.

---

## Quick verification

After wiring it in, test the connection:

```bash
# Check the bridge is reachable from your app
curl http://localhost:8000/ado-bridge/push/status

# Push a single test item
curl -X POST http://localhost:3000/ado-bridge/push/item/1

# Push a whole sprint
curl http://localhost:3000/ado-bridge/push/sprint?sprint_id=5
```

If you see `created` counts go up and `adoId` values in the response, the
full pipeline is working: Story Manager → connector → ADO Bridge → Azure
DevOps → mapping synced back to your local DB.
