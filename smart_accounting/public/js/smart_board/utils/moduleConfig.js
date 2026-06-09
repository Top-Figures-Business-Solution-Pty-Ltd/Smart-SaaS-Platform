const SHARED_PROJECT_FIELDS = new Set([
  'project_name',
  'customer',
  'status',
  'notes',
  'modified',
]);

const ACCOUNTING_PROJECT_FIELDS = new Set([
  'custom_entity_type',
  'custom_customer_entity',
  '__sb_project_monthly_completion',
  'project_type',
  'company',
  'priority',
  'custom_softwares',
  'custom_engagement_letter',
  'expected_end_date',
  'custom_lodgement_due_date',
  'custom_project_frequency',
  'custom_target_month',
  'custom_fiscal_year',
  'custom_year_end',
  'custom_reset_date',
  'custom_ato_status',
  'custom_lodgeit_status',
  'custom_company_agent_status',
  'custom_xeroquickbooks_status',
  'estimated_costing',
  'is_active',
]);

const GRANTS_PROJECT_FIELDS = new Set([
  'project_type',
  'custom_grants_fy_label',
  'custom_grants_abn_snapshot',
  // (custom_grants_deliverer removed 2026-05)
  'custom_grants_state',
  'custom_grants_industry_category',
  'custom_grants_type',
  'custom_grants_priority',
  'custom_grants_partner_label',
  'custom_grants_referral_text',
  'custom_grants_owner_name',
  'custom_grants_address_snapshot',
  'custom_grants_contact_name',
  'custom_grants_primary_communication',
  'custom_grants_status',
  'custom_ap_submit_date',
  'custom_industry_approval_date',
  'custom_tax_lodgement_date',
  'custom_rebate_amount_text',
  'custom_fee_percentage_text',
  'custom_fee_arrangement',
  // Grants checkbox columns (2026-04)
  'custom_tg_tax_agent',
  'custom_portal_access_received',
  // Portal access expiry (Date) — Smart Grants only (2026-05)
  'custom_portal_access_expiry_date',
]);

export function getModuleKey(explicitKey = null) {
  const raw = String(
    explicitKey
      || window.smart_accounting?.module_key
      || 'accounting'
  ).trim().toLowerCase();
  return raw === 'grants' ? 'grants' : 'accounting';
}

export function getAllowedProjectTypes(explicit = null) {
  const source = Array.isArray(explicit)
    ? explicit
    : window.smart_accounting?.allowed_project_types;
  return Array.isArray(source)
    ? source.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
}

export function getExcludedProjectTypes(explicit = null) {
  const source = Array.isArray(explicit)
    ? explicit
    : window.smart_accounting?.excluded_project_types;
  return Array.isArray(source)
    ? source.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
}

export function getModuleProjectTypeFilters({
  allowedProjectTypes = null,
  excludedProjectTypes = null,
} = {}) {
  const allowed = getAllowedProjectTypes(allowedProjectTypes);
  const excluded = getExcludedProjectTypes(excludedProjectTypes);
  const out = {};
  if (allowed.length === 1) out.project_type = allowed[0];
  else if (allowed.length > 1) out.project_type_in = allowed;
  if (excluded.length) out.excluded_project_types = excluded;
  return out;
}

export function isProjectColumnAllowed(field, moduleKey = null) {
  const key = getModuleKey(moduleKey);
  const f = String(field || '').trim();
  if (!f) return false;
  if (f.startsWith('team:') || f.startsWith('__sb_')) return true;
  if (SHARED_PROJECT_FIELDS.has(f)) return true;
  if (key === 'grants') return GRANTS_PROJECT_FIELDS.has(f);
  return ACCOUNTING_PROJECT_FIELDS.has(f);
}

