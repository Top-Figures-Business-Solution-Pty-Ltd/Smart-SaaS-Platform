/**
 * UpdatesModal (website-safe)
 * - Step 7: only provides an entrypoint + UI shell (no persistence yet)
 * - Intentionally decoupled from inline editing to keep architecture healthy.
 */
import { escapeHtml } from '../../utils/dom.js';
import { Modal } from '../Common/Modal.js';
import { notify } from '../../services/uiAdapter.js';
import { UpdatesService } from '../../services/updatesService.js';
import { attachMentionPicker } from '../../controllers/mentionPickerController.js';

export class UpdatesModal {
  constructor({ project, onClose, onPosted } = {}) {
    this.project = project || null;
    this.onClose = onClose || (() => {});
    this.onPosted = onPosted || (() => {});
    this._modal = null;
    this._items = [];
    this._loading = false;
    this._posting = false;
    this._saving = false;
    this._deleting = false;
    this._pageSize = 10;
    this._page = 1;
    this._totalCount = 0;
    this._listEl = null;
    this._summaryEl = null;
    this._pageInfoEl = null;
    this._prevBtn = null;
    this._nextBtn = null;
    this._viewportEl = null;
    this._mentionPicker = null;
    this._mentions = []; // [{name, full_name}]
    this._editingName = '';
  }

