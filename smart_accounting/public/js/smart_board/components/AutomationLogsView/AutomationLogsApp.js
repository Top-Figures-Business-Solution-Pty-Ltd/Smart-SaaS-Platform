import { escapeHtml } from '../../utils/dom.js';
import { AutomationLogService } from '../../services/automationLogService.js';
import { AutomationService } from '../../services/automationService.js';

function _clean(v) {
  return String(v || '').trim();
}

export class AutomationLogsApp {
  constructor(container, { app, initialFilters = {}, projectTypes = [] } = {}) {
    this.container = container;
    this.app = app || null;
    this.projectTypes = Array.isArray(projectTypes) ? projectTypes : [];
    this._automations = [];
    this._expanded = new Set();
    this._state = {
      items: [],
      loading: false,
      error: null,
      limit: 30,
      offset: 0,
      hasMore: true,
      totalCount: null,
    };
    this._filters = {
      automation: _clean(initialFilters?.automation),
      result: _clean(initialFilters?.result),
      executionSource: _clean(initialFilters?.executionSource),
      projectType: _clean(initialFilters?.projectType),
      search: _clean(initialFilters?.search),
    };
  }

  async init() {
    await this._loadAutomations();
    await this._fetch(true);
    this.render();
    this._bind();
  }

  destroy() {
    try { this.container.innerHTML = ''; } catch (e) {}
  }

  async _loadAutomations() {
    try {
      const res = await AutomationService.getAutomations({ limit: 1000 });
      this._automations = Array.isArray(res?.items) ? res.items : [];
    } catch (e) {
      this._automations = [];
    }
  }

  async _fetch(reset = false) {
    if (this._state.loading) return;
    this._state.loading = true;
    this._state.error = null;
    if (reset) {
      this._state.offset = 0;
      this._state.hasMore = true;
    }
    this.render();
    try {
      const msg = await AutomationLogService.listRuns({
        automation: this._filters.automation,
        result: this._filters.result,
        executionSource: this._filters.executionSource,
        projectType: this._filters.projectType,
        search: this._filters.search,
        limitStart: this._state.offset,
        limit: this._state.limit,
      });
      const items = Array.isArray(msg?.items) ? msg.items : [];
      const totalCount = Number(msg?.meta?.total_count || 0) || 0;
      if (reset) this._state.items = items;
      else this._state.items = [...(this._state.items || []), ...items];
      this._state.offset = (this._state.items || []).length;
      this._state.totalCount = totalCount;
      this._state.hasMore = (this._state.items || []).length < totalCount;
    } catch (e) {
      this._state.error = e?.message || String(e);
    } finally {
      this._state.loading = false;
      this.render();
    }
  }

