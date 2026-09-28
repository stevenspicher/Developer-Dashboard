// ═══════════════════════════════════════════════
// WORK ITEMS MODULE
// ═══════════════════════════════════════════════

let allWorkItems = [];
let allEpics = [];
let allSprints = [];
let editingWiId = null;

async function loadWorkItems() {
  const params = new URLSearchParams();
  const search = document.getElementById('wi-search')?.value?.trim();
  const type = document.getElementById('wi-filter-type')?.value;
  const platform = document.getElementById('wi-filter-platform')?.value;
  const state = document.getElementById('wi-filter-state')?.value;
  const backlog = document.getElementById('wi-filter-backlog')?.value;
  const source = document.getElementById('wi-filter-source')?.value;
  if (search) params.set('search', search);
  if (type) params.set('work_item_type', type);
  if (platform) params.set('platform', platform);
  if (state) params.set('state', state);
  // One dropdown, two server-side filters: the three original options are
  // `backlog_status` values, the per-sprint options added by populateBacklogFilter()
  // carry a `sprint:<id>` value and filter on `sprint_id` instead.
  if (backlog?.startsWith('sprint:')) params.set('sprint_id', backlog.slice(7));
  else if (backlog) params.set('backlog_status', backlog);
  if (source) params.set('source', source);
  const epic = document.getElementById('wi-filter-epic')?.value;
  if (epic) params.set('epic_id', epic);
  allWorkItems = await API.get('/work-items?' + params.toString());
  renderWorkItemTable();
  renderWiStats();
  await loadFeaturesPanel();
  loadNotionPendingImports();
}

// ── FEATURES PANEL (Backlog page)
// Features are the `epics` table surfaced where the stories are, so a feature can be
// created and its sprint lock flipped without a trip to Settings. Re-fetched rather than
// reusing allEpics because the counts and sprint span it shows come from the server.
async function loadFeaturesPanel() {
  allEpics = await API.get('/epics');
  populateEpicSelect('wi-epic', null);
  populateFeatureFilter();
  populateBulkEpicSelect();
  renderFeaturesPanel();
}

// Collapsed/expanded state persists across reloads (a long feature list is exactly what
// prompted this) but is otherwise plain show/hide — no animation, matching how every
// other collapse-like control in this app (modals, tab panels) behaves.
const FEATURES_COLLAPSE_KEY = 'sm-features-collapsed';
function isFeaturesPanelCollapsed() {
  return localStorage.getItem(FEATURES_COLLAPSE_KEY) === '1';
}
function applyFeaturesPanelCollapsedState() {
  const collapsed = isFeaturesPanelCollapsed();
  const list = document.getElementById('features-list');
  const chevron = document.getElementById('features-chevron');
  if (list) list.style.display = collapsed ? 'none' : '';
  if (chevron) chevron.textContent = collapsed ? '▸' : '▾';
}
function toggleFeaturesPanel() {
  localStorage.setItem(FEATURES_COLLAPSE_KEY, isFeaturesPanelCollapsed() ? '0' : '1');
  applyFeaturesPanelCollapsedState();
}

// The panel is a working list, not an archive: a feature earns a card only while it
// still has a story in the backlog or in a sprint that hasn't ended yet
// (`active_story_count`, computed in routes/epics.js). Features whose work is entirely
// behind the team drop off. The Parent filter dropdown deliberately still lists
// *everything* — hiding a card shouldn't cost you the ability to pull up finished work.
function activeFeatures() {
  return allEpics.filter(e => e.active_story_count > 0);
}