  open() {
    this.close();
    const title = this.project?.project_name || this.project?.customer || 'Updates';

    const content = document.createElement('div');
    content.innerHTML = `
      <div class="sb-updates">
        <div class="sb-updates__header">
          <div class="sb-updates__header-copy">
            <div class="sb-updates__hint text-muted">Updates</div>
            <div class="sb-updates__summary text-muted" id="sbUpdatesSummary">Loading updates…</div>
          </div>
          <div class="sb-updates__pagination" id="sbUpdatesPagination">
            <button class="btn btn-default btn-xs" type="button" data-action="prev-page">Previous</button>
            <span class="sb-updates__pageinfo text-muted" id="sbUpdatesPageInfo">1 / 1</span>
            <button class="btn btn-default btn-xs" type="button" data-action="next-page">Next</button>
          </div>
        </div>
        <div class="sb-updates__viewport" id="sbUpdatesViewport">
          <div class="sb-updates__list" id="sbUpdatesList">
            <div class="text-muted">Loading…</div>
          </div>
        </div>
        <div class="sb-updates__composer">
          <textarea class="form-control sb-updates__textarea" rows="4" placeholder="Write a new update..."></textarea>
          <div class="sb-updates__composer-actions">
            <button class="btn btn-default" type="button" data-action="cancel">Cancel</button>
            <button class="btn btn-primary" type="button" data-action="post">Post</button>
          </div>
        </div>
      </div>
    `;

    const footer = null;
    this._modal = new Modal({
      title: `Updates · ${title}`,
      contentEl: content,
      footerEl: footer,
      modalClass: 'sb-modal--updates',
      onClose: () => {
        this.onClose();
      }
    });

    this._modal.open();

    const ta = content.querySelector('.sb-updates__textarea');
    const listEl = content.querySelector('#sbUpdatesList');
    const viewportEl = content.querySelector('#sbUpdatesViewport');
    const summaryEl = content.querySelector('#sbUpdatesSummary');
    const pageInfoEl = content.querySelector('#sbUpdatesPageInfo');
    const prevBtn = content.querySelector('button[data-action="prev-page"]');
    const nextBtn = content.querySelector('button[data-action="next-page"]');
    this._listEl = listEl;
    this._viewportEl = viewportEl;
    this._summaryEl = summaryEl;
    this._pageInfoEl = pageInfoEl;
    this._prevBtn = prevBtn;
    this._nextBtn = nextBtn;
    setTimeout(() => { try { ta?.focus?.(); } catch (e) {} }, 0);

    // @mention picker (MVP)
    this._mentionPicker?.destroy?.();
    this._mentionPicker = attachMentionPicker({
      textareaEl: ta,
      onPick: (u) => {
        const name = String(u?.name || '').trim();
        const full_name = String(u?.full_name || '').trim();
        if (!name || !full_name) return;
        // de-dupe
        const exists = (this._mentions || []).some((m) => m?.name === name);
        if (!exists) this._mentions = (this._mentions || []).concat([{ name, full_name }]);
      }
    });

    this._loadInitial();

    content.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'cancel') {
        this.close();
      } else if (action === 'post') {
        this._postUpdate(ta);
      } else if (action === 'prev-page') {
        this._loadPage(this._page - 1);
      } else if (action === 'next-page') {
        this._loadPage(this._page + 1);
      } else if (action === 'edit') {
        this._startEdit(btn.dataset.name);
      } else if (action === 'cancel-edit') {
        this._editingName = '';
        this._renderList();
      } else if (action === 'save-edit') {
        this._saveEdit(btn.dataset.name);
      } else if (action === 'delete') {
        this._deleteItem(btn.dataset.name);
      }
    });
  }

  async _loadInitial() {
    return this._loadPage(1);
  }

  async _loadPage(page) {
    if (this._loading) return;
    const projectName = this.project?.name;
    if (!projectName) return;
    const targetPage = Math.max(1, Number(page) || 1);
    this._loading = true;
    this._renderLoading();
    this._updatePaginationState();
    try {
      const limitStart = (targetPage - 1) * this._pageSize;
      const msg = await UpdatesService.listProjectUpdates(projectName, { limitStart, limit: this._pageSize });
      const items = Array.isArray(msg?.items) ? msg.items : [];
      const totalFromServer = Number(msg?.meta?.total_count || 0);
      this._items = items;
      this._page = targetPage;
      this._totalCount = totalFromServer > 0 ? totalFromServer : Math.max(limitStart + items.length, items.length);
      const totalPages = this._totalPages();
      if (this._page > totalPages) {
        this._page = totalPages;
        this._loading = false;
        return this._loadPage(this._page);
      }
      this._renderList();
      this._updatePaginationState();
      this._scrollListToTop();
    } catch (e) {
      console.error(e);
      this._renderError(e?.message || String(e));
    } finally {
      this._loading = false;
      this._updatePaginationState();
    }
  }

  _renderError(msg) {
    if (!this._listEl) return;
    this._updateSummaryText(msg || 'Failed to load updates');
    this._listEl.innerHTML = `<div class="text-danger">${escapeHtml(msg || 'Failed to load updates')}</div>`;
  }

  _renderLoading() {
    if (!this._listEl) return;
    this._updateSummaryText('Loading updates…');
    this._listEl.innerHTML = `<div class="text-muted">Loading…</div>`;
  }

  _renderList() {
    if (!this._listEl) return;
    const items = Array.isArray(this._items) ? this._items : [];
    if (!items.length) {
      this._updateSummaryText('No updates yet.');
      this._listEl.innerHTML = `<div class="text-muted">No updates yet.</div>`;
      return;
    }
    const toPlainText = (v) => {
      const s = String(v || '');
      if (!s) return '';
      // Comment.content is often stored as HTML (e.g. Quill output in Desk). Make it readable here.
      if (s.includes('<') && s.includes('>')) {
        try {
          const tmp = document.createElement('div');
          tmp.innerHTML = s;
          return (tmp.textContent || '').trim();
        } catch (e) {
          // fall through
        }
      }
      return s;
    };
    const rows = [];
    let lastDay = '';
    items.forEach((it) => {
      const dayKey = this._dayKey(it?.creation);
      if (dayKey && dayKey !== lastDay) {
        rows.push(`<div class="sb-updates__day">${escapeHtml(this._dayLabel(it?.creation))}</div>`);
        lastDay = dayKey;
      }
      const by = escapeHtml(it?.comment_by || it?.owner || it?.comment_email || 'Unknown');
      const when = escapeHtml(this._timeLabel(it?.creation));
      const content = escapeHtml(toPlainText(it?.content || ''));
      const name = String(it?.name || '');
      const isEditing = !!name && name === this._editingName;
      const canManage = !!it?.can_manage;
      const editedTag = it?.is_edited ? `<span class="sb-updates__edited text-muted">(edited)</span>` : '';
      if (isEditing) {
        rows.push(`
          <div class="sb-updates__item">
            <div class="sb-updates__meta">
              <div class="sb-updates__author">${by}</div>
              <div class="sb-updates__when">${when}</div>
            </div>
            <textarea class="form-control sb-updates__edit-textarea" data-edit-name="${escapeHtml(name)}" rows="4">${content}</textarea>
            <div class="sb-updates__actions">
              <button class="btn btn-default btn-xs" type="button" data-action="cancel-edit" data-name="${escapeHtml(name)}">Cancel</button>
              <button class="btn btn-primary btn-xs" type="button" data-action="save-edit" data-name="${escapeHtml(name)}">Save</button>
            </div>
          </div>
        `);
        return;
      }
      rows.push(`
        <div class="sb-updates__item">
          <div class="sb-updates__meta">
            <div class="sb-updates__author">${by} ${editedTag}</div>
            <div class="sb-updates__when">${when}</div>
          </div>
          <div class="sb-updates__content">${content}</div>
          ${canManage ? `
            <div class="sb-updates__actions">
              <button class="btn btn-default btn-xs" type="button" data-action="edit" data-name="${escapeHtml(name)}">Edit</button>
              <button class="btn btn-default btn-xs" type="button" data-action="delete" data-name="${escapeHtml(name)}">Delete</button>
            </div>
          ` : ''}
        </div>
      `);
    });
    this._updateSummaryText(this._summaryText());
    this._listEl.innerHTML = `<div class="sb-updates__items">${rows.join('')}</div>`;
  }

  async _postUpdate(textareaEl) {
    if (this._posting) return;
    const ta = textareaEl;
    const text = (ta?.value || '').trim();
    if (!text) {
      notify('Please write something first.', 'orange');
      return;
    }
    const projectName = this.project?.name;
    if (!projectName) return;

    // Compose HTML (allow mentions to be represented as safe spans)
    const composed = this._composeContent(text, this._mentions || []);
    const mentions = composed?.mentions || [];
    const html = composed?.html || text;

    this._posting = true;
    try {
      const item = await UpdatesService.addProjectUpdate(projectName, html, { mentions });
      if (item) {
        notify('Posted.', 'green');
        try { this.onPosted?.(item); } catch (e) {}
        await this._loadPage(1);
      }
      if (ta) ta.value = '';
      this._mentions = [];
      // Best-effort: refresh bell badge/list if present
      try { window.smart_accounting?.notifications_controller?.refresh?.(); } catch (e) {}
    } catch (e) {
      console.error(e);
      notify(e?.message || 'Post failed', 'red');
    } finally {
      this._posting = false;
    }
  }

  _composeContent(plainText, mentionObjs) {
    const text = String(plainText || '');
    const mentions = Array.isArray(mentionObjs) ? mentionObjs : [];
    const byLabel = new Map();
    for (const m of mentions) {
      const id = String(m?.name || '').trim();
      const label = String(m?.full_name || '').trim();
      if (!id || !label) continue;
      byLabel.set(label, id);
    }

    // Escape everything first (safe)
    let html = escapeHtml(text).replace(/\n/g, '<br>');
    const outMentions = [];
    for (const [label, id] of byLabel.entries()) {
      const tokenEsc = escapeHtml(`@${label}`);
      const idx = html.indexOf(tokenEsc);
      if (idx < 0) continue;
      const wrapped = `<span class="sb-mention" data-user="${escapeHtml(id)}">${tokenEsc}</span>`;
      html = html.slice(0, idx) + wrapped + html.slice(idx + tokenEsc.length);
      outMentions.push(id);
    }
    return { html, mentions: outMentions };
  }

  _startEdit(name) {
    const n = String(name || '').trim();
    if (!n) return;
    this._editingName = n;
    this._renderList();
  }

  async _saveEdit(name) {
    if (this._saving) return;
    const n = String(name || '').trim();
    if (!n) return;
    let ta = null;
    const textareas = Array.from(this._listEl?.querySelectorAll?.('textarea[data-edit-name]') || []);
    for (const el of textareas) {
      if (String(el?.dataset?.editName || '').trim() === n) {
        ta = el;
        break;
      }
    }
    const text = String(ta?.value || '').trim();
    if (!text) {
      notify('Update cannot be empty.', 'orange');
      return;
    }
    this._saving = true;
    try {
      const item = await UpdatesService.updateProjectUpdate(n, text);
      if (item) {
        this._items = (this._items || []).map((x) => (x?.name === n ? item : x));
        this._editingName = '';
        this._renderList();
        notify('Updated.', 'green');
      }
    } catch (e) {
      console.error(e);
      notify(e?.message || 'Update failed', 'red');
    } finally {
      this._saving = false;
    }
  }

  async _deleteItem(name) {
    if (this._deleting) return;
    const n = String(name || '').trim();
    if (!n) return;
    const ok = window.confirm('Delete this update?');
    if (!ok) return;
    this._deleting = true;
    try {
      const deleted = await UpdatesService.deleteProjectUpdate(n);
      if (deleted) {
        this._editingName = this._editingName === n ? '' : this._editingName;
        const currentCount = Array.isArray(this._items) ? this._items.length : 0;
        const shouldStepBack = currentCount <= 1 && this._page > 1;
        await this._loadPage(shouldStepBack ? this._page - 1 : this._page);
        notify('Deleted.', 'green');
      }
    } catch (e) {
      console.error(e);
      notify(e?.message || 'Delete failed', 'red');
    } finally {
      this._deleting = false;
    }
  }

  _totalPages() {
    const total = Math.max(0, Number(this._totalCount || 0));
    return Math.max(1, Math.ceil(total / this._pageSize));
  }

  _summaryText() {
    const total = Math.max(0, Number(this._totalCount || 0));
    if (!total) return 'No updates yet.';
    const start = ((this._page - 1) * this._pageSize) + 1;
    const end = Math.min(total, start + (this._items?.length || 0) - 1);
    return `Showing ${start}-${end} of ${total} updates`;
  }

  _updateSummaryText(text) {
    if (this._summaryEl) this._summaryEl.textContent = String(text || '');
  }

  _updatePaginationState() {
    const totalPages = this._totalPages();
    const page = Math.min(Math.max(1, Number(this._page || 1)), totalPages);
    if (this._pageInfoEl) this._pageInfoEl.textContent = `${page} / ${totalPages}`;
    if (this._prevBtn) this._prevBtn.disabled = !!this._loading || page <= 1;
    if (this._nextBtn) this._nextBtn.disabled = !!this._loading || page >= totalPages || Number(this._totalCount || 0) === 0;
    const wrap = this._pageInfoEl?.closest?.('.sb-updates__pagination');
    if (wrap) wrap.hidden = Number(this._totalCount || 0) <= this._pageSize;
    if (!this._loading && Number(this._totalCount || 0) > 0) this._updateSummaryText(this._summaryText());
  }

  _scrollListToTop() {
    try { this._viewportEl?.scrollTo?.({ top: 0, behavior: 'auto' }); } catch (e) {
      try { if (this._viewportEl) this._viewportEl.scrollTop = 0; } catch (e2) {}
    }
  }

  _dateFromTs(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  _dayKey(ts) {
    const d = this._dateFromTs(ts);
    if (!d) return '';
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  _dayLabel(ts) {
    const d = this._dateFromTs(ts);
    if (!d) return 'Unknown date';
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((t0 - d0) / (24 * 3600 * 1000));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString();
  }

  _timeLabel(ts) {
    const d = this._dateFromTs(ts);
    if (!d) return String(ts || '').replace('T', ' ').slice(0, 19);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  close() {
    this._modal?.close?.();
    this._modal = null;
    this._items = [];
    this._listEl = null;
    this._viewportEl = null;
    this._loading = false;
    this._posting = false;
    this._saving = false;
    this._deleting = false;
    this._page = 1;
    this._totalCount = 0;
    this._summaryEl = null;
    this._pageInfoEl = null;
    this._prevBtn = null;
    this._nextBtn = null;
    this._editingName = '';
    this._mentionPicker?.destroy?.();
    this._mentionPicker = null;
    this._mentions = [];
  }
}


