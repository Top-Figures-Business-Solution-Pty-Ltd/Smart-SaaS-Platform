import { escapeHtml } from './dom.js';
import { formatDate } from './helpers.js';

function countCard(label, value) {
  return `
    <div style="border:1px solid var(--border-color, #d1d5db); border-radius:8px; padding:10px 12px;">
      <div class="text-muted" style="font-size:11px; text-transform:uppercase; letter-spacing:.03em;">${escapeHtml(label)}</div>
      <div style="font-size:18px; font-weight:600; margin-top:3px;">${escapeHtml(String(value ?? 0))}</div>
    </div>
  `;
}

function severityLabel(severity) {
  const s = String(severity || '').trim().toLowerCase();
  if (s === 'critical') return 'Critical';
  if (s === 'warning') return 'Warning';
  return 'Notice';
}

function itemLabel(item) {
  const project = String(item?.project_title || item?.project || item?.automation_name || item?.automation || '').trim();
  const detail = String(item?.detail || '').trim();
  if (!project && !detail) return 'No detail';
  if (!project) return detail;
  if (!detail) return project;
  return `${project} - ${detail}`;
}

function checkHTML(check) {
  const count = Number(check?.count || 0);
  const items = Array.isArray(check?.items) ? check.items : [];
  const more = Number(check?.more_count || 0);
  const severity = severityLabel(check?.severity);
  return `
    <div style="border:1px solid var(--border-color, #d1d5db); border-radius:10px; padding:12px; background:${count ? 'rgba(255,251,235,.55)' : 'rgba(249,250,251,.7)'};">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
        <div>
          <div style="font-weight:600;">${escapeHtml(check?.title || 'Check')}</div>
          <div class="text-muted" style="font-size:12px; margin-top:4px;">${escapeHtml(check?.description || '')}</div>
        </div>
        <div style="white-space:nowrap; font-size:12px;">
          <strong>${escapeHtml(String(count))}</strong>
          <span class="text-muted">${escapeHtml(severity)}</span>
        </div>
      </div>
      ${items.length ? `
        <div style="display:flex; flex-direction:column; gap:5px; margin-top:10px;">
          ${items.map((item) => `<div class="text-muted" style="font-size:12px;">${escapeHtml(itemLabel(item))}</div>`).join('')}
          ${more > 0 ? `<div class="text-muted" style="font-size:12px;">And ${escapeHtml(String(more))} more...</div>` : ''}
        </div>
      ` : `<div class="text-muted" style="font-size:12px; margin-top:10px;">No issues found.</div>`}
    </div>
  `;
}

export function renderDataQualityReportHTML(report) {
  const summary = report?.summary || {};
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  return `
    <div class="sb-data-quality">
      <div class="text-muted" style="font-size:12px; line-height:1.45;">
        Read-only diagnostics for Smart Board data. Opening this panel does not update projects, run automations, or write logs.
        ${report?.generated_at ? `<br />Generated at ${escapeHtml(formatDate(report.generated_at) || String(report.generated_at || ''))}` : ''}
      </div>
      <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin-top:14px;">
        ${countCard('Total', summary.total)}
        ${countCard('Critical', summary.critical)}
        ${countCard('Warning', summary.warning)}
        ${countCard('Notice', summary.notice)}
      </div>
      <div style="display:flex; flex-direction:column; gap:10px; margin-top:14px;">
        ${checks.map(checkHTML).join('') || '<div class="text-muted" style="font-size:12px;">No checks returned.</div>'}
      </div>
    </div>
  `;
}
