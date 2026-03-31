/**
 * Clients columns (local, per-user)
 * - Keep this separate so Board Settings can later persist team defaults.
 */
const STORAGE_KEY = 'sb_clients_columns_v1';

export const CLIENT_COLUMNS = [
  { field: 'name', label: 'ID', width: 180 },
  { field: 'customer_name', label: 'Client', width: 260 },
  { field: 'custom_partner', label: 'Partner', width: 180 },
  { field: 'project_count', label: 'Projects', width: 120 },
  { field: 'active_project_count', label: 'Active', width: 120 },
  { field: 'entity_type', label: 'Entity Type', width: 160 },
  { field: 'abn', label: 'ABN', width: 160 },
  { field: 'year_end', label: 'Year End', width: 140 },
  { field: 'entities_count', label: 'Entities', width: 120 },
  // Optional extras (still from Customer / primary entity) — UI labels should prefer "Client"
  { field: 'customer_group', label: 'Group', width: 160 },
  { field: 'territory', label: 'Territory', width: 160 },
];

export function getDefaultClientColumns() {
  // Minimal useful default
  return ['customer_name', 'custom_partner', 'project_count', 'entity_type', 'year_end', 'entities_count'];
}

export function loadClientColumns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      const list = parsed.map(String).filter(Boolean);
      if (!list.includes('custom_partner')) {
        const idx = list.indexOf('customer_name');
        if (idx >= 0) list.splice(idx + 1, 0, 'custom_partner');
        else list.unshift('custom_partner');
      }
      return list;
    }
  } catch (e) {}
  return null;
}

export function saveClientColumns(fields) {
  const list = Array.isArray(fields) ? fields.map(String).filter(Boolean) : [];
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
  return list;
}