  _bind() {
    this.container.addEventListener('click', (e) => {
      const loadMore = e.target?.closest?.('#sbAutoLogsLoadMore');
      if (loadMore) {
        e.preventDefault();
        this._fetch(false);
        return;
      }
      const refresh = e.target?.closest?.('#sbAutoLogsRefresh');
      if (refresh) {
        e.preventDefault();
        this._fetch(true);
        return;
      }
      const openProject = e.target?.closest?.('[data-action="open-project"]');
      if (openProject) {
        e.preventDefault();
        this._openProject(openProject);
        return;
      }
      const focusAutomation = e.target?.closest?.('[data-action="focus-automation"]');
      if (focusAutomation) {
        e.preventDefault();
        this._filters.automation = _clean(focusAutomation.getAttribute('data-automation'));
        this._fetch(true);
        return;
      }
      const toggleRow = e.target?.closest?.('[data-action="toggle-run"]');
      if (toggleRow) {
        e.preventDefault();
        const key = _clean(toggleRow.getAttribute('data-run-id'));
        if (!key) return;
        if (this._expanded.has(key)) this._expanded.delete(key);
        else this._expanded.add(key);
        this.render();
      }
    });

    this.container.addEventListener('change', (e) => {
      const automation = e.target?.closest?.('#sbAutoLogsAutomation');
      const result = e.target?.closest?.('#sbAutoLogsResult');
      const source = e.target?.closest?.('#sbAutoLogsSource');
      const projectType = e.target?.closest?.('#sbAutoLogsProjectType');
      if (!automation && !result && !source && !projectType) return;
      if (automation) this._filters.automation = _clean(automation.value);
      if (result) this._filters.result = _clean(result.value);
      if (source) this._filters.executionSource = _clean(source.value);
      if (projectType) this._filters.projectType = _clean(projectType.value);
      this._fetch(true);
    });

    this.container.addEventListener('input', (e) => {
      const search = e.target?.closest?.('#sbAutoLogsSearch');
      if (!search) return;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this._filters.search = _clean(search.value);
        this._fetch(true);
      }, 250);
    });
  }

  _openProject(btn) {
    const project = {
      name: _clean(btn.getAttribute('data-project')),
      project_type: _clean(btn.getAttribute('data-project-type')),
      project_name: _clean(btn.getAttribute('data-project-title')),
    };
    if (!project.name) return;
    try { this.app?.focusProject?.(project); } catch (e) {}
  }

  render() {
    const automationOptions = [
      '<option value="">All automations</option>',
      ...(this._automations || []).map((row) => {
        const name = _clean(row?.name);
        const label = _clean(row?.automation_name) || name;
        return `<option value="${escapeHtml(name)}">${escapeHtml(label)}</option>`;
      })
    ].join('');

    const projectTypeOptions = [
      '<option value="">All project types</option>',
      ...(this.projectTypes || []).map((row) => {
        const value = _clean(row?.value || row?.name);
        const label = _clean(row?.label || row?.value || row?.name);
        return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
      })
    ].join('');

    const rows = (this._state.items || []).map((row) => this._rowHTML(row)).join('');
    const loaded = Array.isArray(this._state.items) ? this._state.items.length : 0;
    const total = Number(this._state.totalCount || 0);

    this.container.innerHTML = `
      <div class="sb-page sb-auto-logs">
        <div class="sb-auto-logs__bar">
          <div class="sb-auto-logs__filters">
            <input class="form-control" id="sbAutoLogsSearch" type="text" placeholder="Search runs..." value="${escapeHtml(this._filters.search)}" />
            <select class="form-control" id="sbAutoLogsAutomation">${automationOptions}</select>
            <select class="form-control" id="sbAutoLogsResult">
              <option value="">All results</option>
              <option value="Success">Success</option>
              <option value="No Change">No Change</option>
              <option value="Skipped">Skipped</option>
              <option value="Failed">Failed</option>
            </select>
            <select class="form-control" id="sbAutoLogsSource">
              <option value="">All sources</option>
              <option value="Validate">Validate</option>
              <option value="Hourly Scheduler">Hourly Scheduler</option>
              <option value="Daily Scheduler">Daily Scheduler</option>
              <option value="Manual">Manual</option>
              <option value="Other">Other</option>
            </select>
            <select class="form-control" id="sbAutoLogsProjectType">${projectTypeOptions}</select>
          </div>
          <div class="sb-auto-logs__actions">
            <button class="btn btn-default" id="sbAutoLogsRefresh">Refresh</button>
            <span class="sb-auto-logs__status">Loaded ${loaded}${total ? ` / ${total}` : ''}</span>
          </div>
        </div>

        <div class="sb-auto-logs__list">
          ${rows || (!this._state.loading && !this._state.error ? '<div class="text-muted" style="padding:12px;">No automation runs found.</div>' : '')}
          ${this._state.error ? `<div class="text-danger" style="padding:12px;">${escapeHtml(this._state.error)}</div>` : ''}
          ${this._state.loading ? `<div class="text-muted" style="padding:12px;">Loading…</div>` : ''}
        </div>

        <div class="sb-auto-logs__footer">
          <button class="btn btn-default" id="sbAutoLogsLoadMore" ${!this._state.hasMore || this._state.loading ? 'disabled' : ''}>
            ${this._state.loading ? 'Loading…' : (this._state.hasMore ? 'Load more' : 'No more')}
          </button>
        </div>
      </div>
    `;

    const automationSel = this.container.querySelector('#sbAutoLogsAutomation');
    if (automationSel) automationSel.value = this._filters.automation || '';
    const resultSel = this.container.querySelector('#sbAutoLogsResult');
    if (resultSel) resultSel.value = this._filters.result || '';
    const sourceSel = this.container.querySelector('#sbAutoLogsSource');
    if (sourceSel) sourceSel.value = this._filters.executionSource || '';
    const projectTypeSel = this.container.querySelector('#sbAutoLogsProjectType');
    if (projectTypeSel) projectTypeSel.value = this._filters.projectType || '';
  }

  _rowHTML(row) {
    const runId = _clean(row?.run_id || row?.name);
    const expanded = this._expanded.has(runId);
    const changes = Array.isArray(row?.changes) ? row.changes : [];
    const changeRows = changes.map((ch) => {
      const field = _clean(ch?.field_label || ch?.fieldname);
      const from = _clean(ch?.from_value);
      const to = _clean(ch?.to_value);
      const actionType = _clean(ch?.action_type);
      return `
        <div class="sb-auto-logs__change">
          <div class="sb-auto-logs__change-head">
            <span class="sb-auto-logs__change-field">${escapeHtml(field || 'Field')}</span>
            ${actionType ? `<span class="sb-auto-logs__change-action">${escapeHtml(actionType)}</span>` : ''}
          </div>
          <div class="sb-auto-logs__change-body">
            <span class="sb-auto-logs__change-from">${escapeHtml(from || '(empty)')}</span>
            <span class="sb-auto-logs__change-arrow">→</span>
            <span class="sb-auto-logs__change-to">${escapeHtml(to || '(empty)')}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="sb-auto-logs__item">
        <div class="sb-auto-logs__item-main">
          <div class="sb-auto-logs__item-head">
            <button type="button" class="sb-auto-logs__toggle" data-action="toggle-run" data-run-id="${escapeHtml(runId)}">${expanded ? '▾' : '▸'}</button>
            <button type="button" class="sb-auto-logs__automation-link" data-action="focus-automation" data-automation="${escapeHtml(_clean(row?.automation))}">${escapeHtml(_clean(row?.automation_name) || _clean(row?.automation) || 'Automation')}</button>
            <span class="sb-auto__run-result sb-auto__run-result--${escapeHtml(_clean(row?.result).toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(_clean(row?.result) || 'Unknown')}</span>
            <span class="sb-auto-logs__time">${escapeHtml(_clean(row?.triggered_at).replace('T', ' ').slice(0, 19))}</span>
          </div>
          <div class="sb-auto-logs__item-sub">
            <span class="sb-auto-logs__project">${escapeHtml(_clean(row?.project_title) || _clean(row?.project) || 'Unknown project')}</span>
            ${_clean(row?.project_type) ? `<span class="sb-auto__run-type">${escapeHtml(_clean(row?.project_type))}</span>` : ''}
            <span class="sb-auto-logs__meta">${escapeHtml(_clean(row?.execution_source) || 'Validate')}${Number(row?.changed_field_count || 0) ? ` · ${escapeHtml(String(row.changed_field_count))} field${Number(row.changed_field_count) > 1 ? 's' : ''}` : ''}</span>
          </div>
          ${_clean(row?.message) ? `<div class="sb-auto-logs__message">${escapeHtml(_clean(row?.message))}</div>` : ''}
        </div>
        <div class="sb-auto-logs__item-actions">
          <button type="button" class="btn btn-default btn-xs" data-action="open-project" data-project="${escapeHtml(_clean(row?.project))}" data-project-type="${escapeHtml(_clean(row?.project_type))}" data-project-title="${escapeHtml(_clean(row?.project_title))}">Open project</button>
        </div>
        ${expanded ? `<div class="sb-auto-logs__details">${changeRows || '<div class="text-muted" style="font-size:12px;">No field changes recorded.</div>'}</div>` : ''}
      </div>
    `;
  }
}
