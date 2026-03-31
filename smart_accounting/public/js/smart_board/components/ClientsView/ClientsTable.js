/**
 * ClientsTable (website-safe)
 * - Pure UI: renders list + load more (search/columns handled by global header)
 */
import { escapeHtml } from '../../utils/dom.js';

export class ClientsTable {
  constructor(container, { onLoadMore, onRowClick, onOpenProjects, onEdit, onDelete, onArchive, onRestore } = {}) {
    this.container = container;
    this.onLoadMore = typeof onLoadMore === 'function' ? onLoadMore : (() => {});
    this.onRowClick = typeof onRowClick === 'function' ? onRowClick : (() => {});
    this.onOpenProjects = typeof onOpenProjects === 'function' ? onOpenProjects : (() => {});
    this.onEdit = typeof onEdit === 'function' ? onEdit : (() => {});
    this.onDelete = typeof onDelete === 'function' ? onDelete : (() => {});
    this.onArchive = typeof onArchive === 'function' ? onArchive : (() => {});
    this.onRestore = typeof onRestore === 'function' ? onRestore : (() => {});
    this._state = { items: [], loading: false, loadingMore: false, hasMore: true, error: null, columns: [] };
    this._io = null;
    this._lastAutoLoadAt = 0;
  }

  render(state) {
    this._state = { ...(this._state || {}), ...(state || {}) };
    const items = Array.isArray(this._state.items) ? this._state.items : [];
    const loading = !!this._state.loading;
    const err = this._state.error;
    const hasMore = this._state.hasMore !== false;
    const loadingMore = !!this._state.loadingMore;
    const cols = Array.isArray(this._state.columns) && this._state.columns.length ? this._state.columns : ['customer_name','custom_partner','entity_type','abn','year_end','entities_count'];
    const totalCount = (this._state.totalCount == null) ? null : Number(this._state.totalCount);
    const showing = items.length;
    const archivedMode = !!this._state.archivedMode;
    const canArchive = !!this._state.canArchive;
    const canRestore = !!this._state.canRestore;
    const projectCountClickable = this._state.projectCountClickable !== false;

    const valueFor = (client, field) => {
      const pe = client?.primary_entity || null;
      if (field === 'customer_name') return escapeHtml(client?.customer_name || client?.name || '—');
      if (field === 'custom_partner') {
        const label = escapeHtml(client?.custom_partner_label || client?.custom_partner || '—');
        const img = escapeHtml(client?.custom_partner_image || '');
        if (!client?.custom_partner) return label;
        const initial = escapeHtml(String(client?.custom_partner_label || client?.custom_partner || 'U').trim().charAt(0).toUpperCase() || 'U');
        return `
          <span style="display:inline-flex;align-items:center;gap:8px;">
            ${img
              ? `<img src="${img}" alt="" style="width:24px;height:24px;border-radius:999px;object-fit:cover;" />`
              : `<span style="width:24px;height:24px;border-radius:999px;background:#e5e7eb;color:#374151;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;">${initial}</span>`}
            <span>${label}</span>
          </span>
        `;
      }
      if (field === 'customer_group') return escapeHtml(client?.customer_group || '—');
      if (field === 'territory') return escapeHtml(client?.territory || '—');
      if (field === 'entities_count') return `<span class="text-muted">${Number(client?.entities_count || 0) || '—'}</span>`;
      if (field === 'project_count') {
        const n = Number(client?.project_count || 0) || 0;
        const label = n === 1 ? 'Project' : 'Projects';
        if (!projectCountClickable) {
          return `<span class="text-muted">${n} ${escapeHtml(label)}</span>`;
        }
        return `
          <button type="button" class="sb-client-open-projects" data-client="${escapeHtml(client?.name || '')}" aria-label="View ${n} ${label}">
            <span class="sb-client-open-projects__num">${n}</span>
            <span class="sb-client-open-projects__label">${label}</span>
          </button>
        `;
      }
      if (field === 'active_project_count') {
        const n = Number(client?.active_project_count || 0) || 0;
        return `<span class="text-muted">${n}</span>`;
      }
      if (field === 'entity_type') return escapeHtml(pe?.entity_type || '—');
      if (field === 'abn') return escapeHtml(pe?.abn || '—');
      if (field === 'year_end') return escapeHtml(pe?.year_end || '—');
      return escapeHtml(String(client?.[field] ?? '—'));
    };

    const labelFor = (field) => ({
      name: 'ID',
      customer_name: 'Client',
      custom_partner: 'Partner',
      project_count: 'Projects',
      active_project_count: 'Active',
      entity_type: 'Entity Type',
      abn: 'ABN',
      year_end: 'Year End',
      entities_count: 'Entities',
      customer_group: 'Group',
      territory: 'Territory',
    }[field] || field);

    const thead = [
      ...cols.map((f) => `<th>${escapeHtml(labelFor(f))}</th>`),
      '<th style="width:180px;">Actions</th>',
    ].join('');
    const rows = items.map((c) => {
      const name = escapeHtml(c?.name || '');
      const tds = cols.map((f, idx) => {
        const val = valueFor(c, f);
        const isFirst = idx === 0;
        return `<td ${isFirst ? 'style="font-weight:600;"' : ''}>${val}</td>`;
      }).join('');
      const actions = `
        <td class="sb-clients__actions">
          ${archivedMode
            ? (canRestore ? `<button type="button" class="btn btn-default sb-client-restore-btn" data-client="${name}">Restore</button>` : '')
            : `
                <button type="button" class="btn btn-default sb-client-edit-btn" data-client="${name}">Edit</button>
                ${canArchive ? `<button type="button" class="btn btn-default sb-client-archive-btn" data-client="${name}">Archive</button>` : ''}
                <button type="button" class="btn btn-default sb-client-delete-btn" data-client="${name}">Delete</button>
              `}
        </td>
      `;
      return `<tr class="sb-clients__row" data-name="${name}">${tds}${actions}</tr>`;
    }).join('');

    const body = (() => {
      if (loading) return `<div class="text-muted" style="padding:12px;">Loading clients…</div>`;
      if (err) return `<div class="text-danger" style="padding:12px;">Failed to load: ${escapeHtml(err)}</div>`;
      if (!items.length) return `<div class="text-muted" style="padding:12px;">No clients found.</div>`;
      return `
        <div class="sb-table-scroll" style="border:1px solid var(--smart-board-border); border-radius:12px; background:#fff;">
          <table class="table table-borderless" style="margin:0;">
            <thead style="position:sticky; top:0; background:#fff; border-bottom:1px solid rgba(0,0,0,0.06);">
              <tr>
                ${thead}
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    })();

    this.container.innerHTML = `
      <div class="sb-page">
        ${body}
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px;">
          <div class="text-muted" style="font-size:12px;">
            ${totalCount == null ? '' : `Showing ${showing} / ${totalCount}`}
          </div>
          <button class="btn btn-default" type="button" id="sbClientsLoadMore" ${(!hasMore || loading || loadingMore) ? 'disabled' : ''}>
            ${loadingMore ? 'Loading…' : (hasMore ? 'Load more' : 'No more')}
          </button>
        </div>
        <div id="sbClientsSentinel" style="height:1px;"></div>
      </div>
    `;

    this.container.querySelector('#sbClientsLoadMore')?.addEventListener('click', () => this.onLoadMore());
    this.container.querySelector('tbody')?.addEventListener('click', (e) => {
      const editBtn = e.target?.closest?.('.sb-client-edit-btn');
      if (editBtn) {
        e.preventDefault();
        e.stopPropagation();
        const name = editBtn.getAttribute('data-client') || '';
        const client = items.find((x) => String(x?.name) === String(name)) || null;
        if (client) this.onEdit(client);
        return;
      }
      const delBtn = e.target?.closest?.('.sb-client-delete-btn');
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        const name = delBtn.getAttribute('data-client') || '';
        const client = items.find((x) => String(x?.name) === String(name)) || null;
        if (client) this.onDelete(client);
        return;
      }
      const archiveBtn = e.target?.closest?.('.sb-client-archive-btn');
      if (archiveBtn) {
        e.preventDefault();
        e.stopPropagation();
        const name = archiveBtn.getAttribute('data-client') || '';
        const client = items.find((x) => String(x?.name) === String(name)) || null;
        if (client) this.onArchive(client);
        return;
      }
      const restoreBtn = e.target?.closest?.('.sb-client-restore-btn');
      if (restoreBtn) {
        e.preventDefault();
        e.stopPropagation();
        const name = restoreBtn.getAttribute('data-client') || '';
        const client = items.find((x) => String(x?.name) === String(name)) || null;
        if (client) this.onRestore(client);
        return;
      }
      const btn = e.target?.closest?.('.sb-client-open-projects');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const name = btn.getAttribute('data-client') || '';
        const client = items.find((x) => String(x?.name) === String(name)) || null;
        if (client) this.onOpenProjects(client);
        return;
      }
      const tr = e.target?.closest?.('tr[data-name]');
      if (!tr) return;
      const name2 = tr.dataset.name;
      const client = items.find((x) => String(x?.name) === String(name2)) || null;
      if (client) this.onRowClick(client);
    });

    // Auto infinite-load: when sentinel enters viewport, trigger loadMore (keeps button as fallback).
    // This does NOT change click/navigation behavior, only how more rows are fetched.
    try {
      this._io?.disconnect?.();
    } catch (e) {}
    this._io = null;

    const sentinel = this.container.querySelector('#sbClientsSentinel');
    if (sentinel && hasMore && !loading && !loadingMore && typeof IntersectionObserver !== 'undefined') {
      this._io = new IntersectionObserver((entries) => {
        const hit = entries && entries[0] && entries[0].isIntersecting;
        if (!hit) return;
        const now = Date.now();
        // guard: avoid tight loops / repeated triggers
        if (now - (this._lastAutoLoadAt || 0) < 600) return;
        this._lastAutoLoadAt = now;
        try { this.onLoadMore(); } catch (e) {}
      }, { root: null, rootMargin: '600px 0px', threshold: 0.01 });
      try { this._io.observe(sentinel); } catch (e) {}
    } else if (sentinel && hasMore && !loading && !loadingMore) {
      // Fallback for very old browsers: if everything fits (no scroll), keep the old Load more button.
    }
  }
}


