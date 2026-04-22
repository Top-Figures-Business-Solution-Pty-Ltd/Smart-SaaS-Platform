/**
 * AutomationModal (Monday-like)
 * - Left: saved automation list
 * - Right: edit selected automation
 * - Each rule: When [trigger] → Then [action1] And [action2] ...
 * - Website-safe (Modal + native HTML)
 */
import { escapeHtml } from '../../utils/dom.js';
import { Modal } from '../Common/Modal.js';
import { AutomationLogService } from '../../services/automationLogService.js';
import { BoardSettingsService } from '../../services/boardSettingsService.js';
import { notify } from '../../services/uiAdapter.js';

export class AutomationModal {
  constructor({ meta = {}, items = [], totalCount = 0, pageSize = 50, onLoadMore, onSave, onToggle, onDelete, onOpenProject, onOpenLogs, onClose } = {}) {
    this.meta = meta || {};
    this.items = Array.isArray(items) ? items.map((it) => ({
      ...it,
      automation_name: String(it?.automation_name || '').trim(),
      triggers: this._normalizeTriggers(it),
      actions: Array.isArray(it.actions) ? [...it.actions] : [],
    })) : [];
    this.onSave = onSave || (async () => {});
    this.onToggle = onToggle || (async () => {});
    this.onDelete = onDelete || (async () => {});
    this.onLoadMore = onLoadMore || (async () => ({ items: [], meta: {} }));
    this.onOpenProject = onOpenProject || (() => {});
    this.onOpenLogs = onOpenLogs || (() => {});
    this.onClose = onClose || (() => {});

    this._modal = null;
    this._root = null;
    this._saving = false;
    this._activeIdx = this.items.length ? 0 : -1;
    this._activeSpecialKey = '';
    this._savedSearch = '';
    this._logsByAutomation = new Map();
    this._loadingRunsFor = '';
    this._savedTotalCount = Math.max(Number(totalCount) || 0, this._persistedItemsCount());
    this._savedPageSize = Math.max(1, Number(pageSize) || 50);
    this._loadingMoreSaved = false;
    // Special-rule flags: { [key]: { enabled: boolean, loaded: boolean, saving: boolean } }
    this._specialRuleFlags = {
      'monthly-due-dates': { enabled: true, loaded: false, saving: false },
    };
  }

  open() {
    this.close();

    const content = document.createElement('div');
    content.className = 'sb-automation';
    content.innerHTML = `
      <div class="sb-automation__hint text-muted">
        Configure automations: When a trigger fires → execute actions automatically.
      </div>
      <div class="sb-automation__list" id="sbAutoList"></div>
    `;

    this._modal = new Modal({
      title: 'Automations',
      contentEl: content,
      modalClass: 'sb-modal--automation',
      onClose: () => this.onClose(),
    });
    this._modal.open();
    this._root = content;

    this._renderList();
    if (this._isProbablyAdmin()) {
      this._ensureSpecialRuleFlagLoaded('monthly-due-dates');
    }
  }

