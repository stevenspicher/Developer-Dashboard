/**
 * adoBridgeRoutes.js
 *
 * Express router that replaces the CSV export → manual ADO import workflow
 * with direct pushes to the ADO Bridge service.  Each route mirrors the
 * corresponding /export/* route in csv.js so it drops in alongside the
 * existing code with minimal changes to your app.
 *
 *   GET  /push/sprint?sprint_id=...          →  push a sprint's items to ADO
 *   GET  /push/sprint?ids=1,2,3              →  push specific items to ADO
 *   GET  /push/release?release_id=...        →  push a release's items to ADO
 *   GET  /push/backlog                       →  push all export-ready backlog items
 *   POST /push/item/:id                       →  push a single work item
 *   GET  /push/status                        →  bridge health check
 *
 * Wire it into your app exactly like csv.js:
 *   app.use('/ado-bridge', require('./routes/adoBridgeRoutes'));
 *
 * Then /ado-bridge/push/sprint?sprint_id=5 does what
 * /export/sprint?sprint_id=5 used to do — but live, no CSV, no manual import.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const bridge = require('../lib/adoBridgeClient');

// ────────────────────────────────────────────────────────────────────────────
// DB helpers — match the epic column projection used by csv.js so the push
// routes see the exact same data shape as the export routes.
// ────────────────────────────────────────────────────────────────────────────

const EPIC_COLS =
  'e.ado_id as epic_ado_id, e.title as epic_title, e.work_item_type as epic_work_item_type';

/**
 * Fetch items for a sprint (by sprint_id or explicit id list).
 * Mirrors GET /export/sprint's query in csv.js.
 */
