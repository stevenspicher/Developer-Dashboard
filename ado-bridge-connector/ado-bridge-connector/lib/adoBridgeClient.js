/**
 * adoBridgeClient.js
 *
 * Thin HTTP client that wraps every ADO Bridge REST endpoint.  Drop this
 * into your application's lib/ or services/ directory — it has no
 * dependencies beyond Node's built-in fetch (Node 18+) and is framework
 * agnostic.
 *
 * The ADO Bridge (FastAPI service) exposes a standardised JSON contract so
 * consuming applications never touch Azure DevOps directly.  This client
 * translates between your application's local work-item shape and that
 * contract, then returns the bridge's responses unchanged.
 *
 * Configuration is read from environment variables so it slots in next to
 * your existing .env without code changes:
 *
 *   ADO_BRIDGE_URL=http://localhost:8000
 *
 * Usage:
 *   const bridge = require('../lib/adoBridgeClient');
 *   const res = await bridge.createWorkItem({ sourceSystem:'StoryManager', ... });
 */

const BRIDGE_URL = process.env.ADO_BRIDGE_URL || 'http://localhost:8000';

// ────────────────────────────────────────────────────────────────────────────
// Source system identifier.  Every work item pushed through the bridge is
// tagged with this so the bridge's mapping table can resolve external IDs
// back to Azure DevOps work-item IDs.  Change it to whatever you want the
// bridge to know your application by.
// ────────────────────────────────────────────────────────────────────────────
const SOURCE_SYSTEM = process.env.ADO_BRIDGE_SOURCE_SYSTEM || 'StoryManager';

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Perform a JSON request against the bridge and return the parsed body.
 * Throws a BridgeError (with .status) for non-2xx responses so callers can
 * map HTTP status codes to user-friendly messages.
 */