function renderFeaturesPanel() {
  const section = document.getElementById('features-section');
  const list = document.getElementById('features-list');
  const count = document.getElementById('features-count');
  if (!section || !list) return;
  const features = activeFeatures();
  if (!features.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  if (count) count.textContent = features.length;

  list.innerHTML = features.map(e => {
    const locked = !!e.position_lock;
    const span = e.scheduled_count
      ? (e.first_sprint_name === e.last_sprint_name
          ? escHtml(e.first_sprint_name)
          : `${escHtml(e.first_sprint_name)} → ${escHtml(e.last_sprint_name)}`)
      : 'Not scheduled';
    return `<div class="feature-card ${locked ? 'locked' : ''}" style="border-left-color:${featureColor(e.id)}">
      <div class="feature-card-main" onclick="filterByFeature(${e.id})" title="Filter the backlog to this feature">
        <div class="feature-card-title">${featureDot(e.id, 9)} ${escHtml(e.title)}</div>
        <div class="feature-card-meta">${e.story_count} ${e.story_count === 1 ? 'story' : 'stories'} · ${span}</div>
      </div>
      <button class="feature-lock-btn ${locked ? 'on' : ''}" onclick="toggleFeatureLock(${e.id})"
        title="${locked ? 'Sprint positions locked — click to unlock and rearrange' : 'Sprint positions unlocked — click to lock the current spacing'}">${locked ? '🔒' : '🔓'}</button>
      <button class="btn-icon" onclick="openEditEpic(${e.id})" title="Edit feature">✏️</button>
    </div>`;
  }).join('');
  applyFeaturesPanelCollapsedState();
}

function filterByFeature(id) {
  const sel = document.getElementById('wi-filter-epic');
  if (!sel) return;
  // Clicking the same feature twice clears the filter — it's the only way back out
  // without hunting for the dropdown.
  sel.value = String(sel.value) === String(id) ? '' : String(id);
  loadWorkItems();
}

async function toggleFeatureLock(id) {
  const feature = allEpics.find(e => e.id === id);
  if (!feature) return;
  try {
    const result = await API.patch(`/epics/${id}/lock`, { locked: !feature.position_lock });
    feature.position_lock = result.position_lock;
    renderFeaturesPanel();
    toast(result.position_lock
      ? `🔒 "${feature.title}" locked at its current sprint spacing`
      : `🔓 "${feature.title}" unlocked — stories move independently`, 'success');
    await refreshPlanningBoard();
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// The backlog-status dropdown doubles as a sprint picker: below the three
// backlog_status options sits one option per sprint *currently shown on the Planning
// Board*, so "the sprints I'm planning against" means the same thing on both pages.
// getVisibleSprints() lives in planning.js — declared later in load order, but only ever
// called from here at runtime, so hoisting covers it. It reads allSprints, which
// loadAllSharedData() fills before the first loadWorkItems().
function populateBacklogFilter() {
  const sel = document.getElementById('wi-filter-backlog');
  if (!sel) return;
  const current = sel.value;
  const sprints = typeof getVisibleSprints === 'function' ? getVisibleSprints() : [];
  sel.innerHTML =
      '<option value="">Backlog + Sprint</option>' +
      '<option value="backlog">Backlog Only</option>' +
      '<option value="sprint">In Sprint</option>' +
      (sprints.length
        ? '<optgroup label="Planning Board sprints">' +
            sprints.map(s => `<option value="sprint:${s.id}">${escHtml(s.name)}</option>`).join('') +
          '</optgroup>'
        : '');
  // A sprint that scrolled out of the board's window takes its option with it — fall
  // back to the unfiltered view rather than leaving a value the <select> can't show.
  sel.value = current;
  if (sel.selectedIndex === -1) sel.value = '';
}

function populateFeatureFilter() {
  const sel = document.getElementById('wi-filter-epic');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All Features</option>' +
      allEpics.map(e => `<option value="${e.id}">${e.position_lock ? '🔒 ' : ''}${escHtml(e.title)}</option>`).join('');
  sel.value = current;
}

function populateBulkEpicSelect() {
  const sel = document.getElementById('bulk-epic-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">Remove from parent</option>' +
      allEpics.map(e => `<option value="${e.id}">${escHtml(e.title)}</option>`).join('');
}

async function bulkAssignFeature() {
  const ids = getSelectedIds();
  const epic_id = document.getElementById('bulk-epic-select')?.value;
  if (!ids.length) return;
  try {
    await API.post('/work-items/bulk/assign-epic', { ids, epic_id: epic_id ? Number(epic_id) : null });
    toast(`${ids.length} item${ids.length === 1 ? '' : 's'} ${epic_id ? 'assigned to parent' : 'removed from parent'}`, 'success');
    await loadWorkItems();
    await refreshPlanningBoard();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function bulkDeleteWorkItems() {
  const ids = getSelectedIds();
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} selected item${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
  try {
    await API.post('/work-items/bulk/delete', { ids });
    toast(`${ids.length} item${ids.length === 1 ? '' : 's'} deleted`, 'success');
    await loadWorkItems();
    await refreshPlanningBoard();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

function renderWiStats() {
  const el = document.getElementById('wi-stats');
  if (!el) return;
  const total = allWorkItems.length;
  const inSprint = allWorkItems.filter(i => i.backlog_status === 'sprint').length;
  const dodDone = allWorkItems.filter(i => i.dod_complete).length;
  const pts = allWorkItems.reduce((s, i) => s + (i.story_points || 0), 0);
  el.innerHTML = `
    <div class="stat"><span class="stat-val">${total}</span><span class="stat-label">Items</span></div>
    <div class="stat"><span class="stat-val">${inSprint}</span><span class="stat-label">In Sprint</span></div>
    <div class="stat"><span class="stat-val">${dodDone}</span><span class="stat-label">DoD Ready</span></div>
    <div class="stat"><span class="stat-val">${pts}</span><span class="stat-label">Total Pts</span></div>
  `;
}

function renderWorkItemTable() {
  const tbody = document.getElementById('wi-tbody');
  if (!tbody) return;
  if (!allWorkItems.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty"><p>No work items found</p><small>Create your first item or adjust filters.</small></div></td></tr>`;
    updateBulkActions(); // no rows left means nothing can be checked — reset the bar
    return;
  }
  tbody.innerHTML = allWorkItems.map(item => {
    const dodBadge = item.dod_complete
        ? `<span class="badge badge-dod">✓ Ready</span>`
        : `<span class="badge badge-nodod">Incomplete</span>`;
    const sprintLabel = item.sprint_name
        ? `<span class="badge badge-sprint" style="font-size:10px">${escHtml(item.sprint_name)}</span>`
        : `<span style="color:var(--gray-400);font-size:11px">Backlog</span>`;
    return `<tr data-id="${item.id}">
      <td><input type="checkbox" class="wi-check" data-id="${item.id}" /></td>
      <td class="wi-title-cell">
        <div class="title-text" onclick="openEditWi(${item.id})">${escHtml(item.title)}</div>
        ${item.epic_title ? `<div class="subtitle" style="display:flex;align-items:center;gap:5px">${featureDot(item.epic_id, 7)} ${escHtml(item.epic_title)}${item.epic_locked ? ' 🔒' : ''}</div>` : ''}
        ${item.release_title ? `<div class="subtitle" style="display:flex;align-items:center;gap:5px">${releaseDot(item.release_id)} ${escHtml(item.release_title)}</div>` : ''}
        ${item.notion_source ? `<div class="subtitle">📎 From Notion</div>` : ''}
      </td>
      <td>${typeBadge(item.work_item_type)}</td>
      <td>${platformBadge(item.platform)}</td>
      <td>${stateBadge(item.state)}</td>
      <td>${priDot(item.priority)}${item.priority}</td>
      <td style="text-align:center">${item.story_points != null ? item.story_points : '—'}</td>
      <td>${sprintLabel}</td>
      <td>${dodBadge}</td>
      <td>
        <button class="btn-icon" onclick="openEditWi(${item.id})" title="Edit">✏️</button>
        <button class="btn-icon" onclick="quickExportItem(${item.id})" title="Export this item to CSV">⬇️</button>
        <button class="btn-icon" onclick="pushItemToADO(${item.id})" title="Create or update this item in Azure DevOps via the ADO Bridge">🚀</button>
        <button class="btn-icon" onclick="deleteWorkItemRow(${item.id})" title="Delete">🗑️</button>
      </td>
    </tr>`;
  }).join('');

  // Checkbox logic
  document.querySelectorAll('.wi-check').forEach(cb => cb.addEventListener('change', updateBulkActions));
  document.getElementById('wi-select-all')?.addEventListener('change', e => {
    document.querySelectorAll('.wi-check').forEach(cb => { cb.checked = e.target.checked; });
    updateBulkActions();
  });
  // A fresh table has no checked boxes — reset the bulk-actions bar to match, so it
  // doesn't linger showing a stale count after Delete Selected (or any bulk action)
  // re-renders the table out from under it.
  updateBulkActions();
}

function updateBulkActions() {
  const checked = [...document.querySelectorAll('.wi-check:checked')];
  const bar = document.getElementById('bulk-actions');
  const countEl = document.getElementById('bulk-count');
  if (bar) bar.style.display = checked.length ? 'flex' : 'none';
  if (countEl) countEl.textContent = `${checked.length} item${checked.length !== 1 ? 's' : ''} selected`;
}

function getSelectedIds() {
  return [...document.querySelectorAll('.wi-check:checked')].map(cb => Number(cb.dataset.id));
}

async function quickExportItem(id) {
  API.download(`/csv/export/sprint?ids=${id}`, 'work_item_export.csv');
}

// ── PUSH TO ADO (via the ADO Bridge service)
// These call the /ado-bridge/push/* routes (adoBridgeRoutes.js) which forward
// to the ADO Bridge FastAPI service. The bridge creates or updates the work
// item in Azure DevOps and returns the ADO id, which the route syncs back
// into work_items.ado_id — so pushing the same item twice updates rather
// than duplicates. ADO Bridge must be running (see its /health endpoint).

// Push a single work item. Uses the per-item endpoint so the bridge can
// decide create-vs-update from its mapping table.
async function pushItemToADO(id) {
  const item = allWorkItems.find(i => i.id === id);
  const label = item ? `"${item.title}"` : 'this work item';
  // If the item already has an ado_id, confirm before re-pushing — the
  // bridge will update it, which could overwrite manual ADO changes.
  if (item?.ado_id) {
    if (!confirm(`"${item.title}" already has ADO ID ${item.ado_id}. Pushing will update the existing work item in ADO. Continue?`)) return;
  }
  try {
    toast(`Pushing ${label} to ADO...`, 'info');
    const result = await API.post('/ado-bridge/push/item/' + id, {});
    const action = result.action === 'created' ? 'created in ADO' : 'updated in ADO';
    toast(`✓ ${label} ${action} (ADO ID ${result.adoId})`, 'success');
    await loadWorkItems(); // refresh to show the new ado_id
  } catch(e) {
    toast('Push failed: ' + e.message, 'error');
  }
}

// Push all selected work items as a batch. Epics/Features are sent first
// (handled by the route) so child stories can nest under them.
async function bulkPushToADO() {
  const ids = getSelectedIds();
  if (!ids.length) { toast('No items selected', 'error'); return; }
  // Warn if any selected items already have ado_ids — those will be updated.
  const existing = allWorkItems.filter(i => ids.includes(i.id) && i.ado_id);
  const msg = existing.length
    ? `Push ${ids.length} item${ids.length === 1 ? '' : 's'} to ADO? ${existing.length} already ${existing.length === 1 ? 'has' : 'have'} an ADO ID and will be updated.`
    : `Push ${ids.length} item${ids.length === 1 ? '' : 's'} to ADO? New items will be created in Azure DevOps.`;
  if (!confirm(msg)) return;
  try {
    toast(`Pushing ${ids.length} item${ids.length === 1 ? '' : 's'} to ADO...`, 'info');
    const result = await API.get(`/ado-bridge/push/sprint?ids=${ids.join(',')}`);
    const { created, updated, failed } = result;
    if (failed) {
      toast(`⚠ ${created} created, ${updated} updated, ${failed} failed — see console for details`, 'error');
      console.error('ADO push failures:', result.results.filter(r => r.error));
    } else {
      toast(`✓ ${created} created, ${updated} updated in ADO`, 'success');
    }
    await loadWorkItems(); // refresh to show new ado_ids
  } catch(e) {
    toast('Push failed: ' + e.message, 'error');
  }
}

// ── OPEN EDIT
async function openEditWi(id) {
  editingWiId = id;
  document.getElementById('wi-modal-title').textContent = 'Edit Work Item';
  document.getElementById('btn-delete-wi').style.display = 'inline-flex';
  const item = await API.get('/work-items/' + id);
  fillWiForm(item);
  // Reset to first tab
  document.querySelectorAll('#wi-modal .tab-btn').forEach((b,i) => b.classList.toggle('active', i===0));
  document.querySelectorAll('#wi-modal .tab-panel').forEach((p,i) => p.classList.toggle('active', i===0));
  openModal('wi-modal');
}

function openNewWi() {
  editingWiId = null;
  document.getElementById('wi-modal-title').textContent = 'New Work Item';
  document.getElementById('btn-delete-wi').style.display = 'none';
  clearWiForm();
  document.querySelectorAll('#wi-modal .tab-btn').forEach((b,i) => b.classList.toggle('active', i===0));
  document.querySelectorAll('#wi-modal .tab-panel').forEach((p,i) => p.classList.toggle('active', i===0));
  openModal('wi-modal');
}

// ── HTML PREVIEW (Description / Acceptance Criteria)
// Both fields are edited as raw text, so the textarea alone only ever shows literal
// `<div>` tags or leading dashes, never what ADO will actually display. Description is
// genuine HTML — render it as-is. Acceptance Criteria is plain text (see the field's own
// hint) that only becomes HTML at CSV-export time (descriptionWithAC() in csv.js) — this
// mirrors that exact bulleted/paragraph conversion so the preview matches the real
// export, and escapes each line first since, unlike Description, nothing here is
// supposed to be interpreted as markup.
function acceptanceCriteriaToHtml(text) {
  const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const isBulleted = lines.every(l => /^[-•]/.test(l));
  return isBulleted
    ? '<ul>' + lines.map(l => `<li>${escHtml(l.replace(/^[-•]\s*/, ''))}</li>`).join('') + '</ul>'
    : lines.map(l => `<p>${escHtml(l)}</p>`).join('');
}
function updateWiHtmlPreviews() {
  const descPreview = document.getElementById('wi-description-preview');
  const acPreview = document.getElementById('wi-ac-preview');
  if (descPreview) descPreview.innerHTML = document.getElementById('wi-description').value || '';
  if (acPreview) acPreview.innerHTML = acceptanceCriteriaToHtml(document.getElementById('wi-acceptance-criteria').value);
}

function fillWiForm(item) {
  document.getElementById('wi-title').value = item.title || '';
  document.getElementById('wi-type').value = item.work_item_type || 'User Story';
  document.getElementById('wi-platform').value = item.platform || '';
  document.getElementById('wi-state').value = item.state || 'New';
  document.getElementById('wi-priority').value = item.priority || 2;
  document.getElementById('wi-points').value = item.story_points || '';
  document.getElementById('wi-assigned').value = item.assigned_to || '';
  document.getElementById('wi-tags').value = item.tags || '';
  document.getElementById('wi-focus').value = item.sprint_focus_area || '';
  document.getElementById('wi-ado-id').value = item.ado_id || '';
  document.getElementById('wi-description').value = item.description || '';
  document.getElementById('wi-acceptance-criteria').value = item.acceptance_criteria || '';
  document.getElementById('wi-features').value = item.features || '';
  document.getElementById('wi-public-notes').value = item.public_release_notes || '';
  document.getElementById('wi-tech-notes').value = item.technical_release_notes || '';
  // Epic, sprint, and release selects
  populateEpicSelect('wi-epic', item.epic_id);
  populateSprintSelect('wi-sprint', item.sprint_id);
  populateReleaseSelect('wi-release', item.release_id);
  // Notion link
  const notionEl = document.getElementById('wi-notion-link');
  notionEl.textContent = item.notion_source ? `📎 Imported from Notion` : '';
  // DoD
  renderDodPanel(item.dod_checks || []);
  updateWiHtmlPreviews();
}

function clearWiForm() {
  ['wi-title','wi-points','wi-assigned','wi-tags','wi-focus','wi-ado-id','wi-description','wi-acceptance-criteria','wi-features','wi-public-notes','wi-tech-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('wi-type').value = 'User Story';
  document.getElementById('wi-state').value = 'New';
  document.getElementById('wi-priority').value = '2';
  document.getElementById('wi-platform').value = '';
  populateEpicSelect('wi-epic', null);
  populateSprintSelect('wi-sprint', null);
  populateReleaseSelect('wi-release', null);
  document.getElementById('wi-notion-link').textContent = '';
  renderDodPanel([]);
  updateWiHtmlPreviews();
}

function getWiFormData() {
  return {
    title: document.getElementById('wi-title').value.trim(),
    work_item_type: document.getElementById('wi-type').value,
    platform: document.getElementById('wi-platform').value,
    state: document.getElementById('wi-state').value,
    priority: Number(document.getElementById('wi-priority').value),
    story_points: document.getElementById('wi-points').value ? Number(document.getElementById('wi-points').value) : null,
    assigned_to: document.getElementById('wi-assigned').value.trim(),
    tags: document.getElementById('wi-tags').value.trim(),
    sprint_focus_area: document.getElementById('wi-focus').value.trim(),
    ado_id: document.getElementById('wi-ado-id').value.trim(),
    description: document.getElementById('wi-description').value,
    acceptance_criteria: document.getElementById('wi-acceptance-criteria').value.trim(),
    features: document.getElementById('wi-features').value.trim(),
    public_release_notes: document.getElementById('wi-public-notes').value,
    technical_release_notes: document.getElementById('wi-tech-notes').value,
    epic_id: document.getElementById('wi-epic').value || null,
    sprint_id: document.getElementById('wi-sprint').value || null,
    release_id: document.getElementById('wi-release').value || null,
    backlog_status: document.getElementById('wi-sprint').value ? 'sprint' : 'backlog'
  };
}

// ── DOD PANEL
function renderDodPanel(checks) {
  const container = document.getElementById('wi-dod-items');
  const progress = document.getElementById('wi-dod-progress');
  if (!container) return;
  if (!checks.length) {
    container.innerHTML = '<div style="color:var(--gray-400);font-size:12px;padding:8px 0">Save the work item first to see DoD checklist.</div>';
    if (progress) progress.textContent = '';
    return;
  }
  const done = checks.filter(c => c.checked).length;
  if (progress) progress.textContent = `${done}/${checks.length}`;
  container.innerHTML = checks.map(c => `
    <div class="dod-item">
      <input type="checkbox" id="dod-${c.id}" ${c.checked ? 'checked' : ''} onchange="toggleDod(${c.id}, this.checked)" />
      <label for="dod-${c.id}" class="${c.checked ? 'checked' : ''}">${escHtml(c.label)}</label>
    </div>
  `).join('');
}

async function toggleDod(checkId, checked) {
  if (!editingWiId) return;
  try {
    const result = await API.patch(`/work-items/${editingWiId}/dod/${checkId}`, { checked });
    // Update label style
    const label = document.querySelector(`label[for="dod-${checkId}"]`);
    if (label) label.className = checked ? 'checked' : '';
    // Update progress
    const items = document.querySelectorAll('.dod-item input[type=checkbox]');
    const done = [...items].filter(i => i.checked).length;
    const progress = document.getElementById('wi-dod-progress');
    if (progress) progress.textContent = `${done}/${items.length}`;
  } catch(e) { toast('Failed to update DoD check', 'error'); }
}

// ── EPIC / SPRINT SELECT HELPERS
function populateEpicSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- No Epic --</option>' +
      allEpics.map(e => `<option value="${e.id}" ${e.id == selectedId ? 'selected' : ''}>${escHtml(e.title)}${e.ado_id ? ' (' + e.ado_id + ')' : ''}</option>`).join('');
}

function populateSprintSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Backlog --</option>' +
      allSprints.map(s => `<option value="${s.id}" ${s.id == selectedId ? 'selected' : ''}>${escHtml(s.name)}</option>`).join('');
}

function populateReleaseSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- No Release --</option>' +
      (allReleases || []).map(r => `<option value="${r.id}" ${r.id == selectedId ? 'selected' : ''}>${escHtml(r.title)}</option>`).join('');
}

// ── SAVE
async function saveWorkItem() {
  const data = getWiFormData();
  if (!data.title) { toast('Title is required', 'error'); return; }
  try {
    if (editingWiId) {
      const result = await API.put('/work-items/' + editingWiId, data);
      toast('Work item updated', 'success');
      featureShiftToast(result);
    } else {
      await API.post('/work-items', data);
      toast('Work item created', 'success');
    }
    closeModal('wi-modal');
    await loadWorkItems();
    await refreshPlanningBoard();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteWorkItem() {
  if (!editingWiId) return;
  if (!confirm('Delete this work item? This cannot be undone.')) return;
  try {
    await API.delete('/work-items/' + editingWiId);
    toast('Work item deleted');
    closeModal('wi-modal');
    await loadWorkItems();
    await refreshPlanningBoard();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// Row-level delete (Backlog table's 🗑️ icon) — same confirm+delete as the modal's
// Delete button, without opening the modal first. Looks the title up from the
// already-loaded table data rather than trusting anything passed through onclick.
async function deleteWorkItemRow(id) {
  const item = allWorkItems.find(i => i.id === id);
  const label = item ? `"${item.title}"` : 'this work item';
  if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
  try {
    await API.delete('/work-items/' + id);
    toast('Work item deleted');
    await loadWorkItems();
    await refreshPlanningBoard();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ── BULK ASSIGN
async function bulkAssignSprint() {
  const ids = getSelectedIds();
  const sprint_id = document.getElementById('bulk-sprint-select')?.value;
  if (!ids.length) return;
  try {
    const result = await API.post('/work-items/bulk/assign-sprint', { ids, sprint_id: sprint_id ? Number(sprint_id) : null });
    toast(`${ids.length} items assigned`, 'success');
    featureShiftToast(result);
    await loadWorkItems();
    await refreshPlanningBoard();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

function populateBulkSprintSelect() {
  const sel = document.getElementById('bulk-sprint-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">Remove from sprint (→ Backlog)</option>' +
      allSprints.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
}

// Initialize work items view
function initWorkItemsView() {
  document.getElementById('wi-description')?.addEventListener('input', updateWiHtmlPreviews);
  document.getElementById('wi-acceptance-criteria')?.addEventListener('input', updateWiHtmlPreviews);
  document.getElementById('btn-new-wi')?.addEventListener('click', openNewWi);
  document.getElementById('btn-save-wi')?.addEventListener('click', saveWorkItem);
  document.getElementById('btn-delete-wi')?.addEventListener('click', deleteWorkItem);
  document.getElementById('btn-bulk-assign')?.addEventListener('click', bulkAssignSprint);
  document.getElementById('btn-bulk-assign-feature')?.addEventListener('click', bulkAssignFeature);
  document.getElementById('btn-new-feature')?.addEventListener('click', openNewEpic);
  document.getElementById('features-toggle')?.addEventListener('click', toggleFeaturesPanel);
  document.getElementById('btn-bulk-export')?.addEventListener('click', () => {
    const ids = getSelectedIds();
    if (!ids.length) { toast('No items selected', 'error'); return; }
    API.download(`/csv/export/sprint?ids=${ids.join(',')}`, 'selected_export.csv');
  });
  document.getElementById('btn-bulk-push-ado')?.addEventListener('click', bulkPushToADO);
  document.getElementById('btn-bulk-delete')?.addEventListener('click', bulkDeleteWorkItems);

  // Filters
  ['wi-search','wi-filter-type','wi-filter-platform','wi-filter-state','wi-filter-backlog','wi-filter-source','wi-filter-epic'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => loadWorkItems());
  });
}