import { Modal } from '../Common/Modal.js';
import { escapeHtml } from '../../utils/dom.js';
import { formatDate } from '../../utils/helpers.js';

function countLine(label, value) {
  return `
    <div style="border:1px solid var(--border-color, #d1d5db); border-radius:8px; padding:10px 12px;">
      <div class="text-muted" style="font-size:11px; text-transform:uppercase; letter-spacing:.03em;">${escapeHtml(label)}</div>
      <div style="font-size:18px; font-weight:600; margin-top:3px;">${escapeHtml(String(value ?? 0))}</div>
    </div>
  `;
}

function listItems(items, render) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return '<div class="text-muted" style="font-size:12px;">None</div>';
  return `<div style="display:flex; flex-direction:column; gap:6px;">${arr.map(render).join('')}</div>`;
}

function titleizeResult(key) {
  const raw = String(key || '').replace(/[_-]+/g, ' ').trim();
  if (!raw) return 'Other';
  return raw.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function resultSummary(resultCounts) {
  const entries = Object.entries(resultCounts || {})
    .map(([key, value]) => [titleizeResult(key), Number(value || 0)])
    .filter(([, value]) => value > 0);
  if (!entries.length) {
    return '<div class="text-muted" style="font-size:12px;">No run results in this period.</div>';
  }
  return `
    <div style="display:flex; flex-wrap:wrap; gap:8px;">
      ${entries.map(([label, value]) => `
        <div style="border:1px solid var(--border-color, #e5e7eb); border-radius:999px; padding:5px 10px; font-size:12px;">
          <span class="text-muted">${escapeHtml(label)}</span>
          <strong style="margin-left:6px;">${escapeHtml(String(value))}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function problemItem(x) {
  const diagnosis = x?.diagnosis && typeof x.diagnosis === 'object' ? x.diagnosis : {};
  const summary = String(diagnosis?.summary || x?.message || '').trim();
  const title = String(diagnosis?.title || x?.result || 'Problem').trim();
  return `
    <div style="font-size:12px; border-bottom:1px solid var(--border-color, #e5e7eb); padding-bottom:6px;">
      <strong>${escapeHtml(title)}</strong> · ${escapeHtml(formatDate(x?.triggered_at) || String(x?.triggered_at || ''))}
      <br />
      <span class="text-muted">${escapeHtml(x?.automation_name || x?.automation || '')}${x?.project ? ` · ${escapeHtml(x.project)}` : ''}</span>
      ${summary ? `<div class="text-muted" style="margin-top:3px;">${escapeHtml(summary)}</div>` : ''}
    </div>
  `;
}

export class AutomationHealthModal {
  constructor({ health } = {}) {
    this.health = health || {};
    this._modal = null;
  }

  open() {
    this.close();
    const h = this.health || {};
    const resultCounts = h.result_counts || {};
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="sb-automation-health" style="min-width:560px;">
        <div class="text-muted" style="font-size:12px; line-height:1.45;">
          Read-only summary from existing Automation Run Log records. Opening this panel does not run automations or write logs.
        </div>
        <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin-top:14px;">
          ${countLine('Lookback', `${h.lookback_hours || 24}h`)}
          ${countLine('Enabled', h.enabled_automation_count)}
          ${countLine('Run logs', h.run_count)}
          ${countLine('Projects changed', h.changed_project_count)}
        </div>
        <div style="margin-top:14px; border:1px solid var(--border-color, #d1d5db); border-radius:8px; padding:10px 12px;">
          <div style="font-weight:600; margin-bottom:6px;">Result summary</div>
          ${resultSummary(resultCounts)}
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:14px;">
          <div>
            <div style="font-weight:600; margin-bottom:8px;">Enabled with no recent runs</div>
            ${listItems(h.enabled_with_no_recent_runs, (x) => `<div style="font-size:12px; border-bottom:1px solid var(--border-color, #e5e7eb); padding-bottom:6px;">${escapeHtml(x?.automation_name || x?.automation || '')}</div>`)}
          </div>
          <div>
            <div style="font-weight:600; margin-bottom:8px;">Recent problems</div>
            ${listItems(h.recent_problems, problemItem)}
          </div>
        </div>
      </div>
    `;
    this._modal = new Modal({
      title: 'Automation Health',
      contentEl: content,
    });
    this._modal.open();
  }

  close() {
    this._modal?.close?.();
    this._modal = null;
  }
}
