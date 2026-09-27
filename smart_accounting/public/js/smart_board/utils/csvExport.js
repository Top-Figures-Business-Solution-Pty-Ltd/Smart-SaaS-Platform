import { DEFAULT_COLUMNS } from './constants.js';
import { sanitizeProjectColumnsConfig } from './deprecatedColumns.js';
import { ViewService } from '../services/viewService.js';
import { CLIENT_COLUMNS, getDefaultClientColumns, loadClientColumns } from './clientsColumns.js';
import { ClientsService } from '../services/clientsService.js';
import { UpdatesService } from '../services/updatesService.js';
import { DoctypeMetaService } from '../services/doctypeMetaService.js';
import { notify } from '../services/uiAdapter.js';

function esc(v) {
  let s = String(v == null ? '' : v);
  // Prevent CSV formula injection in spreadsheet apps (Excel/Sheets).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function asText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => asText(x)).filter(Boolean).join('; ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function isoDateText(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function isoMonthText(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4}-\d{2})/);
  return m ? m[1] : s;
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function parseSavedViewColumns(raw) {
  if (!raw) return [];
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (e) { v = null; }
  }
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    if (Array.isArray(v.project)) return v.project;
    if (Array.isArray(v.projectColumns)) return v.projectColumns;
  }
  return [];
}

async function projectMetaMap() {
  try {
    const meta = await DoctypeMetaService.getMeta('Project', { force: true });
    const map = new Map();
    for (const df of (Array.isArray(meta?.fields) ? meta.fields : [])) {
      const fieldname = String(df?.fieldname || '').trim();
      if (fieldname) map.set(fieldname, df);
    }
    return map;
  } catch (e) {
    return new Map();
  }
}

async function attachLinkLabelsForExport(rows, cols, metaMap) {
  const list = Array.isArray(rows) ? rows : [];
  const fields = (Array.isArray(cols) ? cols : [])
    .map((c) => String(c?.field || '').trim())
    .filter((f) => {
      const df = metaMap?.get?.(f);
      return String(df?.fieldtype || '') === 'Link' && String(df?.options || '') === 'User';
    });
  if (!list.length || !fields.length) return list;

  const users = [];
  for (const row of list) {
    for (const field of fields) {
      const value = String(row?.[field] || '').trim();
      if (value && !row?.[`${field}_label`]) users.push(value);
    }
  }
  const unique = Array.from(new Set(users));
  if (!unique.length) return list;

  let meta = {};
  try {
    const r = await frappe.call({
      method: 'smart_accounting.api.project_board.get_user_meta',
      args: { users: unique }
    });
    meta = r?.message || {};
  } catch (e) {
    meta = {};
  }

  return list.map((row) => {
    const next = { ...row };
    for (const field of fields) {
      const value = String(next?.[field] || '').trim();
      if (!value || next[`${field}_label`]) continue;
      next[`${field}_label`] = meta?.[value]?.label || value;
    }
    return next;
  });
}

function projectCell(project, field, metaMap = new Map()) {
  const f = String(field || '').trim();
  if (!f) return '';
  if (f === '__sb_updates_export') return asText(project?.__sb_updates_export);
  if (f.startsWith('__sb_')) return '';
  if (f.startsWith('team:')) {
    const role = f.split(':')[1] || '';
    const team = Array.isArray(project?.custom_team_members) ? project.custom_team_members : [];
    return team
      .filter((x) => String(x?.role || '').trim() === String(role).trim())
      .map((x) => x?.user_full_name || x?.user || '')
      .filter(Boolean)
      .join('; ');
  }
  if (f === 'customer') return project?.customer_name || project?.customer || '';
  if (f === 'custom_softwares') {
    const list = Array.isArray(project?.custom_softwares) ? project.custom_softwares : [];
    return list.map((x) => (typeof x === 'string' ? x : x?.software)).filter(Boolean).join('; ');
  }
  if (f === 'custom_engagement_date') return isoMonthText(project?.[f]);
  const df = metaMap?.get?.(f) || null;
  const fieldtype = String(df?.fieldtype || '').trim();
  if (fieldtype === 'Link') return project?.[`${f}_label`] || project?.[f] || '';
  if (fieldtype === 'Date' || fieldtype === 'Datetime') return isoDateText(project?.[f]);
  if (fieldtype === 'Check') return (project?.[f] === 1 || project?.[f] === '1' || project?.[f] === true) ? 'Yes' : 'No';
  return asText(project?.[f]);
}