function getSprintItems({ sprint_id, ids }) {
  if (sprint_id) {
    return db
      .prepare(
        `SELECT wi.*, s.name as sprint_name, ${EPIC_COLS}
         FROM work_items wi
         LEFT JOIN sprints s ON wi.sprint_id = s.id
         LEFT JOIN epics e ON wi.epic_id = e.id
         WHERE wi.sprint_id = ?
         ORDER BY wi.priority, wi.platform`
      )
      .all(sprint_id);
  }
  if (ids) {
    const idList = ids.split(',').map(Number).filter(Boolean);
    if (!idList.length) return [];
    const placeholders = idList.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT wi.*, s.name as sprint_name, ${EPIC_COLS}
         FROM work_items wi
         LEFT JOIN sprints s ON wi.sprint_id = s.id
         LEFT JOIN epics e ON wi.epic_id = e.id
         WHERE wi.id IN (${placeholders})`
      )
      .all(...idList);
  }
  return [];
}

/**
 * Fetch all export-ready backlog items (mirrors GET /export/backlog).
 */
function getBacklogItems() {
  return db
    .prepare(
      `SELECT wi.*, s.name as sprint_name, ${EPIC_COLS}
       FROM work_items wi
       LEFT JOIN sprints s ON wi.sprint_id = s.id
       LEFT JOIN epics e ON wi.epic_id = e.id
       WHERE wi.export_ready = 1
       ORDER BY wi.priority`
    )
    .all();
}

/**
 * Fetch a single work item by local DB id.
 */
function getItemById(id) {
  return db
    .prepare(
      `SELECT wi.*, s.name as sprint_name, ${EPIC_COLS}
       FROM work_items wi
       LEFT JOIN sprints s ON wi.sprint_id = s.id
       LEFT JOIN epics e ON wi.epic_id = e.id
       WHERE wi.id = ?`
    )
    .get(id);
}

/**
 * Fetch items for a release (the release record itself + its work items).
 * Mirrors GET /export/release's query.
 */
function getReleaseItems(release_id) {
  const release = db.prepare('SELECT * FROM releases WHERE id = ?').get(release_id);
  if (!release) return null;
  const workItems = db
    .prepare(
      `SELECT wi.*, s.name as sprint_name
       FROM work_items wi
       LEFT JOIN sprints s ON wi.sprint_id = s.id
       WHERE wi.release_id = ?
       ORDER BY wi.platform, wi.priority`
    )
    .all(release_id);
  // Build a synthetic work-item row for the Release itself so it goes
  // through the same push path as the stories.
  const releaseItem = {
    id: `release-${release.id}`, // unique externalId
    ado_id: release.ado_id || null,
    work_item_type: 'Release',
    title: release.title,
    description: release.public_release_notes || '',
    assigned_to: '',
    state: release.state || 'Planned',
    tags: '',
    iteration_path: release.sprint_name ? `Blue Digital\\${release.sprint_name}` : '',
  };
  return { release, releaseItem, workItems };
}

// ────────────────────────────────────────────────────────────────────────────
// Core push logic
// ────────────────────────────────────────────────────────────────────────────

/**
 * Push a single local item to the bridge, creating or updating as needed,
 * and sync the returned ADO id back into the local work_items table.
 *
 * @param {object} item - a work_items row
 * @returns {Promise<{adoId:number, action:string, externalId:string}>}
 */
async function pushItem(item) {
  const result = await bridge.syncWorkItem(item);

  // Persist the ADO id back to the local DB so future updates go to the
  // same work item rather than creating a duplicate.
  if (result.adoId && item.id != null) {
    db.prepare('UPDATE work_items SET ado_id = ? WHERE id = ? AND (ado_id IS NULL OR ado_id != ?)').run(
      result.adoId,
      item.id,
      result.adoId
    );
  }

  return { ...result, externalId: `${bridge.SOURCE_SYSTEM}-${item.id}` };
}

/**
 * Push a batch of items, ordering epics/Features first so that child stories
 * can reference them.  Returns a summary plus per-item results.
 *
 * @param {object[]} items - work_items rows
 * @returns {Promise<object>} { pushed, created, updated, failed, results }
 */
async function pushBatch(items) {
  // Order: epics (items that carry epic_title) first, then the rest, so the
  // parent Feature exists in ADO before children are pushed.  This mirrors
  // buildSprintRows() emitting the epicHeaderRow before its children.
  const epicItems = items.filter(i => i.epic_id && i.epic_title);
  const otherItems = items.filter(i => !(i.epic_id && i.epic_title));
  const ordered = [...epicItems, ...otherItems];

  const results = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const item of ordered) {
    try {
      const r = await pushItem(item);
      results.push({ id: item.id, title: item.title, ...r, error: null });
      if (r.action === 'created') created++;
      else updated++;
    } catch (err) {
      failed++;
      results.push({
        id: item.id,
        title: item.title,
        adoId: null,
        action: 'failed',
        error: err.message,
      });
    }
  }

  return {
    pushed: results.length,
    created,
    updated,
    failed,
    results,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /push/sprint?sprint_id=...   — push all items in a sprint
 * GET /push/sprint?ids=1,2,3       — push specific items by local id
 *
 * Mirrors GET /export/sprint in csv.js.
 */
router.get('/push/sprint', async (req, res) => {
  try {
    const items = getSprintItems(req.query);
    if (!items.length) return res.status(404).json({ error: 'No items found' });
    const summary = await pushBatch(items);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /push/backlog — push all export-ready backlog items.
 *
 * Mirrors GET /export/backlog in csv.js.
 */
router.get('/push/backlog', async (req, res) => {
  try {
    const items = getBacklogItems();
    if (!items.length) return res.status(404).json({ error: 'No export-ready items' });
    const summary = await pushBatch(items);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /push/release?release_id=... — push a release record + its work items.
 *
 * Mirrors GET /export/release in csv.js.  The Release record itself is pushed
 * as a work item of type "Release", followed by its child stories.
 */
router.get('/push/release', async (req, res) => {
  try {
    const { release_id } = req.query;
    if (!release_id) return res.status(400).json({ error: 'release_id required' });

    const data = getReleaseItems(release_id);
    if (!data) return res.status(404).json({ error: 'Release not found' });

    const { releaseItem, workItems } = data;
    // Push the Release record first, then its stories.
    const allItems = [releaseItem, ...workItems];
    const summary = await pushBatch(allItems);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /push/item/:id — push a single work item by local DB id.
 *
 * Body (optional):
 *   { "comment": "...", "state": "Active", "assignedTo": "user@example.com" }
 *
 * If a comment/state/assignee is provided, they are applied after the
 * create-or-update sync.
 */
router.post('/push/item/:id', async (req, res) => {
  try {
    const item = getItemById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Work item not found' });

    const syncResult = await pushItem(item);

    // Optional secondary operations from the request body.
    const { comment, state, assignedTo } = req.body || {};
    if (state) await bridge.changeState(syncResult.adoId, state);
    if (assignedTo) await bridge.assignUser(syncResult.adoId, assignedTo);
    if (comment) await bridge.addComment(syncResult.adoId, comment);

    res.json({ ...syncResult, comment: !!comment, state: state || null, assignedTo: assignedTo || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /push/status — proxy the bridge's health check so the UI can show
 * whether the bridge and ADO are reachable without hitting the bridge directly.
 */
router.get('/push/status', async (req, res) => {
  try {
    const health = await bridge.health();
    res.json(health);
  } catch (err) {
    res.status(503).json({ status: 'unreachable', error: err.message });
  }
});

module.exports = router;
