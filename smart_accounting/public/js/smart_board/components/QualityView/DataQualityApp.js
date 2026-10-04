import { DataQualityService } from '../../services/dataQualityService.js';
import { escapeHtml } from '../../utils/dom.js';

export class DataQualityApp {
  constructor(container, { app } = {}) {
    this.container = container;
    this.app = app || null;
    this._expanded = new Set();
    this._state = {
      loading: false,
      error: '',
      report: null,
    };
  }

  async init() {
    await this.refresh();
  }

  destroy() {
    try { this.container.innerHTML = ''; } catch (e) {}
  }

  async refresh() {
    if (this._state.loading) return;
    this._state.loading = true;
    this._state.error = '';
    this.render();
    try {
      this._state.report = await DataQualityService.getReport();
    } catch (e) {
      this._state.error = e?.message || String(e);
    } finally {
      this._state.loading = false;
      this.render();
    }
  }

  render() {
    const { loading, error, report } = this._state;
    const summary = report?.summary || {};
    const checks = Array.isArray(report?.checks) ? report.checks : [];
    this.container.innerHTML = `
      <div class="sb-page sb-quality-page">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:14px;">
          <div>
            <div class="sb-page__subtitle">Read-only checks for Smart Board data integrity.</div>
            <div class="text-muted" style="font-size:12px;">This page does not update projects, run automations, or write logs.</div>
          </div>
          <button class="btn btn-default btn-sm" type="button" id="sbQualityRefresh" ${loading ? 'disabled' : ''}>${loading ? 'Refreshing...' : 'Refresh'}</button>
        </div>
        ${error ? `<div class="text-danger" style="padding:12px;">${escapeHtml(error)}</div>` : ''}
        ${loading && !report ? '<div class="text-muted" style="padding:12px;">Loading data quality report...</div>' : ''}
        ${report ? `
          ${this._summaryHTML(summary, report)}
          <div style="display:flex; flex-direction:column; gap:10px; margin-top:14px;">
            ${checks.map((check) => this._checkHTML(check)).join('') || '<div class="text-muted" style="font-size:12px;">No checks returned.</div>'}
          </div>
        ` : ''}
      </div>
    `;
    this.container.querySelector('#sbQualityRefresh')?.addEventListener('click', () => this.refresh());
    this.container.querySelectorAll('[data-action="quality-toggle"]').forEach((btn) => {
      btn.addEventListener('click', (e) => this._toggleCheck(e));
    });
    this.container.querySelectorAll('[data-action="quality-open-project"]').forEach((btn) => {
      btn.addEventListener('click', (e) => this._openProject(e));
    });
    this.container.querySelectorAll('[data-action="quality-open-board"]').forEach((btn) => {
      btn.addEventListener('click', (e) => this._openBoard(e));
    });
    this.container.querySelectorAll('[data-action="quality-open-logs"]').forEach((btn) => {
      btn.addEventListener('click', (e) => this._openAutomationLogs(e));
    });
  }

  _summaryHTML(summary, report) {
    return `
      <div class="text-muted" style="font-size:12px; line-height:1.45;">
        Read-only diagnostics for Smart Board data. This page does not update projects, run automations, or write logs.
        ${report?.generated_at ? `<br />Generated at ${escapeHtml(String(report.generated_at || ''))}` : ''}
      </div>
      <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin-top:14px;">
        ${this._countCard('Total', summary.total)}
        ${this._countCard('Critical', summary.critical)}
        ${this._countCard('Warning', summary.warning)}
        ${this._countCard('Notice', summary.notice)}
      </div>
    `;
  }

  _countCard(label, value) {
    return `
      <div style="border:1px solid var(--border-color, #d1d5db); border-radius:8px; padding:10px 12px;">
        <div class="text-muted" style="font-size:11px; text-transform:uppercase; letter-spacing:.03em;">${escapeHtml(label)}</div>
        <div style="font-size:18px; font-weight:600; margin-top:3px;">${escapeHtml(String(value ?? 0))}</div>
      </div>
    `;
  }

