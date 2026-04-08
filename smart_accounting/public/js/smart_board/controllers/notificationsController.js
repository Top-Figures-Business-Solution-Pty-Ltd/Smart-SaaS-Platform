/**
 * NotificationsController (website shell)
 * - Renders the bell popover + badge, backed by Notification Log
 */
import { NotificationsService } from '../services/notificationsService.js';

function escapeHtml(v) {
  return String(v || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmt(ts) {
  const s = String(ts || '');
  if (!s) return '';
  return s.replace('T', ' ').slice(0, 19);
}

export function initNotificationsShell({ buttonEl, popoverEl, badgeEl } = {}) {
  const btn = buttonEl;
  const pop = popoverEl;
  const badge = badgeEl;
  if (!btn || !pop) return null;

  let polling = null;
  let listState = {
    items: [],
    totalCount: 0,
    limit: 20,
    loading: false,
  };
  const onBtnClick = () => {
    // Toggle is handled outside (index.html). After it runs, if popover is open, refresh list.
    window.setTimeout(() => {
      try {
        if (pop.style.display !== 'none') refreshList();
      } catch (e) {}
    }, 0);
  };

  const setBadge = (count) => {
    const n = Number(count) || 0;
    if (!badge) return;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.style.display = n > 0 ? 'inline-flex' : 'none';
  };

  const refreshBadge = async () => {
    try {
      const c = await NotificationsService.unreadCount();
      setBadge(c);
    } catch (e) {}
  };

  const renderList = (items, { loading = false } = {}) => {
    const list = Array.isArray(items) ? items : [];
    const body = pop.querySelector('#notificationsPopoverBody') || pop;
    if (!list.length) {
      body.innerHTML = `<div class="text-muted">${loading ? 'Loading notifications...' : 'No notifications yet.'}</div>`;
      return;
    }
    const rows = list.map((n) => {
      const name = escapeHtml(n?.name || '');
      const subject = escapeHtml(n?.subject || '');
      const when = escapeHtml(fmt(n?.creation));
      const unread = Number(n?.read) ? 0 : 1;
      const docType = escapeHtml(n?.document_type || '');
      const docName = escapeHtml(n?.document_name || '');
      return `
        <div class="sb-notif" data-name="${name}" data-doctype="${docType}" data-docname="${docName}"
          style="padding:10px 10px; border-radius:10px; cursor:pointer; ${unread ? 'background: rgba(13,110,253,0.08);' : ''}">
          <div style="display:flex; justify-content:space-between; gap:10px;">
            <div style="font-weight:600; font-size:13px;">${subject}</div>
            <div class="text-muted" style="font-size:12px; white-space:nowrap;">${when}</div>
          </div>
        </div>
      `;
    }).join('');
    const total = Math.max(list.length, Number(listState.totalCount) || 0);
    const hasMore = list.length < total;
    body.innerHTML = `
      <div class="text-muted" style="font-size:12px; margin-bottom:8px;">Showing ${list.length} of ${total}</div>
      <div style="display:flex; flex-direction:column; gap:6px;">${rows}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:10px; flex-wrap:wrap;">
        <button class="btn btn-xs btn-default" type="button" id="btnNotifLoadMore" ${loading || !hasMore ? 'disabled' : ''} style="${hasMore ? '' : 'display:none;'}">${loading && hasMore ? 'Loading...' : 'Load more'}</button>
        <button class="btn btn-xs btn-default" type="button" id="btnNotifMarkAll">Mark all read</button>
      </div>`;
  };

  const refreshList = async ({ append = false } = {}) => {
    try {
      listState.loading = true;
      if (!append) {
        listState.items = [];
        listState.totalCount = 0;
        renderList([], { loading: true });
      } else {
        renderList(listState.items, { loading: true });
      }
      const limitStart = append ? listState.items.length : 0;
      const res = await NotificationsService.list({ limitStart, limit: listState.limit, unreadOnly: false });
      const nextItems = Array.isArray(res?.items) ? res.items : [];
      listState.totalCount = Number(res?.meta?.total_count || nextItems.length || 0);
      listState.items = append ? listState.items.concat(nextItems) : nextItems;
      renderList(listState.items, { loading: false });
    } catch (e) {
      const body = pop.querySelector('#notificationsPopoverBody') || pop;
      if (append && listState.items.length) {
        renderList(listState.items, { loading: false });
      } else {
        body.innerHTML = `<div class="text-danger">${escapeHtml(e?.message || 'Failed to load notifications')}</div>`;
      }
    } finally {
      listState.loading = false;
    }
  };

  const refresh = async () => {
    await refreshBadge();
    // only refresh list if popover is open
    if (pop.style.display !== 'none') await refreshList();
  };

  pop.addEventListener('click', async (e) => {
    const markAll = e.target?.closest?.('#btnNotifMarkAll');
    if (markAll) {
      e.preventDefault();
      try {
        await NotificationsService.markAllAsRead();
      } catch (err) {}
      await refresh();
      return;
    }

    const loadMore = e.target?.closest?.('#btnNotifLoadMore');
    if (loadMore) {
      e.preventDefault();
      if (listState.loading) return;
      await refreshList({ append: true });
      return;
    }

    const row = e.target?.closest?.('.sb-notif');
    if (!row) return;
    const name = row.dataset.name;
    const doctype = row.dataset.doctype;
    const docname = row.dataset.docname;
    try { await NotificationsService.markAsRead(name); } catch (err) {}
    await refreshBadge();
    row.style.background = '';

    // Navigate: open updates modal for Project in Smart Board
    if (doctype === 'Project' && docname) {
      try {
        await window.smart_accounting?.smart_board_instance?.openProjectUpdatesByName?.(docname);
      } catch (err) {}
    }
  });

  // Initial badge + polling
  refreshBadge();
  btn.addEventListener('click', onBtnClick);
  polling = window.setInterval(refreshBadge, 30_000);

  return {
    refresh,
    destroy() {
      try { if (polling) window.clearInterval(polling); } catch (e) {}
      polling = null;
      try { btn.removeEventListener('click', onBtnClick); } catch (e) {}
    }
  };
}


