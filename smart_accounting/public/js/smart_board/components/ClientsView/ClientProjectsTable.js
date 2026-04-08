/**
 * ClientProjectsTable (read-only)
 * - Fixed columns to keep the "aggregate view" simple and safe
 */
function _esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class ClientProjectsTable {
  constructor(container, { onOpenBoard, onLoadMore } = {}) {
    this.container = container;
    this.onOpenBoard = onOpenBoard || (() => {});
    this.onLoadMore = onLoadMore || (() => {});
    this._items = [];
    this._onClick = null;
  }

  render({ items = [], loading = false, loadingMore = false, error = null, totalCount = 0, hasMore = false } = {}) {
    this._items = Array.isArray(items) ? items : [];
    const total = Math.max(Number(totalCount) || 0, this._items.length);

    const rows = this._items.map((p, idx) => {
      const customer = _esc(p?.customer || '');
      const pt = _esc(p?.project_type || '');
      const pn = _esc(p?.project_name || p?.name || '');
      const st = _esc(p?.status || '');
      return `
        <tr data-idx="${idx}">
          <td style="width:140px;">
            <button class="btn btn-xs btn-default" type="button" data-action="open-board">Open Board</button>
          </td>
          <td>${customer}</td>
          <td>${pt}</td>
          <td>${pn}</td>
          <td>${st}</td>
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
      const btn = e.target?.closest?.('button[data-action="open-board"]');
      if (!btn) return;
      const tr = btn.closest('tr[data-idx]');
      const idx = Number(tr?.dataset?.idx);
      const p = this._items?.[idx];
      if (!p) return;
      this.onOpenBoard(p);
    };
    this.container.addEventListener('click', this._onClick);
  }

  destroy() {
    if (this._onClick) this.container.removeEventListener('click', this._onClick);
    this._onClick = null;
    this.container.innerHTML = '';
  }
}