  close() {
    this._modal?.close?.();
    this._modal = null;
    this._root = null;
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  _renderList() {
    const wrap = this._root?.querySelector('#sbAutoList');
    if (!wrap) return;

    if (!this.items.length) this._activeIdx = -1;
    if (this._activeIdx >= this.items.length) this._activeIdx = this.items.length - 1;

    const savedRows = this._getFilteredSavedItems();
    const showSpecial = this._isProbablyAdmin();
    wrap.innerHTML = `
      <div class="sb-auto__layout">
        <div class="sb-auto__left">
          <div class="sb-auto__saved">
            <div class="sb-auto__saved-title">Saved Automations</div>
            <input
              class="form-control sb-auto__saved-search"
              id="sbAutoSavedSearch"
              type="text"
              placeholder="Search automation..."
              value="${escapeHtml(this._savedSearch)}"
            />
            <div class="text-muted" style="font-size:12px; margin:8px 0;">${this._savedSummaryText()}</div>
            <div class="sb-auto__saved-list" id="sbAutoSavedList">
              ${savedRows.length ? savedRows.map(({ item, idx }) => this._savedItemHTML(item, idx)).join('') : this._emptySavedStateHTML()}
            </div>
            <div style="display:flex; justify-content:center; margin-top:8px;">
              <button class="btn btn-default btn-sm" type="button" id="sbAutoLoadMore" ${this._loadingMoreSaved || !this._hasMoreSavedItems() ? 'disabled' : ''} style="${this._hasMoreSavedItems() ? '' : 'display:none;'}">${this._loadingMoreSaved ? 'Loading...' : 'Load more'}</button>
            </div>
            <button class="btn btn-default btn-sm" type="button" id="sbAutoAdd">+ Add Automation</button>
          </div>
          ${showSpecial ? this._specialRulesSidebarHTML() : ''}
        </div>
        <div class="sb-auto__editor" id="sbAutoEditor">
          ${this._editorHTML()}
        </div>
      </div>
    `;
    wrap.querySelector('#sbAutoAdd')?.addEventListener('click', () => this._addNew());
    wrap.querySelector('#sbAutoLoadMore')?.addEventListener('click', async () => {
      await this._handleLoadMoreSaved();
    });
    wrap.querySelector('#sbAutoSavedSearch')?.addEventListener('input', (e) => {
      this._savedSearch = String(e?.target?.value || '');
      this._renderList();
    });
    wrap.querySelectorAll('.sb-auto__saved-item').forEach((el) => {
      el.addEventListener('click', (e) => this._handleSelectSavedItem(e));
    });
    wrap.querySelectorAll('.sb-auto__special-item').forEach((el) => {
      el.addEventListener('click', (e) => this._handleSelectSpecialRule(e));
    });
    wrap.querySelectorAll('.sb-auto__special-toggle').forEach((el) => {
      el.addEventListener('change', (e) => this._handleToggleSpecialRule(e));
    });
    wrap.querySelectorAll('.sb-auto__run-open').forEach((el) => {
      el.addEventListener('click', (e) => this._handleOpenProject(e));
    });
    wrap.querySelectorAll('.sb-auto__runs-open-all').forEach((el) => {
      el.addEventListener('click', (e) => this._handleOpenLogs(e));
    });
    const editor = wrap.querySelector('#sbAutoEditor');
    if (editor && !this._activeSpecialKey) this._bindRuleEvents(editor);
    if (!this._activeSpecialKey) this._ensureActiveRunsLoaded();
  }

  _savedItemHTML(item, idx) {
    const active = idx === this._activeIdx;
    const name = this._displayName(item, idx);
    const state = item.enabled ? 'ON' : 'OFF';
    return `
      <button type="button" class="sb-auto__saved-item ${active ? 'is-active' : ''}" data-idx="${idx}">
        <span class="sb-auto__saved-name">${escapeHtml(name)}</span>
        <span class="sb-auto__saved-state">${state}</span>
      </button>
    `;
  }

  _persistedItemsCount() {
    return (this.items || []).filter((item) => String(item?.name || '').trim()).length;
  }

  _hasMoreSavedItems() {
    return this._persistedItemsCount() < this._savedTotalCount;
  }

  _savedSummaryText() {
    return `Showing ${this._persistedItemsCount()} of ${Math.max(this._persistedItemsCount(), this._savedTotalCount)} saved automations`;
  }

  _emptySavedStateHTML() {
    if (this._savedSearch && this._hasMoreSavedItems()) {
      return '<div class="text-muted" style="font-size:12px; padding:6px;">No matching loaded automations. Load more to keep searching.</div>';
    }
    return '<div class="text-muted" style="font-size:12px; padding:6px;">No matching automations.</div>';
  }

  _editorHTML() {
    if (this._activeSpecialKey) {
      return this._specialRuleDetailHTML(this._activeSpecialKey);
    }
    if (this._activeIdx < 0 || !this.items[this._activeIdx]) {
      return `
        <div class="sb-automation__empty text-muted">
          No automations configured yet. Click "+ Add Automation" to create one.
        </div>
      `;
    }
    return this._ruleHTML(this.items[this._activeIdx], this._activeIdx);
  }

  // =========================================================================
  // Special Rules (admin-only placeholders for future configurable rules)
  // =========================================================================

  _getSpecialRules() {
    const monthlyFlag = this._specialRuleFlags?.['monthly-due-dates'];
    const monthlyStatus = monthlyFlag?.enabled === false ? 'Off' : 'Active';
    return [
      {
        key: 'quarterly-due-dates',
        name: 'Quarterly Due Date Rules',
        scope: 'BAS / IAS',
        status: 'In development',
      },
      {
        key: 'monthly-due-dates',
        name: 'Monthly Due Date Rules',
        scope: 'IAS',
        status: monthlyStatus,
      },
    ];
  }

  _specialRulesSidebarHTML() {
    const rules = this._getSpecialRules();
    const items = rules.map((r) => {
      const active = r.key === this._activeSpecialKey ? 'is-active' : '';
      return `
        <button type="button" class="sb-auto__special-item ${active}" data-key="${escapeHtml(r.key)}">
          <span class="sb-auto__special-name">${escapeHtml(r.name)}</span>
          <span class="sb-auto__special-state">${escapeHtml(r.status)}</span>
        </button>
      `;
    }).join('');
    return `
      <div class="sb-auto__special">
        <div class="sb-auto__saved-title">Special Rules</div>
        <div class="text-muted" style="font-size:12px;">Admin-only, applied by scheduled automations.</div>
        <div class="sb-auto__special-list">
          ${items}
        </div>
      </div>
    `;
  }

  _specialRuleDetailHTML(key) {
    const rules = this._getSpecialRules();
    const rule = rules.find((r) => r.key === key);
    if (!rule) {
      return `<div class="sb-automation__empty text-muted">Unknown special rule.</div>`;
    }
    if (key === 'quarterly-due-dates') {
      return `
        <div class="sb-cardlike">
          <div class="sb-cardlike__title">${escapeHtml(rule.name)}</div>
          <div class="sb-settings__hint-badge">In development</div>
          <p class="text-muted" style="margin-top:12px;">
            Scope: BAS and IAS projects on a Quarterly frequency.
          </p>
          <p class="text-muted" style="margin-top:8px;">
            Current behaviour (built into the <code>Roll Lodgement Due forward by frequency</code> automation action):
          </p>
          <ul class="text-muted" style="margin:8px 0 0 18px; padding:0;">
            <li>Before 26 May 2026 — rolls to 26 May 2026 (FY 2025-26 Q3).</li>
            <li>From 26 May 2026 up to 25 August 2026 — rolls to 25 August 2026 (FY 2025-26 Q4).</li>
            <li>On or after 25 August 2026 — rollover stops and a warning is shown to the user.</li>
          </ul>
          <p class="text-muted" style="margin-top:12px;">
            Future versions will let administrators maintain BAS / IAS quarterly due dates per fiscal year from this section, without requiring a code release.
          </p>
        </div>
      `;
    }
    if (key === 'monthly-due-dates') {
      const flag = this._specialRuleFlags?.['monthly-due-dates'] || { enabled: true, loaded: false, saving: false };
      const enabled = flag.enabled !== false;
      const badgeLabel = enabled ? 'Active' : 'Off';
      const toggleChecked = enabled ? 'checked' : '';
      const toggleDisabled = flag.saving ? 'disabled' : '';
      const stateLabel = flag.saving ? 'Saving…' : (enabled ? 'Rule is ON' : 'Rule is OFF');
      return `
        <div class="sb-cardlike">
          <div class="sb-cardlike__title">${escapeHtml(rule.name)}</div>
          <div class="sb-settings__hint-badge">${escapeHtml(badgeLabel)}</div>
          <div style="margin-top:12px; display:flex; align-items:center; gap:10px;">
            <label class="sb-automation__toggle" style="margin:0;">
              <input type="checkbox" class="sb-auto__special-toggle" data-key="monthly-due-dates" ${toggleChecked} ${toggleDisabled} />
              <span class="sb-automation__toggle-label">${escapeHtml(stateLabel)}</span>
            </label>
            <span class="text-muted" style="font-size:12px;">Admins can switch this rule off if it misbehaves.</span>
          </div>
          <p class="text-muted" style="margin-top:12px;">
            Scope: IAS projects on a Monthly frequency.
          </p>
          <p class="text-muted" style="margin-top:8px;">
            Behaviour: when an automation would move <code>Target Month</code> or <code>Lodgement Due Date</code> to April, July, October, or January, the rule pushes it forward by one more month (to May, August, November, or February). Those four months are already covered by the quarterly BAS lodgement, so there is no separate IAS monthly work to do — the rule skips them instead of scheduling duplicate work.
          </p>
          <p class="text-muted" style="margin-top:8px;">
            Applies to both the <code>Roll Lodgement Due forward by frequency</code> and <code>Push a date</code> automation actions.
          </p>
        </div>
      `;
    }
    return `<div class="sb-automation__empty text-muted">${escapeHtml(rule.name)} — details coming soon.</div>`;
  }

  _handleSelectSpecialRule(e) {
    this._syncActiveRuleFromDOM();
    const key = String(e.currentTarget?.dataset?.key || '').trim();
    if (!key) return;
    this._activeSpecialKey = key;
    this._activeIdx = -1;
    this._renderList();
    this._ensureSpecialRuleFlagLoaded(key);
  }

  async _ensureSpecialRuleFlagLoaded(key) {
    const flag = this._specialRuleFlags?.[key];
    if (!flag || flag.loaded || flag.loading) return;
    const backendKey = this._backendKeyForSpecialRule(key);
    if (!backendKey) return;
    flag.loading = true;
    try {
      const resp = await BoardSettingsService.getSpecialRuleFlag(backendKey);
      flag.enabled = resp?.enabled !== false;
      flag.loaded = true;
    } catch (e) {
      flag.enabled = true;
      flag.loaded = true;
    } finally {
      flag.loading = false;
      if (this._activeSpecialKey === key) this._renderList();
    }
  }

  _backendKeyForSpecialRule(key) {
    if (key === 'monthly-due-dates') return 'monthly_ias_defer';
    return '';
  }

  async _handleToggleSpecialRule(e) {
    const el = e?.currentTarget;
    const key = String(el?.dataset?.key || '').trim();
    if (!key) return;
    const flag = this._specialRuleFlags?.[key];
    if (!flag || flag.saving) {
      if (el) el.checked = flag?.enabled !== false;
      return;
    }
    const backendKey = this._backendKeyForSpecialRule(key);
    if (!backendKey) return;
    const nextEnabled = !!el.checked;
    const prevEnabled = flag.enabled !== false;
    flag.enabled = nextEnabled;
    flag.saving = true;
    this._renderList();
    try {
      const resp = await BoardSettingsService.setSpecialRuleFlag(backendKey, nextEnabled);
      flag.enabled = resp?.enabled !== false;
      flag.loaded = true;
      notify(`${nextEnabled ? 'Enabled' : 'Disabled'} "Monthly Due Date Rules".`, nextEnabled ? 'green' : 'orange');
    } catch (err) {
      flag.enabled = prevEnabled;
    } finally {
      flag.saving = false;
      this._renderList();
    }
  }

  _isProbablyAdmin() {
    try {
      const user = String(frappe?.session?.user || '').trim();
      if (user === 'Administrator') return true;
    } catch (e) {}
    try {
      const roles = (frappe?.boot?.user?.roles) || frappe?.user_roles || [];
      if (Array.isArray(roles) && roles.map(String).includes('System Manager')) return true;
    } catch (e) {}
    return false;
  }

  _ruleHTML(item, idx) {
    const enabled = item.enabled ? 'checked' : '';
    const name = item.name || '';
    const automationName = String(item.automation_name || '').trim();
    const saveBlockedReason = this._getRuleSaveBlockReason(item);
    const saveDisabled = saveBlockedReason ? 'disabled' : '';
    const triggerRows = Array.isArray(item.triggers) && item.triggers.length
      ? item.triggers
      : [{ trigger_type: '', config: {} }];
    const actions = Array.isArray(item.actions) ? item.actions : [];
    const triggersHTML = triggerRows.map((t, ti) => this._triggerRowHTML(t, idx, ti, ti > 0)).join('');

    // Actions rows
    const actionsHTML = actions.length
      ? actions.map((a, ai) => this._actionRowHTML(a, idx, ai, ai > 0)).join('')
      : this._actionRowHTML({}, idx, 0, false);

    return `
      <div class="sb-automation__rule" data-idx="${idx}" data-name="${escapeHtml(name)}">
        <div class="sb-automation__rule-header">
          <label class="sb-automation__toggle">
            <input type="checkbox" class="sb-auto__enabled" data-idx="${idx}" ${enabled} />
            <span class="sb-automation__toggle-label">${enabled ? 'ON' : 'OFF'}</span>
          </label>
          <button class="btn btn-danger btn-sm sb-auto__delete" data-idx="${idx}" type="button" title="Delete">Delete</button>
        </div>
        <div class="sb-automation__rule-body">
          <div class="sb-automation__row">
            <span class="sb-automation__label">Name</span>
            <input class="form-control sb-auto__name" data-idx="${idx}" type="text" maxlength="140" placeholder="Automation name" value="${escapeHtml(automationName)}" />
          </div>
          ${triggersHTML}
          <div class="sb-automation__rule-actions-bar">
            <button class="btn btn-default btn-sm sb-auto__add-trigger" data-idx="${idx}" type="button">+ And Trigger</button>
          </div>
          ${actionsHTML}
        </div>
        <div class="sb-automation__rule-actions-bar">
          <button class="btn btn-default btn-sm sb-auto__add-action" data-idx="${idx}" type="button">+ And</button>
        </div>
        <div class="sb-automation__rule-footer">
          <button class="btn btn-primary btn-sm sb-auto__save" data-idx="${idx}" type="button" ${saveDisabled} title="${escapeHtml(saveBlockedReason || 'Save automation')}">Save</button>
          <button class="btn btn-default btn-sm sb-auto__save-as" data-idx="${idx}" type="button" ${saveDisabled} title="${escapeHtml(saveBlockedReason || 'Save as new automation')}">Save as</button>
          ${item.execution_count ? `<span class="text-muted" style="font-size:11px;">Executed ${item.execution_count} times</span>` : ''}
        </div>
        ${this._recentRunsHTML(item)}
        ${saveBlockedReason ? `<div style="margin-top:8px; font-size:12px; color:#b45309;">${escapeHtml(saveBlockedReason)}</div>` : ''}
      </div>
    `;
  }

  _recentRunsHTML(item) {
    const key = String(item?.name || '').trim();
    if (!key) {
      return `
        <div class="sb-auto__runs">
          <div class="sb-auto__runs-head">
            <div class="sb-auto__runs-title">Recent Runs</div>
          </div>
          <div class="text-muted" style="font-size:12px;">Save this automation first to view execution logs.</div>
        </div>
      `;
    }

    const rows = this._logsByAutomation.get(key) || null;
    if (this._loadingRunsFor === key && !rows) {
      return `
        <div class="sb-auto__runs">
          <div class="sb-auto__runs-head">
            <div class="sb-auto__runs-title">Recent Runs</div>
            <button type="button" class="btn btn-default btn-xs sb-auto__runs-open-all" data-automation="${escapeHtml(key)}">View all logs</button>
          </div>
          <div class="text-muted" style="font-size:12px;">Loading runs...</div>
        </div>
      `;
    }

    if (!rows || !rows.length) {
      return `
        <div class="sb-auto__runs">
          <div class="sb-auto__runs-head">
            <div class="sb-auto__runs-title">Recent Runs</div>
            <button type="button" class="btn btn-default btn-xs sb-auto__runs-open-all" data-automation="${escapeHtml(key)}">View all logs</button>
          </div>
          <div class="text-muted" style="font-size:12px;">No runs yet.</div>
        </div>
      `;
    }

    const items = rows.map((row) => {
      const result = String(row?.result || '').trim();
      const source = String(row?.execution_source || '').trim();
      const project = String(row?.project_title || row?.project || '').trim();
      const projectName = String(row?.project || '').trim();
      const projectType = String(row?.project_type || '').trim();
      const message = String(row?.message || '').trim();
      const changed = Number(row?.changed_field_count || 0);
      const when = String(row?.triggered_at || '').replace('T', ' ').slice(0, 19);
      return `
        <div class="sb-auto__run-item">
          <div class="sb-auto__run-head">
            <span class="sb-auto__run-result sb-auto__run-result--${escapeHtml(result.toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(result || 'Unknown')}</span>
            <span class="sb-auto__run-when">${escapeHtml(when)}</span>
          </div>
          <div class="sb-auto__run-project">
            <span>${escapeHtml(project || 'Unknown project')}</span>
            ${projectType ? `<span class="sb-auto__run-type">${escapeHtml(projectType)}</span>` : ''}
          </div>
          <div class="sb-auto__run-meta">${escapeHtml(source || 'validate')}${changed ? ` · ${escapeHtml(String(changed))} field${changed > 1 ? 's' : ''}` : ''}</div>
          ${message ? `<div class="sb-auto__run-message">${escapeHtml(message)}</div>` : ''}
          ${projectName ? `<div class="sb-auto__run-actions"><button type="button" class="btn btn-default btn-xs sb-auto__run-open" data-project="${escapeHtml(projectName)}" data-project-type="${escapeHtml(projectType)}" data-project-title="${escapeHtml(project)}">Open project</button></div>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="sb-auto__runs">
        <div class="sb-auto__runs-head">
          <div class="sb-auto__runs-title">Recent Runs</div>
          <button type="button" class="btn btn-default btn-xs sb-auto__runs-open-all" data-automation="${escapeHtml(key)}">View all logs</button>
        </div>
        <div class="sb-auto__runs-list">${items}</div>
      </div>
    `;
  }

  _triggerRowHTML(trigger, ruleIdx, triggerIdx, showAnd) {
    const allTriggers = this.meta?.triggers || {};
    const triggerType = trigger?.trigger_type || '';
    const triggerConfig = trigger?.config || {};
    const triggerOpts = Object.entries(allTriggers)
      .filter(([, v]) => !v?.hidden)
      .map(([k, v]) =>
      `<option value="${escapeHtml(k)}" ${k === triggerType ? 'selected' : ''}>${escapeHtml(v.label || k)}</option>`
    ).join('');
    const configHTML = this._configFieldsHTML(allTriggers[triggerType], triggerConfig, `trigger_${ruleIdx}_${triggerIdx}`);
    const andLabel = showAnd ? '<span class="sb-automation__and-label">And</span>' : '<span class="sb-automation__label">When</span>';
    const removeBtn = showAnd
      ? `<button class="btn btn-default sb-auto__remove-trigger" data-idx="${ruleIdx}" data-tidx="${triggerIdx}" type="button" title="Remove">×</button>`
      : '';
    return `
      <div class="sb-automation__row sb-automation__trigger-row" data-idx="${ruleIdx}" data-tidx="${triggerIdx}">
        ${andLabel}
        <select class="form-control sb-auto__trigger-type" data-idx="${ruleIdx}" data-tidx="${triggerIdx}">
          <option value="" disabled ${!triggerType ? 'selected' : ''}>Select trigger</option>
          ${triggerOpts}
        </select>
        ${configHTML}
        ${removeBtn}
      </div>
    `;
  }

  _actionRowHTML(action, ruleIdx, actionIdx, showAnd) {
    const allActions = this.meta?.actions || {};
    const actionType = action?.action_type || '';
    const actionConfig = action?.config || {};

    const actionOpts = Object.entries(allActions).map(([k, v]) =>
      `<option value="${escapeHtml(k)}" ${k === actionType ? 'selected' : ''}>${escapeHtml(v.label || k)}</option>`
    ).join('');

    const resolvedMeta = this._resolveActionMetaForRender(actionType, actionConfig, allActions[actionType]);
    const configHTML = this._configFieldsHTML(resolvedMeta, actionConfig, `action_${ruleIdx}_${actionIdx}`);

    const andLabel = showAnd ? '<span class="sb-automation__and-label">And</span>' : '<span class="sb-automation__label">Then</span>';
    const removeBtn = showAnd
      ? `<button class="btn btn-default sb-auto__remove-action" data-idx="${ruleIdx}" data-aidx="${actionIdx}" type="button" title="Remove">×</button>`
      : '';

    return `
      <div class="sb-automation__row sb-automation__action-row" data-idx="${ruleIdx}" data-aidx="${actionIdx}">
        ${andLabel}
        <select class="form-control sb-auto__action-type" data-idx="${ruleIdx}" data-aidx="${actionIdx}">
          <option value="" disabled ${!actionType ? 'selected' : ''}>Select action</option>
          ${actionOpts}
        </select>
        ${configHTML}
        ${removeBtn}
      </div>
    `;
  }

  _resolveActionMetaForRender(actionType, actionConfig, rawMeta) {
    const base = rawMeta ? { ...rawMeta } : null;
    if (!base || !Array.isArray(base.config_fields)) return base;
    if (String(actionType || '').trim() !== 'push_date') return base;

    const pickedField = String(actionConfig?.date_field || '').trim();
    const fields = base.config_fields.map((cf) => ({ ...cf }));
    if (pickedField !== 'custom_target_month') {
      base.config_fields = fields;
      return base;
    }

    base.config_fields = fields.map((cf) => {
      if (String(cf?.key || '') !== 'period') return cf;
      const monthOpts = Array.from({ length: 12 }).map((_, i) => {
        const n = i + 1;
        return { value: String(n), label: `${n} month${n > 1 ? 's' : ''}` };
      });
      return {
        ...cf,
        label: 'Push by',
        options: [{ value: 'frequency', label: 'frequency' }].concat(monthOpts),
        default: '1',
      };
    });
    return base;
  }

  _configFieldsHTML(typeMeta, config, prefix) {
    if (!typeMeta?.config_fields?.length) return '';

    return typeMeta.config_fields.map((cf) => {
      const key = cf.key || '';
      const currentVal = config?.[key] ?? cf.default ?? '';
      const id = `${prefix}_${key}`;

      if (cf.type === 'select' && Array.isArray(cf.options)) {
        const opts = cf.options.map((o) => {
          const val = typeof o === 'string' ? o : (o.value || '');
          const label = typeof o === 'string' ? o : (o.label || val);
          return `<option value="${escapeHtml(val)}" ${val === currentVal ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        }).join('');
        return `
          <select class="form-control sb-auto__config" data-prefix="${escapeHtml(prefix)}" data-key="${escapeHtml(key)}" id="${escapeHtml(id)}">
            <option value="" disabled ${!currentVal ? 'selected' : ''}>${escapeHtml(cf.label || key)}</option>
            ${opts}
          </select>
        `;
      }

      return `
        <input class="form-control sb-auto__config" type="text"
          data-prefix="${escapeHtml(prefix)}" data-key="${escapeHtml(key)}" id="${escapeHtml(id)}"
          placeholder="${escapeHtml(cf.label || key)}" value="${escapeHtml(String(currentVal))}" />
      `;
    }).join('');
  }

  // =========================================================================
  // Events
  // =========================================================================

  _bindRuleEvents(wrap) {
    wrap.querySelectorAll('.sb-auto__enabled').forEach((el) => {
      el.addEventListener('change', (e) => this._handleToggle(e));
    });
    wrap.querySelectorAll('.sb-auto__delete').forEach((el) => {
      el.addEventListener('click', (e) => this._handleDelete(e));
    });
    wrap.querySelectorAll('.sb-auto__save').forEach((el) => {
      el.addEventListener('click', (e) => this._handleSave(e));
    });
    wrap.querySelectorAll('.sb-auto__save-as').forEach((el) => {
      el.addEventListener('click', (e) => this._handleSaveAs(e));
    });
    wrap.querySelectorAll('.sb-auto__name').forEach((el) => {
      el.addEventListener('input', (e) => this._handleNameInput(e));
    });
    wrap.querySelectorAll('.sb-auto__config').forEach((el) => {
      el.addEventListener('change', (ev) => {
        this._syncActiveRuleFromDOM();
        const key = String(ev?.target?.dataset?.key || '').trim();
        const prefix = String(ev?.target?.dataset?.prefix || '').trim();
        // Re-render action row when push_date date_field changes so period options
        // can switch between normal intervals and 1..12 target-month choices.
        if (key === 'date_field' && prefix.startsWith('action_')) {
          this._renderList();
        }
      });
      el.addEventListener('input', () => this._syncActiveRuleFromDOM());
    });
    wrap.querySelectorAll('.sb-auto__trigger-type').forEach((el) => {
      el.addEventListener('change', (e) => this._handleTriggerTypeChange(e));
    });
    wrap.querySelectorAll('.sb-auto__add-trigger').forEach((el) => {
      el.addEventListener('click', (e) => this._handleAddTrigger(e));
    });
    wrap.querySelectorAll('.sb-auto__remove-trigger').forEach((el) => {
      el.addEventListener('click', (e) => this._handleRemoveTrigger(e));
    });
    wrap.querySelectorAll('.sb-auto__action-type').forEach((el) => {
      el.addEventListener('change', (e) => this._handleActionTypeChange(e));
    });
    wrap.querySelectorAll('.sb-auto__add-action').forEach((el) => {
      el.addEventListener('click', (e) => this._handleAddAction(e));
    });
    wrap.querySelectorAll('.sb-auto__remove-action').forEach((el) => {
      el.addEventListener('click', (e) => this._handleRemoveAction(e));
    });
  }

  _handleSelectSavedItem(e) {
    this._syncActiveRuleFromDOM();
    const idx = parseInt(e.currentTarget?.dataset?.idx, 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= this.items.length) return;
    this._activeSpecialKey = '';
    this._activeIdx = idx;
    this._renderList();
  }

  _handleOpenProject(e) {
    const btn = e.currentTarget;
    const project = {
      name: String(btn?.dataset?.project || '').trim(),
      project_type: String(btn?.dataset?.projectType || '').trim(),
      project_name: String(btn?.dataset?.projectTitle || '').trim(),
    };
    if (!project.name) return;
    try { this._modal?.close?.(); } catch (err) {}
    try { this.onOpenProject?.(project); } catch (err) {}
  }

  _handleOpenLogs(e) {
    const automation = String(e.currentTarget?.dataset?.automation || '').trim();
    try { this._modal?.close?.(); } catch (err) {}
    try { this.onOpenLogs?.({ automation }); } catch (err) {}
  }

  async _ensureActiveRunsLoaded() {
    const item = this.items[this._activeIdx];
    const key = String(item?.name || '').trim();
    if (!key || this._logsByAutomation.has(key) || this._loadingRunsFor === key) return;
    this._loadingRunsFor = key;
    this._renderList();
    try {
      const msg = await AutomationLogService.listRuns({ automation: key, limit: 8 });
      this._logsByAutomation.set(key, Array.isArray(msg?.items) ? msg.items : []);
    } catch (e) {
      this._logsByAutomation.set(key, []);
    } finally {
      this._loadingRunsFor = '';
      this._renderList();
    }
  }

  _handleNameInput(e) {
    const idx = parseInt(e.target?.dataset?.idx, 10);
    const item = this.items[idx];
    if (!item) return;
    item.automation_name = String(e.target?.value || '').trim();
  }

  async _handleToggle(e) {
    const idx = parseInt(e.target?.dataset?.idx, 10);
    const item = this.items[idx];
    if (!item?.name) return;

    const enabled = e.target.checked;
    const label = e.target?.parentElement?.querySelector('.sb-automation__toggle-label');
    if (label) label.textContent = enabled ? 'ON' : 'OFF';

    try {
      await this.onToggle(item.name, enabled);
      item.enabled = enabled ? 1 : 0;
    } catch (err) {
      e.target.checked = !enabled;
      if (label) label.textContent = enabled ? 'OFF' : 'ON';
    }
  }

  async _handleDelete(e) {
    const idx = parseInt(e.target?.dataset?.idx, 10);
    const item = this.items[idx];
    if (!item) return;
    const ok = window.confirm(`Delete automation "${this._displayName(item, idx)}"?`);
    if (!ok) return;

    if (item.name) {
      try { await this.onDelete(item.name); } catch (err) { return; }
      this._savedTotalCount = Math.max(0, this._savedTotalCount - 1);
    }
    this.items.splice(idx, 1);
    if (this._activeIdx >= this.items.length) this._activeIdx = this.items.length - 1;
    this._renderList();
  }

  async _handleSave(e) {
    if (this._saving) return;
    const idx = parseInt(e.target?.dataset?.idx, 10);
    const item = this.items[idx];
    if (!item) return;
    const blockedReason = this._getRuleSaveBlockReason(item);
    if (blockedReason) {
      try {
        frappe?.show_alert?.({ message: blockedReason, indicator: 'orange' }, 5);
      } catch (err) {}
      return;
    }

    this._syncActiveRuleFromDOM(idx);
    const itemNow = this.items[idx];
    const triggers = (Array.isArray(itemNow?.triggers) ? itemNow.triggers : [])
      .filter((t) => String(t?.trigger_type || '').trim())
      .map((t) => ({ trigger_type: String(t.trigger_type || '').trim(), config: { ...(t.config || {}) } }));
    if (!triggers.length) return;
    const blockedByRawTriggers = this._getRuleSaveBlockReasonFromTypes(triggers.map((t) => t?.trigger_type));
    if (blockedByRawTriggers) {
      try {
        frappe?.show_alert?.({ message: blockedByRawTriggers, indicator: 'orange' }, 5);
      } catch (err) {}
      return;
    }

    // Read all action rows
    const actions = (Array.isArray(itemNow?.actions) ? itemNow.actions : [])
      .filter((a) => String(a?.action_type || '').trim())
      .map((a) => ({ action_type: String(a.action_type || '').trim(), config: { ...(a.config || {}) } }));

    if (!actions.length) return;

    const enabled = itemNow?.enabled ? 1 : 0;
    const automationName = String(itemNow?.automation_name || '').trim() || this._displayName(itemNow, idx);

    this._saving = true;
    const btn = e.target;
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const prevName = String(item?.name || '').trim();
      const result = await this.onSave({
        name: itemNow?.name || '',
        enabled,
        automation_name: automationName,
        trigger_type: triggers[0]?.trigger_type || '',
        trigger_config: { triggers },
        actions,
      });

      item.name = result?.name || item.name;
      if (!prevName && String(item.name || '').trim()) this._savedTotalCount += 1;
      item.automation_name = String(result?.automation_name || automationName || '').trim();
      item.enabled = enabled;
      item.trigger_type = triggers[0]?.trigger_type || '';
      item.trigger_config = { triggers };
      item.triggers = triggers;
      item.actions = actions;
      item.execution_count = Number(result?.execution_count || item.execution_count || 0);

      // Re-render to update data-name
      if (item.name) this._logsByAutomation.delete(item.name);
      this._renderList();
    } catch (err) {
      // handled by controller
    } finally {
      this._saving = false;
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }

  _handleTriggerTypeChange(e) {
    const idx = parseInt(e.target?.dataset?.idx, 10);
    const tidx = parseInt(e.target?.dataset?.tidx, 10);
    this._syncActiveRuleFromDOM(idx);
    const item = this.items[idx];
    if (!item) return;
    if (!Array.isArray(item.triggers)) item.triggers = [];
    while (item.triggers.length <= tidx) item.triggers.push({ trigger_type: '', config: {} });
    item.triggers[tidx] = { trigger_type: e.target.value || '', config: {} };
    item.trigger_type = item.triggers[0]?.trigger_type || '';
    item.trigger_config = { triggers: item.triggers };
    this._renderList();
  }

  _handleAddTrigger(e) {
    const idx = parseInt(e.target?.dataset?.idx, 10);
    this._syncActiveRuleFromDOM(idx);
    const item = this.items[idx];
    if (!item) return;
    if (!Array.isArray(item.triggers)) item.triggers = [];
    item.triggers.push({ trigger_type: '', config: {} });
    this._renderList();
  }

  _handleRemoveTrigger(e) {
    const idx = parseInt(e.target?.dataset?.idx, 10);
    const tidx = parseInt(e.target?.dataset?.tidx, 10);
    this._syncActiveRuleFromDOM(idx);
    const item = this.items[idx];
    if (!item || !Array.isArray(item.triggers)) return;
    item.triggers.splice(tidx, 1);
    if (!item.triggers.length) item.triggers.push({ trigger_type: '', config: {} });
    item.trigger_type = item.triggers[0]?.trigger_type || '';
    item.trigger_config = { triggers: item.triggers };
    this._renderList();
  }

  _handleActionTypeChange(e) {
    const idx = parseInt(e.target?.dataset?.idx, 10);
    const aidx = parseInt(e.target?.dataset?.aidx, 10);
    this._syncActiveRuleFromDOM(idx);
    const item = this.items[idx];
    if (!item) return;

    if (!Array.isArray(item.actions)) item.actions = [];
    while (item.actions.length <= aidx) item.actions.push({});
    item.actions[aidx] = { action_type: e.target.value || '', config: {} };
    this._renderList();
  }

  _handleAddAction(e) {
    const idx = parseInt(e.target?.dataset?.idx, 10);
    this._syncActiveRuleFromDOM(idx);
    const item = this.items[idx];
    if (!item) return;
    if (!Array.isArray(item.actions)) item.actions = [];
    item.actions.push({ action_type: '', config: {} });
    this._renderList();
  }

  _handleRemoveAction(e) {
    const idx = parseInt(e.target?.dataset?.idx, 10);
    const aidx = parseInt(e.target?.dataset?.aidx, 10);
    this._syncActiveRuleFromDOM(idx);
    const item = this.items[idx];
    if (!item || !Array.isArray(item.actions)) return;
    item.actions.splice(aidx, 1);
    if (!item.actions.length) item.actions.push({ action_type: '', config: {} });
    this._renderList();
  }

  _addNew() {
    this._syncActiveRuleFromDOM();
    this.items.push({
      name: '',
      enabled: 1,
      automation_name: '',
      trigger_type: '',
      trigger_config: { triggers: [{ trigger_type: '', config: {} }] },
      triggers: [{ trigger_type: '', config: {} }],
      actions: [{ action_type: '', config: {} }],
      execution_count: 0,
    });
    this._savedSearch = '';
    this._activeSpecialKey = '';
    this._activeIdx = this.items.length - 1;
    this._renderList();
  }

  async _handleSaveAs(e) {
    const idx = parseInt(e.target?.dataset?.idx, 10);
    const item = this.items[idx];
    if (!item || this._saving) return;

    const blockedReason = this._getRuleSaveBlockReason(item);
    if (blockedReason) {
      try { frappe?.show_alert?.({ message: blockedReason, indicator: 'orange' }, 5); } catch (err) {}
      return;
    }

    this._syncActiveRuleFromDOM(idx);
    const base = this.items[idx];
    const defaultName = String(base?.automation_name || '').trim() || this._displayName(base, idx);
    const nextName = String(window.prompt('Save as new automation name', defaultName) || '').trim();
    if (!nextName) return;

    const triggers = (Array.isArray(base?.triggers) ? base.triggers : [])
      .filter((t) => String(t?.trigger_type || '').trim())
      .map((t) => ({ trigger_type: String(t.trigger_type || '').trim(), config: { ...(t.config || {}) } }));
    const actions = (Array.isArray(base?.actions) ? base.actions : [])
      .filter((a) => String(a?.action_type || '').trim())
      .map((a) => ({ action_type: String(a.action_type || '').trim(), config: { ...(a.config || {}) } }));
    if (!triggers.length || !actions.length) return;

    const btn = e.target;
    const prevText = btn.textContent;
    this._saving = true;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const result = await this.onSave({
        name: '',
        enabled: base?.enabled ? 1 : 0,
        automation_name: nextName,
        trigger_type: triggers[0]?.trigger_type || '',
        trigger_config: { triggers },
        actions,
      });
      const created = {
        name: result?.name || '',
        enabled: base?.enabled ? 1 : 0,
        automation_name: String(result?.automation_name || nextName || '').trim(),
        trigger_type: triggers[0]?.trigger_type || '',
        trigger_config: { triggers },
        triggers,
        actions,
        execution_count: Number(result?.execution_count || 0),
      };
      this.items.push(created);
      if (String(created.name || '').trim()) this._savedTotalCount += 1;
      this._savedSearch = '';
      this._activeIdx = this.items.length - 1;
      this._renderList();
    } finally {
      this._saving = false;
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }

  async _handleLoadMoreSaved() {
    if (this._loadingMoreSaved || !this._hasMoreSavedItems()) return;
    this._loadingMoreSaved = true;
    this._renderList();
    try {
      const res = await this.onLoadMore({
        offset: this._persistedItemsCount(),
        limit: this._savedPageSize,
        search: '',
      });
      const nextItems = Array.isArray(res?.items) ? res.items : [];
      const seen = new Set((this.items || []).map((item) => String(item?.name || '').trim()).filter(Boolean));
      nextItems.forEach((item) => {
        const name = String(item?.name || '').trim();
        if (!name || seen.has(name)) return;
        this.items.push({
          ...item,
          automation_name: String(item?.automation_name || '').trim(),
          triggers: this._normalizeTriggers(item),
          actions: Array.isArray(item.actions) ? [...item.actions] : [],
        });
        seen.add(name);
      });
      this._savedTotalCount = Math.max(Number(res?.meta?.total_count || 0) || 0, this._persistedItemsCount());
    } finally {
      this._loadingMoreSaved = false;
      this._renderList();
    }
  }

  _syncActiveRuleFromDOM(idx = this._activeIdx) {
    const i = Number(idx);
    if (!Number.isFinite(i) || i < 0 || i >= this.items.length) return;
    const item = this.items[i];
    const ruleEl = this._root?.querySelector(`.sb-automation__rule[data-idx="${i}"]`);
    if (!item || !ruleEl) return;

    item.enabled = ruleEl.querySelector('.sb-auto__enabled')?.checked ? 1 : 0;
    item.automation_name = String(ruleEl.querySelector('.sb-auto__name')?.value || item.automation_name || '').trim();

    const triggerRows = Array.from(ruleEl.querySelectorAll('.sb-automation__trigger-row'));
    const triggers = triggerRows.map((row) => {
      const tidx = parseInt(row?.dataset?.tidx, 10);
      const triggerType = String(row.querySelector('.sb-auto__trigger-type')?.value || '').trim();
      const config = {};
      row.querySelectorAll(`.sb-auto__config[data-prefix="trigger_${i}_${tidx}"]`).forEach((el) => {
        const key = String(el?.dataset?.key || '').trim();
        if (!key) return;
        config[key] = el.value ?? '';
      });
      return { trigger_type: triggerType, config };
    });
    item.triggers = triggers.length ? triggers : [{ trigger_type: '', config: {} }];
    item.trigger_type = item.triggers[0]?.trigger_type || '';
    item.trigger_config = { triggers: item.triggers };

    const actionRows = Array.from(ruleEl.querySelectorAll('.sb-automation__action-row'));
    const actions = actionRows.map((row) => {
      const aidx = parseInt(row?.dataset?.aidx, 10);
      const actionType = String(row.querySelector('.sb-auto__action-type')?.value || '').trim();
      const config = {};
      row.querySelectorAll(`.sb-auto__config[data-prefix="action_${i}_${aidx}"]`).forEach((el) => {
        const key = String(el?.dataset?.key || '').trim();
        if (!key) return;
        config[key] = el.value ?? '';
      });
      return { action_type: actionType, config };
    });
    item.actions = actions.length ? actions : [{ action_type: '', config: {} }];
  }

  _displayName(item, idx) {
    const explicit = String(item?.automation_name || '').trim();
    if (explicit) return explicit;
    return `Automation ${Number(idx) + 1}`;
  }

  _getFilteredSavedItems() {
    const q = String(this._savedSearch || '').trim().toLowerCase();
    const rows = this.items.map((item, idx) => ({ item, idx }));
    if (!q) return rows;
    return rows.filter(({ item, idx }) => this._displayName(item, idx).toLowerCase().includes(q));
  }

  _getRuleSaveBlockReason(item) {
    const triggers = (Array.isArray(item?.triggers) ? item.triggers : [])
      .filter((t) => t && typeof t === 'object')
      .map((t) => String(t.trigger_type || '').trim())
      .filter(Boolean);
    return this._getRuleSaveBlockReasonFromTypes(triggers);
  }

  _getRuleSaveBlockReasonFromTypes(triggerTypes) {
    const list = (Array.isArray(triggerTypes) ? triggerTypes : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    if (list.length !== 1) return '';
    const only = list[0];
    const meta = this.meta?.triggers?.[only] || {};
    // Fallback hard guard for stale meta/build cache.
    const cannotBeOnly = Boolean(meta?.cannot_be_only) || only === 'status_is';
    if (cannotBeOnly) {
      const label = String(meta.label || (only === 'status_is' ? 'Status is' : only)).trim() || only;
      return `"${label}" cannot be used alone. Add another trigger.`;
    }
    return '';
  }

  _normalizeTriggers(item) {
    const tc = (item && typeof item.trigger_config === 'object' && item.trigger_config) ? item.trigger_config : {};
    const fromConfig = Array.isArray(tc?.triggers) ? tc.triggers : [];
    if (fromConfig.length) {
      return fromConfig
        .filter((t) => t && typeof t === 'object')
        .map((t) => ({ trigger_type: t.trigger_type || '', config: t.config || {} }));
    }
    const ttype = item?.trigger_type || '';
    if (ttype) return [{ trigger_type: ttype, config: tc || {} }];
    return [{ trigger_type: '', config: {} }];
  }
}
