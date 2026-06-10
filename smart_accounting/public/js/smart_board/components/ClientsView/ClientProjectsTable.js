/**
 * ClientProjectsTable
 * - Aggregated Projects list (Client / Project Type / Project Name / Status + "Open Board").
 * - Mostly read-only; the Status cell is inline-editable (same menu/options as the
 *   board) so users can quickly re-status a project from the Home status page.
 *   To change any OTHER column, open the board.
 */
import { STATUS_COLORS } from '../../utils/constants.js';
import { BoardStatusService } from '../../services/boardStatusService.js';
import { InlineMenuSelectEditor } from '../Common/editors/InlineMenuSelectEditor.js';

function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function _statusCellHtml(status) {
  const v = String(status || '').trim();
  if (!v) {
    return '<span class="text-muted">—</span><span class="sb-afford sb-afford--select">▾</span>';
  }
  const color = STATUS_COLORS[v] || '#6c757d';
  return `<span class="status-badge" style="background-color:${_esc(color)};">${_esc(v)}</span><span class="sb-afford sb-afford--select">▾</span>`;
}

export class ClientProjectsTable {
  constructor(container, { onOpenBoard, onLoadMore, onChangeStatus } = {}) {
    this.container = container;
    this.onOpenBoard = onOpenBoard || (() => {});
    this.onLoadMore = onLoadMore || (() => {});
    this.onChangeStatus = onChangeStatus || (async () => {});
    this._items = [];
    this._onClick = null;
    this._activeEditor = null;
    this._editingIdx = null;
  }

  render({ items = [], loading = false, loadingMore = false, error = null, totalCount = 0, hasMore = false } = {}) {
    // Tear down any open status editor before we replace the DOM.
    this._closeEditor();
    this._items = Array.isArray(items) ? items : [];
    const total = Math.max(Number(totalCount) || 0, this._items.length);

    const rows = this._items.map((p, idx) => {
      const customer = _esc(p?.customer || '');
      const pt = _esc(p?.project_type || '');
      const pn = _esc(p?.project_name || p?.name || '');
      return `
        <tr data-idx="${idx}">
          <td style="width:140px;">
            <button class="btn btn-xs btn-default" type="button" data-action="open-board">Open Board</button>
          </td>
          <td>${customer}</td>
          <td>${pt}</td>
          <td>${pn}</td>
          <td class="sb-cp__status" data-action="edit-status" title="Click to change status" style="cursor:pointer;">${_statusCellHtml(p?.status)}</td>
        </tr>
      `;
    }).join('');

    const body = loading
      ? `<div class="text-muted" style="padding: 16px;">Loading projects…</div>`
      : (error
          ? `<div class="text-danger" style="padding: 16px;">${_esc(error)}</div>`
          : `
              <div class="text-muted" style="font-size:12px; padding: 0 0 10px 0;">Showing ${this._items.length} of ${total}</div>
              <div style="overflow:auto;">
                <table class="table table-bordered" style="margin:0;">
                  <thead>
                    <tr>
                      <th style="width:140px;"></th>
                      <th>Client Name</th>
                      <th>Project Type</th>
                      <th>Project Name</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows || `<tr><td colspan="5" class="text-muted" style="padding:16px;">No projects found.</td></tr>`}
                  </tbody>
                </table>
              </div>
              <div style="display:flex;justify-content:center;padding:12px 0 0 0;">
                <button
                  class="btn btn-default btn-sm"
                  type="button"
                  data-action="load-more-projects"
                  ${loadingMore || !hasMore ? 'disabled' : ''}
                  style="${hasMore ? '' : 'display:none;'}"
                >${loadingMore ? 'Loading...' : 'Load more'}</button>
              </div>
            `);

    this.container.innerHTML = body;
    this._bind();
  }

  _bind() {
    if (this._onClick) this.container.removeEventListener('click', this._onClick);
    this._onClick = (e) => {
      const loadMoreBtn = e.target?.closest?.('button[data-action="load-more-projects"]');
      if (loadMoreBtn) {
        this.onLoadMore();
        return;
      }
      const openBtn = e.target?.closest?.('button[data-action="open-board"]');
      if (openBtn) {
        const tr = openBtn.closest('tr[data-idx]');
        const idx = Number(tr?.dataset?.idx);
        const p = this._items?.[idx];
        if (p) this.onOpenBoard(p);
        return;
      }
      const statusCell = e.target?.closest?.('td[data-action="edit-status"]');
      if (statusCell) {
        const tr = statusCell.closest('tr[data-idx]');
        const idx = Number(tr?.dataset?.idx);
        this._openStatusEditor(statusCell, idx);
      }
    };
    this.container.addEventListener('click', this._onClick);
  }

  _closeEditor() {
    if (this._activeEditor) {
      try { this._activeEditor.destroy?.(); } catch (e) {}
      this._activeEditor = null;
    }
    this._editingIdx = null;
  }

  _openStatusEditor(cellEl, idx) {
    const p = this._items?.[idx];
    if (!p || !cellEl) return;
    // Toggle: clicking the same open cell closes it.
    if (this._activeEditor && this._editingIdx === idx) {
      this._closeEditor();
      cellEl.innerHTML = _statusCellHtml(p.status);
      return;
    }
    this._closeEditor();
    this._editingIdx = idx;

    const current = String(p.status || '').trim();
    cellEl.innerHTML = '';
    const mount = document.createElement('div');
    cellEl.appendChild(mount);

    const ed = new InlineMenuSelectEditor(mount, {
      options: current ? [{ value: current, label: current, color: STATUS_COLORS[current] || '' }] : [],
      initialValue: current,
    });
    this._activeEditor = ed;

    const restore = () => {
      this._closeEditor();
      cellEl.innerHTML = _statusCellHtml(p.status);
    };

    mount.addEventListener('sb:menu-select', async (e) => {
      e.stopPropagation?.();
      const value = String(e?.detail?.value ?? ed.getValue() ?? '').trim();
      this._closeEditor();
      if (!value || value === current) {
        cellEl.innerHTML = _statusCellHtml(p.status);
        return;
      }
      // Optimistic paint; the store update will re-render the whole table.
      cellEl.innerHTML = _statusCellHtml(value);
      try {
        await this.onChangeStatus(p, value);
      } catch (err) {
        cellEl.innerHTML = _statusCellHtml(p.status);
      }
    }, { once: true });

    mount.addEventListener('sb:menu-close', () => restore(), { once: true });

    // Load the real, board-scoped status options and re-render the menu once.
    BoardStatusService.getEffectiveOptions({ projectType: p.project_type, currentValue: current })
      .then((opts) => {
        if (this._activeEditor !== ed || !mount.isConnected) return;
        const items = (Array.isArray(opts) ? opts : []).map((s) => ({
          value: s, label: s, color: STATUS_COLORS[s] || '',
        }));
        if (items.length) {
          ed.options = items;
          ed.render();
        }
      })
      .catch(() => {});
  }

  destroy() {
    this._closeEditor();
    if (this._onClick) this.container.removeEventListener('click', this._onClick);
    this._onClick = null;
    this.container.innerHTML = '';
  }
}