export function getProjectColumnCatalogForModule(catalog = [], moduleKey = null, { includeHidden = true } = {}) {
  const key = getModuleKey(moduleKey);
  const hiddenInGrantsManager = new Set([
    '__sb_project_monthly_completion',
    'notes',
  ]);
  return (Array.isArray(catalog) ? catalog : [])
    .filter((c) => includeHidden ? true : !c?.hidden)
    .filter((c) => includeHidden || key !== 'grants' || !hiddenInGrantsManager.has(String(c?.field || '').trim()))
    .filter((c) => isProjectColumnAllowed(c?.field, key))
    .map((c) => ({ ...c }));
}

export function filterProjectColumnsForModule(columnsConfig = [], moduleKey = null, { viewType = '' } = {}) {
  const key = getModuleKey(moduleKey);
  const list = (Array.isArray(columnsConfig) ? columnsConfig : [])
    .filter((c) => isProjectColumnAllowed(c?.field, key))
    .map((c) => ({ ...c }));

  if (key === 'grants') {
    const requiredAfterAbn = [
      { field: 'custom_grants_state', label: 'State', width: 120 },
      { field: 'custom_grants_industry_category', label: 'Industry', width: 180 },
    ];
    const hasAbn = list.some((c) => String(c?.field || '').trim() === 'custom_grants_abn_snapshot');
    let insertIdx = list.findIndex((c) => String(c?.field || '').trim() === 'custom_grants_abn_snapshot');
    if (insertIdx < 0) insertIdx = list.length - 1;

    requiredAfterAbn.forEach((col, offset) => {
      const field = String(col.field || '').trim();
      const existingIdx = list.findIndex((c) => String(c?.field || '').trim() === field);
      const targetIdx = hasAbn ? (insertIdx + 1 + offset) : Math.min(list.length, offset);
      if (existingIdx === -1) {
        list.splice(targetIdx, 0, { ...col });
        return;
      }
      const [existing] = list.splice(existingIdx, 1);
      const normalized = { ...col, ...existing, label: existing?.label || col.label, width: existing?.width || col.width };
      const nextIdx = Math.min(targetIdx, list.length);
      list.splice(nextIdx, 0, normalized);
    });

    const hasAddress = list.some((c) => String(c?.field || '').trim() === 'custom_grants_address_snapshot');
    if (!hasAddress) {
      const addr = { field: 'custom_grants_address_snapshot', label: 'Address', width: 220 };
      const contactIdx = list.findIndex((c) => String(c?.field || '').trim() === 'custom_grants_contact_name');
      if (contactIdx >= 0) list.splice(contactIdx, 0, addr);
      else list.push(addr);
    }
  }

  return list;
}

// Roll Over / Duplicate configuration per module.
// The per-field list is NOT hardcoded here — it is built at open time from the
// board's actual columns (same labels & order as the Columns panel). This config
// only supplies:
// - fieldMeta: per-field hints for the "Set" editor (type/options) and default mode
//   ('carry' | 'clear'). Anything not listed defaults to { type:'data', mode:'carry' }.
// - excludeFields: columns that must never appear (identity/structural/computed,
//   or handled by a dedicated control such as Fiscal Year).
// - lockedCarry / resetStatus / advanceFiscalYear / target-board behaviour.
// Read-only / non-data columns that never belong in the carry list.
const _ROLLOVER_EXCLUDE_BASE = ['modified', 'is_active', 'priority_indicator'];

// Structural columns shown as locked "handled" rows (so the list still mirrors the
// Columns panel) instead of offering Carry/Clear/Set.
const _ROLLOVER_LOCKED_BASE = [
  { field: 'customer', label: 'Client', note: 'Carry (always)' },
  { field: 'company', label: 'Company', note: 'Carry (always)' },
  { field: 'project_type', label: 'Project Type', note: '→ Target board' },
  { field: 'project_name', label: 'Project Name', note: '→ auto-named' },
];