async function resolveProjectColumns(viewType) {
  try {
    const fallbackCols = (DEFAULT_COLUMNS[viewType] || DEFAULT_COLUMNS.DEFAULT || []).map((c) => ({ field: c.field, label: c.label }));
    const view = await ViewService.getOrCreateDefaultView(viewType, {
      fallbackTitle: `${viewType} Board`,
      fallbackColumns: fallbackCols,
    });
    const cols = sanitizeProjectColumnsConfig(parseSavedViewColumns(view?.columns));
    if (Array.isArray(cols) && cols.length) {
      return cols.filter((c) => c?.field && !String(c.field).startsWith('__sb_'));
    }
  } catch (e) {}
  return (DEFAULT_COLUMNS[viewType] || DEFAULT_COLUMNS.DEFAULT || []).map((c) => ({ field: c.field, label: c.label }));
}

// Shape incoming column specs into a flat {field, label} list safe for CSV export.
// Drops internal columns (select checkbox, virtual `__sb_*` columns) and normalises labels.
function normalizeExportColumns(cols) {
  return (Array.isArray(cols) ? cols : [])
    .filter((c) => c?.field && !String(c.field).startsWith('__sb_'))
    .map((c) => ({ field: c.field, label: c.label || c.field }));
}

function withUpdatesExportColumn(cols) {
  const list = Array.isArray(cols) ? cols.slice() : [];
  const updatesCol = { field: '__sb_updates_export', label: 'updates' };
  if (!list.length) return [updatesCol];
  return [list[0], updatesCol, ...list.slice(1)];
}

async function attachUpdatesForExport(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const names = list.map((r) => String(r?.name || '').trim()).filter(Boolean);
  if (!names.length) return list;

  const updatesByProject = await UpdatesService.getProjectUpdatesForExport(names);
  return list.map((row) => {
    const updates = updatesByProject?.[row?.name];
    const text = Array.isArray(updates) ? updates.map((x) => String(x || '').trim()).filter(Boolean).join(', ') : '';
    return { ...row, __sb_updates_export: text };
  });
}

function buildProjectsCsvText(rows, cols, metaMap = new Map()) {
  const header = cols.map((c) => esc(c?.label || c?.field || ''));
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(cols.map((c) => esc(projectCell(r, c.field, metaMap))).join(','));
  }
  // BOM so Excel opens UTF-8 cleanly.
  return `\ufeff${lines.join('\n')}`;
}

export async function exportCurrentProjectsCSV({ store, viewType, includeUpdates = true } = {}) {
  const rows = store?.getState?.()?.projects?.items || [];
  if (!Array.isArray(rows) || !rows.length) {
    notify('No loaded project rows to export.', 'orange');
    return;
  }
  notify('Preparing project export...', 'blue');
  let cols = normalizeExportColumns(await resolveProjectColumns(viewType));
  if (includeUpdates) cols = withUpdatesExportColumn(cols);
  const metaMap = await projectMetaMap();
  const sourceRows = includeUpdates ? await attachUpdatesForExport(rows) : rows;
  const exportRows = await attachLinkLabelsForExport(sourceRows, cols, metaMap);
  const file = `projects_${String(viewType || 'board').replace(/\s+/g, '_')}_${todayStamp()}.csv`;
  download(file, buildProjectsCsvText(exportRows, cols, metaMap));
  notify(`Exported ${rows.length} loaded projects.`, 'green');
}

