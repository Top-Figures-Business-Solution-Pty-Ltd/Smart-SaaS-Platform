import { DEFAULT_COLUMNS } from './constants.js';
import { sanitizeProjectColumnsConfig } from './deprecatedColumns.js';
import { ViewService } from '../services/viewService.js';
import { CLIENT_COLUMNS, getDefaultClientColumns, loadClientColumns } from './clientsColumns.js';
import { notify } from '../services/uiAdapter.js';

function esc(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function asText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => asText(x)).filter(Boolean).join('; ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
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

function projectCell(project, field) {
  const f = String(field || '').trim();
  if (!f) return '';
  if (f.startsWith('__sb_')) return '';
  if (f.startsWith('team:')) {
    const role = f.split(':')[1] || '';
    const team = Array.isArray(project?.custom_team_members) ? project.custom_team_members : [];
    return team
      .filter((x) => String(x?.role || '').trim() === String(role).trim())
      .map((x) => x?.user || '')
      .filter(Boolean)
      .join('; ');
  }
  if (f === 'customer') return project?.customer_name || project?.customer || '';
  if (f === 'custom_softwares') {
    const list = Array.isArray(project?.custom_softwares) ? project.custom_softwares : [];
    return list.map((x) => (typeof x === 'string' ? x : x?.software)).filter(Boolean).join('; ');
  }
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

function buildProjectsCsvText(rows, cols) {
  const header = cols.map((c) => esc(c?.label || c?.field || ''));
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(cols.map((c) => esc(projectCell(r, c.field))).join(','));
  }
  // BOM so Excel opens UTF-8 cleanly.
  return `\ufeff${lines.join('\n')}`;
}

export async function exportCurrentProjectsCSV({ store, viewType } = {}) {
  const rows = store?.getState?.()?.projects?.items || [];
  if (!Array.isArray(rows) || !rows.length) {
    notify('No loaded project rows to export.', 'orange');
    return;
  }
  const cols = normalizeExportColumns(await resolveProjectColumns(viewType));
  const file = `projects_${String(viewType || 'board').replace(/\s+/g, '_')}_${todayStamp()}.csv`;
  download(file, buildProjectsCsvText(rows, cols));
  notify(`Exported ${rows.length} loaded projects.`, 'green');
}

// Export only the rows whose `name` is in `selectedNames`.
// - `columns` (optional): the columns currently rendered by the caller; lets us
//   honour "export exactly what I see", including unsaved column tweaks.
// - Falls back to the Saved View columns when `columns` is missing/empty.
export async function exportSelectedProjectsCSV({ store, viewType, selectedNames, columns } = {}) {
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
  const file = `projects_${String(viewType || 'board').replace(/\s+/g, '_')}_selected_${todayStamp()}.csv`;
  download(file, buildProjectsCsvText(rows, cols));
  notify(`Exported ${rows.length} selected projects.`, 'green');
}

export async function exportCurrentClientsCSV({ store } = {}) {
  const rows = store?.getState?.()?.clients?.items || [];
  if (!Array.isArray(rows) || !rows.length) {
    notify('No loaded client rows to export.', 'orange');
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
  notify(`Exported ${rows.length} loaded clients.`, 'green');
}