export function getRollOverConfig({ moduleKey = null } = {}) {
  const key = getModuleKey(moduleKey);
  if (key === 'grants') {
    // Smart Grants rolls over onto a DIFFERENT (next-year) board by default.
    return {
      enabled: true,
      defaultTargetMode: 'other',
      allowSameBoard: true,
      yearBoards: ['FY 2024', 'FY 2025', 'FY 2026', 'FY 2027'],
      resetStatus: 'Not started',
      lockedCarry: _ROLLOVER_LOCKED_BASE,
      // FY/CY board boards drive the year; the ERPNext fiscal-year link isn't a
      // grants column, so keep it out of the grants list.
      excludeFields: [..._ROLLOVER_EXCLUDE_BASE, 'custom_fiscal_year'],
      fieldMeta: {
        // Status is a normal column: default to Clear (= reset to the board default);
        // the user can switch to Carry or Set a specific status.
        status: { mode: 'clear' },
        custom_grants_type: { type: 'select', options: ['R&DTI', 'EMDG'] },
        custom_grants_priority: { type: 'select', options: ['S1', 'S2', 'S3', 'S4'] },
        custom_portal_access_received: { type: 'check' },
        custom_portal_access_expiry_date: { type: 'date' },
        custom_team_members: { type: 'none' },
        // Project-level fields default to "clear" (a new year starts fresh).
        custom_grants_fy_label: { mode: 'clear' },
        custom_grants_status: { mode: 'clear' },
        custom_ap_submit_date: { type: 'date', mode: 'clear' },
        custom_industry_approval_date: { type: 'date', mode: 'clear' },
        custom_tax_lodgement_date: { type: 'date', mode: 'clear' },
        custom_rebate_amount_text: { mode: 'clear' },
        custom_fee_percentage_text: { mode: 'clear' },
        notes: { mode: 'clear' },
      },
    };
  }
  // Smart Accounting: roll over on the SAME board; Fiscal Year defaults to "+1".
  // Keep everything else by default (users can Clear/Set per field).
  return {
    enabled: true,
    defaultTargetMode: 'same',
    allowSameBoard: true,
    // Board list is fetched at open time (accounting has many project types).
    yearBoards: null,
    resetStatus: 'Not started',
    lockedCarry: _ROLLOVER_LOCKED_BASE,
    excludeFields: _ROLLOVER_EXCLUDE_BASE,
    fieldMeta: {
      status: { mode: 'clear' },
      custom_softwares: { type: 'none' },
      custom_team_members: { type: 'none' },
      expected_end_date: { type: 'date' },
      custom_lodgement_due_date: { type: 'date' },
      custom_reset_date: { type: 'date' },
      // Fiscal Year stays in the list with a special "Next year (+1)" mode.
      custom_fiscal_year: { advance: true, mode: 'advance' },
    },
  };
}

export function getNewProjectModalConfig({ moduleKey = null, currentView = '' } = {}) {
  const key = getModuleKey(moduleKey);
  if (key === 'grants') {
    // Smart Grants projects are grouped onto per-year boards. The create form lets the
    // user pick which year board the project belongs to (defaulting to the current year board).
    const GRANTS_YEAR_BOARDS = ['FY 2024', 'FY 2025', 'FY 2026', 'FY 2027'];
    return {
      visibleFields: {
        company: true,
        fiscalYear: false,
        projectType: true,
        frequency: false,
        grantFy: true,
      },
      requiredFields: ['project_name', 'customer', 'company', 'project_type'],
      projectTypeOptions: GRANTS_YEAR_BOARDS,
      defaultValues: {
        project_type: 'FY 2026',
        custom_project_frequency: 'One-off',
        // Smart Grants defaults to the "Top Grants" company (Smart Accounting uses
        // its own first company, typically "Top Figures").
        company: 'Top Grants',
      },
    };
  }
  return {
    visibleFields: {
      company: true,
      fiscalYear: true,
      projectType: true,
      frequency: true,
      grantFy: false,
    },
    requiredFields: ['project_name', 'customer', 'company', 'custom_fiscal_year', 'project_type'],
    defaultValues: {},
  };
}