// Export only the rows whose `name` is in `selectedNames`.
// - `columns` (optional): the columns currently rendered by the caller; lets us
//   honour "export exactly what I see", including unsaved column tweaks.
// - Falls back to the Saved View columns when `columns` is missing/empty.
export async function exportSelectedProjectsCSV({ store, viewType, selectedNames, columns, includeUpdates = true } = {}) {
  const names = (Array.isArray(selectedNames) ? selectedNames : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  if (!names.length) {
    notify('No rows selected.', 'orange');
    return;
  }
  const nameSet = new Set(names);
  const all = store?.getState?.()?.projects?.items || [];
  const rows = (Array.isArray(all) ? all : []).filter((r) => nameSet.has(String(r?.name || '')));
  if (!rows.length) {
    notify('Selected rows not found in loaded data.', 'orange');
    return;
  }
  let cols = normalizeExportColumns(columns);
  if (!cols.length) {
    cols = normalizeExportColumns(await resolveProjectColumns(viewType));
  }
  if (!cols.length) {
    notify('No columns available to export.', 'orange');
    return;
  }
  notify('Preparing selected project export...', 'blue');
  if (includeUpdates) cols = withUpdatesExportColumn(cols);
  const metaMap = await projectMetaMap();
  const sourceRows = includeUpdates ? await attachUpdatesForExport(rows) : rows;
  const exportRows = await attachLinkLabelsForExport(sourceRows, cols, metaMap);
  const file = `projects_${String(viewType || 'board').replace(/\s+/g, '_')}_selected_${todayStamp()}.csv`;
  download(file, buildProjectsCsvText(exportRows, cols, metaMap));
  notify(`Exported ${rows.length} selected projects.`, 'green');
}

export async function exportCurrentClientsCSV({ store } = {}) {
  const clientState = store?.getState?.()?.clients || {};
  const lastFilters = clientState?.lastFilters || { search: '' };
  notify('Preparing full client export...', 'blue');
  let rows = [];
  try {
    rows = await fetchAllClientsForExport(lastFilters);
  } catch (e) {
    const message = e?.message || String(e || 'Client export failed');
    console.error('Client export failed:', e);
    notify(`Client export failed: ${message}`, 'red');
    return;
  }
  if (!Array.isArray(rows) || !rows.length) {
    notify('No client rows to export.', 'orange');
    return;
  }
  const fields = loadClientColumns() || getDefaultClientColumns();
  const defs = new Map((CLIENT_COLUMNS || []).map((c) => [c.field, c]));
  const cols = fields.map((f) => defs.get(f) || { field: f, label: f });
  const header = cols.map((c) => esc(c?.label || c?.field || ''));
  const lines = [header.join(',')];
  for (const c of rows) {
    lines.push(cols.map((col) => {
      const f = col.field;
      if (f === 'entity_type') return esc(c?.primary_entity?.entity_type || '');
      if (f === 'abn') return esc(c?.primary_entity?.abn || '');
      if (f === 'year_end') return esc(c?.primary_entity?.year_end || '');
      if (f === 'project_count') return esc(c?.project_count || 0);
      return esc(asText(c?.[f]));
    }).join(','));
  }
  const file = `clients_${todayStamp()}.csv`;
  download(file, `\ufeff${lines.join('\n')}`);
  notify(`Exported ${rows.length} clients.`, 'green');
}

async function fetchAllClientsForExport(filters = {}) {
  const pageSize = 200;
  const out = [];
  let offset = 0;
  let total = null;
  const seen = new Set();

  for (let page = 0; page < 1000; page += 1) {
    const r = await ClientsService.fetchClients({
      search: filters?.search || '',
      limitStart: offset,
      limit: pageSize,
      includeDisabled: !!filters?.includeDisabled,
      disabledOnly: !!filters?.disabledOnly,
    });
    const items = Array.isArray(r?.items) ? r.items : [];
    total = r?.meta?.total_count == null ? total : Number(r.meta.total_count);

    for (const c of items) {
      const name = String(c?.name || '').trim();
      if (!name || seen.has(name)) continue;
      out.push(c);
      seen.add(name);
    }

    offset += items.length;
    if (!items.length) break;
    if (total != null && Number.isFinite(total) && offset >= total) break;
    if (items.length < pageSize) break;
  }

  return out;
}

