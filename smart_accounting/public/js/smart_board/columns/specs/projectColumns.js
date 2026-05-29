/**
 * Project column specs (Step 5)
 * - Focus: editable flags + editor selection + special hooks (e.g. confirm).
 * - Rendering override is optional; by default we keep existing BoardCell.formatValue output.
 */
import { STATUS_COLORS } from '../../utils/constants.js';
import { InlineTextEditor, InlineTextareaEditor, InlineSelectEditor, InlineMenuSelectEditor, InlineDateEditor, InlineMoneyEditor } from '../../components/Common/editors/index.js';
import { LinkInput } from '../../components/Common/LinkInput.js';
import { MultiLinkPicker } from '../../components/Common/MultiLinkPicker.js';
import { uploadAttachmentToField } from '../../services/fileUploadService.js';
import { DoctypeMetaService } from '../../services/doctypeMetaService.js';
import { BoardStatusService } from '../../services/boardStatusService.js';
import { confirmDialog, notify } from '../../services/uiAdapter.js';
import { escapeHtml } from '../../utils/dom.js';
import { openProjectTypeChangeFlow } from '../../controllers/projectTypeChangeController.js';
import { openProjectFrequencyChangeFlow } from '../../controllers/projectFrequencyChangeController.js';
import { openProjectEntityChangeFlow } from '../../controllers/projectEntityChangeController.js';
import { getErrorMessage } from '../../utils/errorMessage.js';
import { ProjectService } from '../../services/projectService.js';
import { ProjectEntityService } from '../../services/projectEntityService.js';
import { formatDate } from '../../utils/helpers.js';

function _fileNameFromUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  const clean = s.split('?')[0].split('#')[0];
  const parts = clean.split('/');
  const last = parts[parts.length - 1] || '';
  try {
    return decodeURIComponent(last);
  } catch (e) {
    return last;
  }
}