async function _request(method, path, body) {
  const url = `${BRIDGE_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let response;
  try {
    response = await fetch(url, opts);
  } catch (err) {
    throw new BridgeError(`Cannot reach ADO Bridge at ${BRIDGE_URL}: ${err.message}`, 503);
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { message: text };
  }

  if (!response.ok) {
    const message = parsed.detail || parsed.message || `HTTP ${response.status}`;
    throw new BridgeError(message, response.status);
  }
  return parsed;
}

/** Error carrying the HTTP status returned by the bridge. */
class BridgeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Field mapper — converts a local work item (the shape csv.js reads from the
// DB) into the bridge's standard payload contract.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Map a local work item record to the bridge's CreateWorkItemRequest contract.
 *
 *   {
 *     sourceSystem, externalId, workItemType, title, description, fields: { ... }
 *   }
 *
 * The bridge's `fields` dict accepts either friendly names (priority, tags,
 * assignedto, state) or full ADO reference paths (/fields/System.Tags).  We
 * use friendly names so the mapping stays readable and the bridge's patch
 * builder handles the translation.
 *
 * @param {object} item   - A row from the work_items table (same shape csv.js uses)
 * @param {object} [opts] - Optional overrides
 * @param {string} [opts.externalIdPrefix] - Prefix for the externalId (default: 'SM-')
 * @returns {object} Bridge-compatible request body
 */
function toBridgePayload(item, opts = {}) {
  const prefix = opts.externalIdPrefix || 'SM-';

  // externalId must be unique & stable.  Prefer the local DB id (always
  // present) so the same item always maps to the same bridge entry.
  const externalId = `${prefix}${item.id}`;

  const fields = {};

  // ADO field mapping — only include fields that actually have values so we
  // don't overwrite existing ADO data with blanks on update.
  if (item.assigned_to) fields.assignedto = item.assigned_to;
  if (item.state) fields.state = item.state;
  if (item.priority != null) fields.priority = item.priority;
  if (item.story_points != null) fields['Microsoft.VSTS.Scheduling.StoryPoints'] = item.story_points;
  if (item.tags) fields.tags = item.tags;
  if (item.iteration_path) fields['/fields/System.IterationPath'] = item.iteration_path;

  // Build description: fold acceptance criteria into description as an HTML
  // section, exactly as the CSV release format does — the bridge / ADO has no
  // separate Acceptance Criteria field.
  let description = item.description || '';
  if (item.acceptance_criteria) {
    description = descriptionWithAC(item);
  }

  return {
    sourceSystem: SOURCE_SYSTEM,
    externalId,
    workItemType: item.work_item_type || 'User Story',
    title: item.title,
    description: description || undefined,
    fields,
  };
}

/**
 * Fold acceptance criteria into the description as an HTML section, mirroring
 * the logic in csv.js's descriptionWithAC() so the bridge produces identical
 * output to the CSV export.
 */
function descriptionWithAC(item) {
  const desc = item.description || '';
  if (!item.acceptance_criteria) return desc;
  const lines = item.acceptance_criteria.split('\n').map(l => l.trim()).filter(Boolean);
  const isBulleted = lines.every(l => /^[-•]/.test(l));
  const acHtml = isBulleted
    ? '<ul>' + lines.map(l => `<li>${l.replace(/^[-•]\s*/, '')}</li>`).join('') + '</ul>'
    : lines.map(l => `<p>${l}</p>`).join('');
  return desc + '<h4>Acceptance Criteria</h4>' + acHtml;
}

// ────────────────────────────────────────────────────────────────────────────
// Bridge API methods
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a work item in Azure DevOps via the bridge.
 * @param {object} payload - Bridge CreateWorkItemRequest (use toBridgePayload())
 * @returns {Promise<{adoId:number, status:string}>}
 */
async function createWorkItem(payload) {
  return _request('POST', '/workitems', payload);
}

/**
 * Retrieve a work item from Azure DevOps by its ADO ID.
 * @param {number} adoId
 * @returns {Promise<object>} WorkItemResponse { adoId, title, state, workItemType, assignedTo }
 */
async function getWorkItem(adoId) {
  return _request('GET', `/workitems/${adoId}`);
}

/**
 * Update a work item's title, description, or additional fields.
 * @param {number} adoId
 * @param {object} payload - { title?, description?, fields: {} }
 * @returns {Promise<{adoId:number, status:string}>}
 */
async function updateWorkItem(adoId, payload) {
  return _request('PUT', `/workitems/${adoId}`, payload);
}

/**
 * Add a comment to a work item.
 * @param {number} adoId
 * @param {string} comment
 * @returns {Promise<{adoId:number, status:string}>}
 */
async function addComment(adoId, comment) {
  return _request('POST', `/workitems/${adoId}/comments`, { comment });
}

/**
 * Change the state of a work item.
 * @param {number} adoId
 * @param {string} state
 * @returns {Promise<{adoId:number, state:string, status:string}>}
 */
async function changeState(adoId, state) {
  return _request('PUT', `/workitems/${adoId}/state`, { state });
}

/**
 * Assign a work item to a user by email.
 * @param {number} adoId
 * @param {string} assignedTo - email address
 * @returns {Promise<{adoId:number, assignedTo:string, status:string}>}
 */
async function assignUser(adoId, assignedTo) {
  return _request('PUT', `/workitems/${adoId}/assignee`, { assignedTo });
}

/**
 * Look up an ADO work item ID by source system + external ID.
 * @param {string} sourceSystem - defaults to this client's SOURCE_SYSTEM
 * @param {string} externalId
 * @returns {Promise<{adoId:number, sourceSystem:string, externalId:string, workItemType:string}>}
 */
async function lookupExternal(sourceSystem, externalId) {
  const ss = encodeURIComponent(sourceSystem || SOURCE_SYSTEM);
  const eid = encodeURIComponent(externalId);
  return _request('GET', `/external/${ss}/${eid}`);
}

/**
 * Retrieve the available work item types for the configured ADO project.
 * @returns {Promise<{workItemTypes:Array<{name:string, description:string}>}>}
 */
async function getWorkItemTypes() {
  return _request('GET', '/metadata/workitemtypes');
}

/**
 * Check the health of the bridge service.
 * @returns {Promise<{status:string, ado:string, database:string}>}
 */
async function health() {
  return _request('GET', '/health');
}

// ────────────────────────────────────────────────────────────────────────────
// High-level sync helpers — create-or-update logic so routes don't have to
// figure out whether an item already exists in ADO.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Push a single local work item to ADO, creating it if new or updating if it
 * already exists (decided by an external-ID lookup against the bridge).
 *
 * @param {object} item - local work_items row
 * @returns {Promise<{adoId:number, action:'created'|'updated'}>}
 */
async function syncWorkItem(item) {
  const payload = toBridgePayload(item);

  // First, check if the bridge already has a mapping for this external ID.
  let existing;
  try {
    existing = await lookupExternal(payload.sourceSystem, payload.externalId);
  } catch (err) {
    // 404 means "no mapping yet" — we'll create.  Any other error propagates.
    if (err.status !== 404) throw err;
  }

  if (existing) {
    // Already in ADO — send an update with just the fields that changed.
    const updatePayload = {
      title: payload.title,
      description: payload.description,
      fields: payload.fields,
    };
    await updateWorkItem(existing.adoId, updatePayload);
    return { adoId: existing.adoId, action: 'updated' };
  }

  const created = await createWorkItem(payload);
  return { adoId: created.adoId, action: 'created' };
}

module.exports = {
  SOURCE_SYSTEM,
  toBridgePayload,
  descriptionWithAC,
  createWorkItem,
  getWorkItem,
  updateWorkItem,
  addComment,
  changeState,
  assignUser,
  lookupExternal,
  getWorkItemTypes,
  health,
  syncWorkItem,
  BridgeError,
};