  _severityLabel(severity) {
    const s = String(severity || '').trim().toLowerCase();
    if (s === 'critical') return 'Critical';
    if (s === 'warning') return 'Warning';
    return 'Notice';
  }

  _checkHTML(check) {
    const key = String(check?.key || check?.title || '').trim();
    const count = Number(check?.count || 0);
    const severity = this._severityLabel(check?.severity);
    const isOpen = this._expanded.has(key);
    const items = Array.isArray(check?.items) ? check.items : [];
    const more = Number(check?.more_count || 0);
    return `
      <div style="border:1px solid var(--border-color, #d1d5db); border-radius:10px; padding:12px; background:${count ? 'rgba(255,251,235,.55)' : 'rgba(249,250,251,.7)'};">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
          <div>
            <div style="font-weight:600;">${escapeHtml(check?.title || 'Check')}</div>
            <div class="text-muted" style="font-size:12px; margin-top:4px;">${escapeHtml(check?.description || '')}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; white-space:nowrap; font-size:12px;">
            <span><strong>${escapeHtml(String(count))}</strong> <span class="text-muted">${escapeHtml(severity)}</span></span>
            <button class="btn btn-default btn-xs" type="button" data-action="quality-toggle" data-key="${escapeHtml(key)}" ${count ? '' : 'disabled'}>${isOpen ? 'Hide' : 'View'}</button>
          </div>
        </div>
        ${isOpen ? `
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
            ${items.map((item) => this._itemHTML(item)).join('') || '<div class="text-muted" style="font-size:12px;">No detailed items returned.</div>'}
            ${more > 0 ? `<div class="text-muted" style="font-size:12px;">And ${escapeHtml(String(more))} more. Refine the data or add backend pagination before editing in bulk.</div>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  _itemHTML(item) {
    const type = String(item?.item_type || '').trim();
    const title = String(item?.project_title || item?.project || item?.automation_name || item?.automation || item?.detail || 'Item').trim();
    const detail = String(item?.detail || '').trim();
    const project = String(item?.project || '').trim();
    const projectType = String(item?.project_type || '').trim();
    const automation = String(item?.automation || '').trim();
    return `
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; border:1px solid var(--border-color, #e5e7eb); border-radius:8px; padding:8px 10px; background:#fff;">
        <div style="min-width:0;">
          <div style="font-size:13px; font-weight:600;">${escapeHtml(title)}</div>
          <div class="text-muted" style="font-size:12px; margin-top:2px;">
            ${projectType ? `${escapeHtml(projectType)} · ` : ''}${escapeHtml(detail || type || 'Detail')}
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
          ${project && projectType ? `<button class="btn btn-default btn-xs" type="button" data-action="quality-open-project" data-project="${escapeHtml(project)}" data-project-type="${escapeHtml(projectType)}">Open project</button>` : ''}
          ${projectType ? `<button class="btn btn-default btn-xs" type="button" data-action="quality-open-board" data-project-type="${escapeHtml(projectType)}">Open board</button>` : ''}
          ${automation ? `<button class="btn btn-default btn-xs" type="button" data-action="quality-open-logs" data-automation="${escapeHtml(automation)}">View logs</button>` : ''}
        </div>
      </div>
    `;
  }

  _toggleCheck(e) {
    const key = String(e?.currentTarget?.dataset?.key || '').trim();
    if (!key) return;
    if (this._expanded.has(key)) this._expanded.delete(key);
    else this._expanded.add(key);
    this.render();
  }

  _openProject(e) {
    const btn = e?.currentTarget;
    const project = String(btn?.dataset?.project || '').trim();
    const projectType = String(btn?.dataset?.projectType || '').trim();
    if (!project || !projectType) return;
    this.app?.focusProject?.({ name: project, project_type: projectType });
  }

  _openBoard(e) {
    const projectType = String(e?.currentTarget?.dataset?.projectType || '').trim();
    if (!projectType) return;
    this.app?.handleViewChange?.(projectType);
  }

  _openAutomationLogs(e) {
    const automation = String(e?.currentTarget?.dataset?.automation || '').trim();
    if (!automation) return;
    this.app?.openAutomationLogs?.({ automation });
  }
}