function monthOptions() {
  return [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
}

function monthOptionsWithClear() {
  return [{ value: '', label: '— Clear —' }]
    .concat(monthOptions().map((m) => ({ value: m, label: m })));
}

function priorityOptions() {
  // Keep minimal for now; can be sourced from Doctype meta later.
  return ['Low', 'Medium', 'High', 'Urgent'];
}

// Options for Check-type fields rendered as Yes/No selects.
// Values are strings because the inline <select> element always returns strings;
// Frappe's set_value coerces "0"/"1" to int on Check fields server-side.
function yesNoOptions() {
  return [
    { value: '0', label: 'No' },
    { value: '1', label: 'Yes' },
  ];
}

// Canonical truthy check for Frappe Check fields.
// Backend may return 0/1 (int), "0"/"1" (string), or null/undefined.
function _isCheckYes(v) {
  return v === 1 || v === '1' || v === true;
}

function _renderYesNoCell(value) {
  const yes = _isCheckYes(value);
  const label = yes ? 'Yes' : 'No';
  const color = yes ? '#16a34a' : '#94a3b8';
  return `<span class="status-badge" style="background-color:${color};">${label}</span><span class="sb-afford sb-afford--select">▾</span>`;
}

async function statusOptionsForProject(project) {
  const pt = String(project?.project_type || '').trim();
  const cur = String(project?.status || '').trim();
  // Source of truth:
  // - Pool comes from Project.status meta (Property Setter)
  // - Board can further restrict to a subset by Project Type
  const opts = await BoardStatusService.getEffectiveOptions({ projectType: pt, currentValue: cur });
  // Ensure current value is always present (even if not in allowed subset)
  if (cur && Array.isArray(opts) && !opts.includes(cur)) return [cur].concat(opts);
  return Array.isArray(opts) ? opts : (cur ? [cur] : []);
}

function statusMenuEditor({ cellEl, project, manager, field }) {
  const contentEl = cellEl.querySelector('.cell-content') || cellEl;
  const current = project?.[field] || '';

  // Render immediately with current value only (so UI responds instantly),
  // then replace options once meta is loaded.
  const ed = new InlineMenuSelectEditor(contentEl, {
    options: current ? [{ value: current, label: current, color: STATUS_COLORS[current] || '' }] : [],
    initialValue: current
  });

  // Commit on selection
  contentEl.addEventListener('sb:menu-select', (e) => {
    e.stopPropagation?.();
    manager?.commitAndClose?.('menu-select');
  }, { once: true });
  // Close on outside click
  contentEl.addEventListener('sb:menu-close', () => {
    manager?.commitAndClose?.('menu-close');
  }, { once: true });

  // Load true options from backend meta and re-render editor once.
  statusOptionsForProject(project).then((opts) => {
    if (!contentEl?.isConnected) return;
    const items = (opts || []).map((s) => ({
      value: s,
      label: s,
      color: STATUS_COLORS[s] || ''
    }));
    ed.options = items;
    ed.render();
    mountEditorHelpers(manager, contentEl, ed);
  });

  mountEditorHelpers(manager, contentEl, ed);
  return ed;
}

function mountEditorHelpers(manager, mountEl, editorInstance) {
  // Manager can bind Enter/blur/Esc based on inputEl.
  const inputEl = editorInstance?.getInputEl?.() || mountEl?.querySelector?.('.sb-inline-editor') || null;
  manager?.bindActiveEditor?.(inputEl, editorInstance);
  // Focus after mount
  setTimeout(() => {
    try { editorInstance?.focus?.({ select: true }); } catch (e) {}
  }, 0);
}

function linkEditor({ cellEl, project, field, manager, doctype, placeholder }) {
  const contentEl = cellEl.querySelector('.cell-content') || cellEl;
  contentEl.innerHTML = `<div class="sb-inline-editor sb-inline-editor--link"></div>`;
  const mountEl = contentEl.querySelector('.sb-inline-editor--link');
  if (!mountEl) return;

  const li = new LinkInput(mountEl, {
    doctype,
    placeholder: placeholder || 'Search...',
    initialValue: project?.[field] || null,
    onChange: () => {
      // On selection, commit immediately (still respects blur/outside click).
      manager?.commitAndClose?.('link-change');
    }
  });

  // Let manager bind lifecycle based on underlying input.
  manager?.bindActiveEditor?.(mountEl.querySelector('.sb-linkinput__input'), li);

  setTimeout(() => {
    try { mountEl.querySelector('.sb-linkinput__input')?.focus?.(); } catch (e) {}
  }, 0);
}

let _companyOptionsCache = null;
let _companyOptionsLoading = null;
async function getCompanyOptions() {
  if (Array.isArray(_companyOptionsCache)) return _companyOptionsCache;
  if (_companyOptionsLoading) return _companyOptionsLoading;
  _companyOptionsLoading = (async () => {
    try {
      const r = await frappe.call({
        method: 'frappe.client.get_list',
        type: 'POST',
        args: {
          doctype: 'Company',
          fields: ['name'],
          order_by: 'name asc',
          limit_page_length: 200
        }
      });
      const list = (r?.message || []).map((x) => x?.name).filter(Boolean);
      _companyOptionsCache = list;
      return list;
    } catch (e) {
      _companyOptionsCache = [];
      return [];
    } finally {
      _companyOptionsLoading = null;
    }
  })();
  return _companyOptionsLoading;
}

let _fiscalYearOptionsCache = null;
let _fiscalYearOptionsLoading = null;
async function getFiscalYearOptions() {
  if (Array.isArray(_fiscalYearOptionsCache)) return _fiscalYearOptionsCache;
  if (_fiscalYearOptionsLoading) return _fiscalYearOptionsLoading;
  _fiscalYearOptionsLoading = (async () => {
    try {
      const r = await frappe.call({
        method: 'frappe.client.get_list',
        type: 'POST',
        args: {
          doctype: 'Fiscal Year',
          fields: ['name'],
          order_by: 'year_start_date desc, name desc',
          limit_page_length: 200
        }
      });
      const list = (r?.message || []).map((x) => x?.name).filter(Boolean);
      _fiscalYearOptionsCache = list;
      return list;
    } catch (e) {
      _fiscalYearOptionsCache = [];
      return [];
    } finally {
      _fiscalYearOptionsLoading = null;
    }
  })();
  return _fiscalYearOptionsLoading;
}

const _projectSelectOptionsCache = new Map();
const _projectSelectOptionsLoading = new Map();
async function getProjectSelectOptions(fieldname) {
  const fn = String(fieldname || '').trim();
  if (!fn) return [];
  if (_projectSelectOptionsCache.has(fn)) return _projectSelectOptionsCache.get(fn) || [];
  if (_projectSelectOptionsLoading.has(fn)) return _projectSelectOptionsLoading.get(fn);
  const p = (async () => {
    try {
      const opts = await DoctypeMetaService.getSelectOptions('Project', fn, { force: true });
      const list = Array.isArray(opts) ? opts.filter(Boolean) : [];
      _projectSelectOptionsCache.set(fn, list);
      return list;
    } catch (e) {
      _projectSelectOptionsCache.set(fn, []);
      return [];
    } finally {
      _projectSelectOptionsLoading.delete(fn);
    }
  })();
  _projectSelectOptionsLoading.set(fn, p);
  return p;
}

function projectFieldMenuEditor({ cellEl, project, manager, field }) {
  const contentEl = cellEl.querySelector('.cell-content') || cellEl;
  const current = String(project?.[field] || '').trim();
  const ed = new InlineMenuSelectEditor(contentEl, {
    options: current ? [{ value: current, label: current, color: STATUS_COLORS[current] || '' }] : [],
    initialValue: current
  });

  contentEl.addEventListener('sb:menu-select', (e) => {
    e.stopPropagation?.();
    manager?.commitAndClose?.('menu-select');
  }, { once: true });
  contentEl.addEventListener('sb:menu-close', () => {
    manager?.commitAndClose?.('menu-close');
  }, { once: true });

  getProjectSelectOptions(field).then((opts) => {
    if (!contentEl?.isConnected) return;
    if (Array.isArray(opts) && opts.length) {
      ed.options = opts.map((v) => ({ value: v, label: v, color: STATUS_COLORS[v] || '' }));
      ed.render();
      mountEditorHelpers(manager, contentEl, ed);
    }
  });

  mountEditorHelpers(manager, contentEl, ed);
  return ed;
}

function companyMenuEditor({ cellEl, project, manager, field }) {
  const contentEl = cellEl.querySelector('.cell-content') || cellEl;

  // Create editor immediately (so manager lifecycle works), then populate options async.
  const ed = new InlineMenuSelectEditor(contentEl, {
    options: [{ value: project?.[field] || '', label: project?.[field] || '—' }].filter((x) => x.value),
    initialValue: project?.[field] || ''
  });

  // Commit on selection (menu-select is emitted by editor)
  contentEl.addEventListener('sb:menu-select', (e) => {
    e.stopPropagation?.();
    manager?.commitAndClose?.('menu-select');
  }, { once: true });

  // Close on outside click (portal menu emits sb:menu-close)
  contentEl.addEventListener('sb:menu-close', () => {
    manager?.commitAndClose?.('menu-close');
  }, { once: true });

  // Populate options from system (best-effort); if permission blocks, fall back to search-based LinkInput
  getCompanyOptions().then((opts) => {
    if (!contentEl?.isConnected) return;
    if (Array.isArray(opts) && opts.length) {
      ed.options = opts.map((c) => ({ value: c, label: c }));
      ed.render();
      // Re-bind lifecycle after re-render
      mountEditorHelpers(manager, contentEl, ed);
    } else {
      // fallback to old search input if company list can't be read
      try {
        ed.destroy?.();
      } catch (e2) {}
      linkEditor({ cellEl, project, field, manager, doctype: 'Company', placeholder: 'Search Company...' });
    }
  });

  mountEditorHelpers(manager, contentEl, ed);
  return ed;
}

function multiLinkEditor({ cellEl, project, manager, doctype, placeholder, initialValues, defaultList, resolveMeta }) {
  const contentEl = cellEl.querySelector('.cell-content') || cellEl;
  contentEl.innerHTML = `<div class="sb-inline-editor sb-inline-editor--link"></div>`;
  const mountEl = contentEl.querySelector('.sb-inline-editor--link');
  if (!mountEl) return;

  const picker = new MultiLinkPicker(mountEl, {
    doctype,
    placeholder: placeholder || 'Search...',
    initialValues: Array.isArray(initialValues) ? initialValues : [],
    defaultList: defaultList || null,
    resolveMeta: resolveMeta || null,
    onChange: () => {
      // Commit on each change but keep editor open for multi-select.
      manager?.commit?.('multilink-change');
    }
  });

  // Bind manager lifecycle to the input element so Enter/blur/Esc works.
  manager?.bindActiveEditor?.(picker.getInputEl(), picker);

  setTimeout(() => {
    try { picker.focus?.(); } catch (e) {}
  }, 0);

  return picker;
}

async function defaultSoftwareList() {
  try {
    const r = await frappe.call({
      method: 'frappe.client.get_list',
      args: {
        doctype: 'Software',
        fields: ['name'],
        filters: { is_active: 1 },
        order_by: 'modified desc',
        limit_page_length: 20
      }
    });
    return (r?.message || []).map((x) => x?.name).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function defaultUserList() {
  try {
    const r = await frappe.call({
      method: 'frappe.client.get_list',
      args: {
        doctype: 'User',
        fields: ['name'],
        filters: { enabled: 1 },
        order_by: 'modified desc',
        limit_page_length: 20
      }
    });
    return (r?.message || []).map((x) => x?.name).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function resolveUserMeta(values) {
  try {
    const arr = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!arr.length) return {};
    // Use website-safe backend API; if user meta isn't permitted, backend will return fallbacks.
    const r = await frappe.call({
      method: 'smart_accounting.api.project_board.get_user_meta',
      args: { users: arr }
    });
    return r?.message || {};
  } catch (e) {
    return {};
  }
}

function normalizeSoftwareInitial(project) {
  const rows = project?.custom_softwares;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => (typeof r === 'string' ? r : (r?.software_name || r?.software || '')))
    .map((s) => String(s || '').trim())
    .filter(Boolean);
}

function normalizeTeamInitial(project, role) {
  const rows = project?.custom_team_members;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((m) => String(m?.role || '').trim() === String(role || '').trim())
    .map((m) => String(m?.user || '').trim())
    .filter(Boolean);
}

function attachmentEditor({ cellEl, project, manager, field, label = 'Upload', autoOpen = false }) {
  const contentEl = cellEl.querySelector('.cell-content') || cellEl;
  const current = project?.[field] || '';
  const safeUrl = current ? escapeHtml(String(current)) : '';
  const displayName = current ? escapeHtml(_fileNameFromUrl(current) || 'Attachment') : '';

  contentEl.innerHTML = `
    <div class="sb-attach">
      ${safeUrl ? `<a class="sb-attach__link sb-attach__link--file" href="${safeUrl}" target="_blank" rel="noopener noreferrer">📎 ${displayName}</a>` : `<span class="text-muted">—</span>`}
      <button type="button" class="sb-attach__btn sb-inline-editor" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</button>
      <input type="file" class="sb-attach__file" style="display:none;" />
      <span class="sb-attach__hint text-muted" style="display:none;">Uploading...</span>
    </div>
  `;

  const btn = contentEl.querySelector('.sb-attach__btn');
  const fileInput = contentEl.querySelector('.sb-attach__file');
  const hint = contentEl.querySelector('.sb-attach__hint');

  const editor = {
    _value: current || '',
    getValue() { return this._value || ''; },
    getInputEl() { return btn; }, // allow manager to bind outside/esc semantics
    focus() { try { btn?.focus?.(); } catch (e) {} },
    destroy() {}
  };

  btn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { fileInput?.click?.(); } catch (e2) {}
  });

  fileInput?.addEventListener('change', async () => {
    const f = fileInput.files?.[0] || null;
    if (!f) return;
    try {
      if (hint) hint.style.display = 'inline';
      // Upload + attach using Frappe builtin
      const msg = await uploadAttachmentToField({
        doctype: 'Project',
        docname: project?.name,
        fieldname: field,
        file: f,
        is_private: 1
      });
      // Prefer file_url; if missing, keep current.
      const url = msg?.file_url || msg?.file_url_full || msg?.file_url_full_path || msg?.file_url_path || '';
      editor._value = url || editor._value || '';
      // Update editor UI immediately (so user sees success without waiting for re-render)
      try {
        const linkEl = contentEl.querySelector('.sb-attach__link--file');
        if (linkEl && editor._value) {
          linkEl.setAttribute('href', String(editor._value));
          linkEl.textContent = `📎 ${_fileNameFromUrl(editor._value) || 'Attachment'}`;
        }
      } catch (e) {}
      // Commit immediately once upload finishes (avoid relying on blur)
      manager?.commitAndClose?.('upload-file');
    } catch (err) {
      console.error(err);
      // keep editor open; user can retry
    } finally {
      if (hint) hint.style.display = 'none';
      // Allow picking the same file again (some browsers won't fire change if the same file is chosen).
      try { fileInput.value = ''; } catch (e) {}
    }
  });

  manager?.bindActiveEditor?.(btn, editor);
  // UX: open file picker immediately on first click-to-edit.
  if (autoOpen) {
    // Defer to next tick so the original click event delegation finishes,
    // and to avoid re-entering EditingManager.startEdit via the synthetic click.
    setTimeout(() => {
      try { fileInput?.click?.(); } catch (e) {}
    }, 0);
  }
  return editor;
}

export function makeProjectColumnSpecs() {
  return [
    // (1) Client Name - read-only for now, but keep interface (spec exists).
    {
      field: 'customer',
      isEditable: false,
      renderCell: ({ project }) => {
        // UI should show human-friendly Client Name:
        // - Prefer backend-attached `customer_name` (Customer.customer_name)
        // - Fallback to `customer` (Customer ID/docname) for compatibility
        const text = escapeHtml(project?.customer_name || project?.customer || '—');
        return `<span class="sb-primary-text">${text}</span>`;
      }
    },

    // (2) Project Name - editable text
    {
      field: 'project_name',
      isEditable: true,
      // Do NOT bulk-sync project_name; it is typically unique per row.
      bulkSync: false,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineTextEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },

    // (3) Status - single select
    {
      field: 'status',
      isEditable: true,
      renderCell: ({ project }) => {
        const v = project?.status;
        if (!v) return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
        const color = STATUS_COLORS[v] || '#6c757d';
        return `
          <span class="status-badge" style="background-color:${escapeHtml(color)};">${escapeHtml(v)}</span>
          <span class="sb-afford sb-afford--select">▾</span>
        `;
      },
      renderEditor: ({ cellEl, project, manager, field }) => statusMenuEditor({ cellEl, project, manager, field })
    },

    // Client Information Update statuses (Project custom Select fields)
    {
      field: 'custom_ato_status',
      isEditable: true,
      renderCell: ({ project }) => {
        const v = project?.custom_ato_status;
        if (!v) return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
        const color = STATUS_COLORS[v] || '#6c757d';
        return `<span class="status-badge" style="background-color:${escapeHtml(color)};">${escapeHtml(v)}</span><span class="sb-afford sb-afford--select">▾</span>`;
      },
      renderEditor: ({ cellEl, project, manager, field }) => projectFieldMenuEditor({ cellEl, project, manager, field })
    },
    {
      field: 'custom_lodgeit_status',
      isEditable: true,
      renderCell: ({ project }) => {
        const v = project?.custom_lodgeit_status;
        if (!v) return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
        const color = STATUS_COLORS[v] || '#6c757d';
        return `<span class="status-badge" style="background-color:${escapeHtml(color)};">${escapeHtml(v)}</span><span class="sb-afford sb-afford--select">▾</span>`;
      },
      renderEditor: ({ cellEl, project, manager, field }) => projectFieldMenuEditor({ cellEl, project, manager, field })
    },
    {
      field: 'custom_company_agent_status',
      isEditable: true,
      renderCell: ({ project }) => {
        const v = project?.custom_company_agent_status;
        if (!v) return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
        const color = STATUS_COLORS[v] || '#6c757d';
        return `<span class="status-badge" style="background-color:${escapeHtml(color)};">${escapeHtml(v)}</span><span class="sb-afford sb-afford--select">▾</span>`;
      },
      renderEditor: ({ cellEl, project, manager, field }) => projectFieldMenuEditor({ cellEl, project, manager, field })
    },
    {
      field: 'custom_xeroquickbooks_status',
      isEditable: true,
      renderCell: ({ project }) => {
        const v = project?.custom_xeroquickbooks_status;
        if (!v) return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
        const color = STATUS_COLORS[v] || '#6c757d';
        return `<span class="status-badge" style="background-color:${escapeHtml(color)};">${escapeHtml(v)}</span><span class="sb-afford sb-afford--select">▾</span>`;
      },
      renderEditor: ({ cellEl, project, manager, field }) => projectFieldMenuEditor({ cellEl, project, manager, field })
    },

    // (4) End Date - date
    {
      field: 'expected_end_date',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineDateEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },

    // (14) Start Date - date
    {
      field: 'expected_start_date',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineDateEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },

    // Reset Date - date
    {
      field: 'custom_reset_date',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineDateEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },

    // Portal Access Expiry Date - date (Smart Grants)
    {
      field: 'custom_portal_access_expiry_date',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineDateEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },
    {
      field: 'custom_ap_submit_date',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineTextEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },
    {
      field: 'custom_industry_approval_date',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineTextEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },
    {
      field: 'custom_tax_lodgement_date',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineTextEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },

    // (5) Notes - textarea expand
    {
      field: 'notes',
      isEditable: true,
      cellClass: 'sb-col-notes',
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineTextareaEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },
    {
      field: 'custom_grants_address_snapshot',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineTextareaEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },
    {
      field: 'custom_grants_primary_communication',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineTextareaEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },
    {
      field: 'custom_grants_status',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineTextareaEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },
    {
      field: 'custom_grants_type',
      isEditable: true,
      renderCell: ({ project }) => {
        const v = project?.custom_grants_type;
        if (!v) return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
        return `${escapeHtml(v)}<span class="sb-afford sb-afford--select">▾</span>`;
      },
      renderEditor: ({ cellEl, project, manager, field }) => projectFieldMenuEditor({ cellEl, project, manager, field })
    },
    {
      field: 'custom_grants_priority',
      isEditable: true,
      renderCell: ({ project }) => {
        const v = project?.custom_grants_priority;
        if (!v) return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
        return `${escapeHtml(v)}<span class="sb-afford sb-afford--select">▾</span>`;
      },
      renderEditor: ({ cellEl, project, manager, field }) => projectFieldMenuEditor({ cellEl, project, manager, field })
    },

    // Smart Grants Check columns: TG Tax Agent, Portal Access Received (2026-04)
    // Backend stores int 0/1; UI surfaces them as Yes/No for accountants.
    {
      field: 'custom_tg_tax_agent',
      isEditable: true,
      renderCell: ({ project }) => _renderYesNoCell(project?.custom_tg_tax_agent),
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const cur = _isCheckYes(project?.[field]) ? '1' : '0';
        const ed = new InlineSelectEditor(contentEl, {
          options: yesNoOptions(),
          initialValue: cur,
        });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },
    {
      field: 'custom_portal_access_received',
      isEditable: true,
      renderCell: ({ project }) => _renderYesNoCell(project?.custom_portal_access_received),
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const cur = _isCheckYes(project?.[field]) ? '1' : '0';
        const ed = new InlineSelectEditor(contentEl, {
          options: yesNoOptions(),
          initialValue: cur,
        });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },

    // (7) Company - editable (Link to Company). Editor uses existing LinkInput.
    {
      field: 'company',
      isEditable: true,
      // Company should behave like a simple selector (monday-style labels), not a search box.
      renderEditor: ({ cellEl, project, manager, field }) => companyMenuEditor({ cellEl, project, manager, field })
    },

    // (8) Lodgement Due - date + confirm on save
    {
      field: 'custom_lodgement_due_date',
      isEditable: true,
      async confirmCommit({ project, value }) {
        const oldV = project?.custom_lodgement_due_date || '';
        if ((oldV || '') === (value || '')) return true;
        return await confirmDialog('Confirm update Lodgement Due Date?');
      },
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineDateEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },

    // (9) Target Month - select
    {
      field: 'custom_target_month',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineSelectEditor(contentEl, {
          options: monthOptionsWithClear(),
          initialValue: project?.[field] || ''
        });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },

    // (13) Priority - select
    {
      field: 'priority',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineSelectEditor(contentEl, {
          options: priorityOptions(),
          initialValue: project?.[field] || ''
        });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },

    // (17) Budget - money
    {
      field: 'estimated_costing',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineMoneyEditor(contentEl, { initialValue: project?.[field] || '' });
        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },

    // (11) Entity - editable via modal (select customer entity row)
    {
      field: 'custom_entity_type',
      isEditable: true,
      // Avoid bulk sync: entity is a "per-project" association; accidental mass changes are risky.
      bulkSync: false,
      renderCell: ({ project }) => {
        const v = String(project?.custom_entity_type || '').trim();
        if (!v) return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
        return `
          <span class="sb-primary-text">${escapeHtml(v)}</span>
          <span class="sb-afford sb-afford--select">▾</span>
        `;
      },
      renderEditor: ({ project, manager }) => {
        const ed = {
          _value: String(project?.custom_entity_type || '').trim(),
          _entityName: String(project?.custom_customer_entity || '').trim(),
          _modal: null,
          getValue() { return this._value; },
          destroy() {
            try { this._modal?.close?.(); } catch (e) {}
            this._modal = null;
          },
        };
        manager?.bindActiveEditor?.(null, ed);

        let picked = false;
        (async () => {
          ed._modal = await openProjectEntityChangeFlow({
            project,
            onSelected: async ({ entityName, entityRow }) => {
              const en = String(entityName || '').trim();
              if (!en) return;
              picked = true;
              ed._entityName = en;
              // Prefer label from selected row (immediate UI refresh)
              const t = String(entityRow?.entity_type || '').trim();
              if (t) ed._value = t;
              await manager?.commitAndClose?.('project-entity-modal');
            },
            onClosed: () => {
              if (picked) return;
              manager?.cancel?.();
            },
          });
        })();

        return ed;
      },
      async commit({ project, projectName, value, store, editor }) {
        const currentEntity = String(project?.custom_customer_entity || '').trim();
        const nextEntity = String(editor?._entityName || '').trim();
        if (!nextEntity) return;
        if (nextEntity === currentEntity) return;
        try {
          const r = await ProjectEntityService.setProjectEntity(projectName, nextEntity);
          const entityType = String(r?.custom_entity_type || value || '').trim();
          store?.commit?.('projects/updateProject', {
            name: projectName,
            custom_customer_entity: String(r?.custom_customer_entity || nextEntity).trim(),
            custom_entity_type: entityType,
          });
          notify('Entity updated', 'green');
        } catch (e) {
          notify(getErrorMessage(e) || 'Update entity failed', 'red');
        }
      },
    },

    // (12) Project Type - editable via modal (double confirm)
    {
      field: 'project_type',
      isEditable: true,
      // Do NOT bulk-sync project_type: it's effectively a "move board" action and too risky to apply to many rows by accident.
      bulkSync: false,
      renderCell: ({ project }) => {
        const v = String(project?.project_type || '').trim();
        if (!v) return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
        return `
          <span class="sb-primary-text">${escapeHtml(v)}</span>
          <span class="sb-afford sb-afford--select">▾</span>
        `;
      },
      renderEditor: ({ project, manager }) => {
        // Modal-based editor: we don't bind blur/enter on an input because focus moves to the modal.
        const ed = {
          _value: String(project?.project_type || '').trim(),
          _modal: null,
          getValue() { return this._value; },
          destroy() {
            try { this._modal?.close?.(); } catch (e) {}
            this._modal = null;
          },
        };
        manager?.bindActiveEditor?.(null, ed);

        let picked = false;
        (async () => {
          ed._modal = await openProjectTypeChangeFlow({
            project,
            onSelected: async (next) => {
              const v = String(next || '').trim();
              if (!v) return;
              picked = true;
              ed._value = v;
              await manager?.commitAndClose?.('project-type-modal');
            },
            onClosed: () => {
              if (picked) return;
              manager?.cancel?.();
            },
          });
        })();

        return ed;
      },
      async commit({ project, projectName, value, store }) {
        const from = String(project?.project_type || '').trim();
        const to = String(value || '').trim();
        if (!to) return;
        if (to === from) return;
        try {
          await ProjectService.updateProject(projectName, { project_type: to });
          store?.commit?.('projects/updateProject', { name: projectName, project_type: to });

          // If we're on a board scoped to one project_type, moving it should remove it from the current list.
          const curBoardType = String(store?.getState?.()?.projects?.lastFilters?.project_type || '').trim();
          if (curBoardType && to !== curBoardType) {
            store?.commit?.('projects/removeProject', projectName);
            // Keep total count roughly consistent (best-effort).
            const total = store?.getState?.()?.projects?.totalCount;
            const n = (total == null) ? null : Number(total);
            if (n != null && Number.isFinite(n)) store?.commit?.('projects/setTotalCount', Math.max(0, n - 1));
          }
          notify(`Project Type updated to ${to}`, 'green');
        } catch (e) {
          notify(getErrorMessage(e) || 'Update Project Type failed', 'red');
        }
      },
    },

    // (15) Frequency - editable via modal (double confirm)
    {
      field: 'custom_project_frequency',
      isEditable: true,
      renderCell: ({ project }) => {
        const v = String(project?.custom_project_frequency || '').trim();
        if (!v) return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
        return `
          <span class="sb-primary-text">${escapeHtml(v)}</span>
          <span class="sb-afford sb-afford--select">▾</span>
        `;
      },
      renderEditor: ({ project, manager }) => {
        // Modal-based editor: focus moves to the modal, so no inputEl binding here.
        const ed = {
          _value: String(project?.custom_project_frequency || '').trim(),
          _modal: null,
          getValue() { return this._value; },
          destroy() {
            try { this._modal?.close?.(); } catch (e) {}
            this._modal = null;
          },
        };
        manager?.bindActiveEditor?.(null, ed);

        let picked = false;
        (async () => {
          ed._modal = await openProjectFrequencyChangeFlow({
            project,
            onSelected: async (next) => {
              const v = String(next || '').trim();
              if (!v) return;
              picked = true;
              ed._value = v;
              await manager?.commitAndClose?.('project-frequency-modal');
            },
            onClosed: () => {
              if (picked) return;
              manager?.cancel?.();
            },
          });
        })();

        return ed;
      },
      async commit({ project, projectName, value, store }) {
        const from = String(project?.custom_project_frequency || '').trim();
        const to = String(value || '').trim();
        if (!to) return;
        if (to === from) return;
        try {
          await ProjectService.updateProject(projectName, { custom_project_frequency: to });
          store?.commit?.('projects/updateProject', { name: projectName, custom_project_frequency: to });
          notify(`Frequency updated to ${to}`, 'green');
        } catch (e) {
          notify(getErrorMessage(e) || 'Update frequency failed', 'red');
        }
      },
    },

    // (16) Fiscal Year
    {
      field: 'custom_fiscal_year',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const contentEl = cellEl.querySelector('.cell-content') || cellEl;
        const ed = new InlineMenuSelectEditor(contentEl, {
          options: [{ value: project?.[field] || '', label: project?.[field] || '—' }].filter((x) => x.value),
          initialValue: project?.[field] || ''
        });

        contentEl.addEventListener('sb:menu-select', (e) => {
          e.stopPropagation?.();
          manager?.commitAndClose?.('menu-select');
        }, { once: true });
        contentEl.addEventListener('sb:menu-close', () => {
          manager?.commitAndClose?.('menu-close');
        }, { once: true });

        getFiscalYearOptions().then((opts) => {
          if (!contentEl?.isConnected) return;
          if (Array.isArray(opts) && opts.length) {
            ed.options = opts.map((x) => ({ value: x, label: x }));
            ed.render();
            mountEditorHelpers(manager, contentEl, ed);
          } else {
            try { ed.destroy?.(); } catch (e2) {}
            linkEditor({ cellEl, project, field, manager, doctype: 'Fiscal Year', placeholder: 'Search Fiscal Year...' });
          }
        });

        mountEditorHelpers(manager, contentEl, ed);
        return ed;
      }
    },
    {
      field: 'custom_year_end',
      isEditable: true,
      renderCell: ({ project }) => {
        const v = String(project?.custom_year_end || '').trim();
        if (!v) return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
        return `<span class="status-badge" style="background-color:#475569;">${escapeHtml(v)}</span><span class="sb-afford sb-afford--select">▾</span>`;
      },
      renderEditor: ({ cellEl, project, manager, field }) => projectFieldMenuEditor({ cellEl, project, manager, field }),
      async commit({ project, projectName, value, store }) {
        const to = String(value || '').trim();
        const from = String(project?.custom_year_end || '').trim();
        if (!to || to === from) return;
        try {
          const r = await ProjectEntityService.setProjectYearEnd(projectName, to);
          store?.commit?.('projects/updateProject', {
            name: projectName,
            custom_year_end: String(r?.custom_year_end || to).trim(),
            custom_customer_entity: String(r?.custom_customer_entity || project?.custom_customer_entity || '').trim(),
            custom_entity_type: String(r?.custom_entity_type || project?.custom_entity_type || '').trim(),
          });
          notify('Year End updated', 'green');
        } catch (e) {
          notify(getErrorMessage(e) || 'Update Year End failed', 'red');
        }
      },
    },

    // (20) System/meta fields that should never be edited from the board
    // - They are either computed, managed by the system, or not part of the Smart Board editing UX yet.
    {
      field: 'modified',
      isEditable: false,
      renderCell: ({ project }) => {
        const text = escapeHtml(formatDate(project?.modified) || '—');
        const pn = escapeHtml(project?.name || '');
        return `<button type="button" class="sb-activity-open-btn" data-project-name="${pn}" title="Open activity log">${text}</button>`;
      }
    },

    { field: 'is_active', isEditable: false },
    { field: 'custom_customer_entity', isEditable: false },
    { field: 'custom_team_members', isEditable: false },

    // (6) Software - complex (Table MultiSelect) => later spec will override editor+commit
    {
      field: 'custom_softwares',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager }) => multiLinkEditor({
        cellEl,
        project,
        manager,
        doctype: 'Software',
        placeholder: 'Search software...',
        initialValues: normalizeSoftwareInitial(project),
        defaultList: defaultSoftwareList
      }),
      async commit({ projectName, value, store }) {
        const softwares = Array.isArray(value) ? value : [];
        const r = await frappe.call({
          method: 'smart_accounting.api.project_board.set_project_softwares',
          args: { project: projectName, softwares }
        });
        const msg = r?.message || {};
        const updated = msg?.custom_softwares || [];
        // Update store for UI refresh
        if (store?.commit) store.commit('projects/updateProject', { name: projectName, custom_softwares: updated });
      }
      ,
      async commitBulk({ projects, value, store }) {
        const names = Array.isArray(projects) ? projects.filter(Boolean) : [];
        const softwares = Array.isArray(value) ? value : [];
        if (!names.length) return;
        const r = await frappe.call({
          method: 'smart_accounting.api.project_board.bulk_set_project_softwares',
          args: { projects: names, softwares }
        });
        const msg = r?.message || {};
        const map = msg?.softwares || {};
        for (const p of names) {
          const updated = map?.[p] || [];
          if (store?.commit) store.commit('projects/updateProject', { name: p, custom_softwares: updated });
        }
      }
    },

    // (18) Engagement Letter - Attach (upload via Frappe builtin)
    {
      field: 'custom_engagement_letter',
      isEditable: true,
      // Attach upload should not be bulk-synced by default (would copy the same file_url to many Projects).
      bulkSync: false,
      // IMPORTANT:
      // Upload is performed inside the editor (via /api/method/upload_file), but the Attach field
      // still must be written back to Project to persist in the form view.
      // We provide a custom commit so EditingManager will NOT short-circuit due to "unchanged"
      // (because we may update UI optimistically).
      async commit({ projectName, field, value, store }) {
        if (!projectName || !field) return;
        const v = String(value || '').trim();
        // Persist to backend (set_value) + update store
        if (store?.dispatch) {
          await store.dispatch('projects/updateProjectField', { name: projectName, field, value: v });
        } else if (store?.commit) {
          store.commit('projects/updateProject', { name: projectName, [field]: v });
        }
      },
      renderCell: ({ project }) => {
        const v = project?.custom_engagement_letter;
        if (!v) return '<span class="sb-attach-pill">Upload</span>';
        const url = escapeHtml(String(v));
        const name = escapeHtml(_fileNameFromUrl(v) || 'Engagement Letter');
        return `<a class="sb-attach__link sb-attach__link--file" href="${url}" target="_blank" rel="noopener noreferrer">📎 ${name}</a> <span class="sb-attach-pill sb-attach-pill--subtle">Replace</span>`;
      },
      renderEditor: ({ cellEl, project, manager, field }) => attachmentEditor({
        cellEl,
        project,
        manager,
        field,
        label: (project?.[field] ? 'Replace' : 'Upload'),
        autoOpen: true
      })
    },

    // (19) Team by role derived columns: team:<Role> => later editor
    {
      fieldPrefix: 'team:',
      isEditable: true,
      renderEditor: ({ cellEl, project, manager, field }) => {
        const role = String(field || '').slice('team:'.length);
        return multiLinkEditor({
          cellEl,
          project,
          manager,
          doctype: 'User',
          placeholder: `Search users...`,
          initialValues: normalizeTeamInitial(project, role),
          defaultList: defaultUserList,
          resolveMeta: resolveUserMeta
        });
      },
      async commit({ project, projectName, field, value, store }) {
        const role = String(field || '').slice('team:'.length);
        const selectedUsers = Array.isArray(value) ? value : [];

        const existing = Array.isArray(project?.custom_team_members) ? project.custom_team_members : [];
        const kept = existing
          .filter((m) => String(m?.role || '').trim() !== String(role || '').trim())
          .map((m) => ({ user: m?.user, role: m?.role }))
          .filter((m) => m?.user && m?.role);

        const next = kept.concat(selectedUsers.map((u) => ({ user: u, role })));

        const r = await frappe.call({
          method: 'smart_accounting.api.project_board.set_project_team_members',
          args: { project: projectName, members: next }
        });
        const msg = r?.message || {};
        const updated = msg?.custom_team_members || [];
        if (store?.commit) store.commit('projects/updateProject', { name: projectName, custom_team_members: updated });
      }
      ,
      async commitBulk({ projects, field, value, store }) {
        const role = String(field || '').slice('team:'.length);
        const names = Array.isArray(projects) ? projects.filter(Boolean) : [];
        const users = Array.isArray(value) ? value : [];
        if (!role || !names.length) return;
        const r = await frappe.call({
          method: 'smart_accounting.api.project_board.bulk_set_project_team_role',
          args: { projects: names, role, users }
        });
        const msg = r?.message || {};
        const map = msg?.team || {};
        for (const p of names) {
          const updated = map?.[p] || [];
          if (store?.commit) store.commit('projects/updateProject', { name: p, custom_team_members: updated });
        }
      }
    },
  ];
}


