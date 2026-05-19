/**
 * Columns Manager Modal (Project + Task tabs)
 * - Website-safe (no Desk dependency)
 * - Supports: show/hide, drag reorder, two sections
 */
import { escapeHtml } from '../../utils/dom.js';
import { Modal } from '../Common/Modal.js';
import { notify } from '../../services/uiAdapter.js';

export class ColumnsManagerModal {
  constructor({ title = 'Manage Columns', sections = [], activeKey = null, onSave, onClose } = {}) {
    // sections: [{ key, label, hint, columns: [{field,label,enabled}] }]
    this.title = title;
    this.sections = (sections || []).map((s) => ({
      key: String(s.key),
      label: s.label || s.key,
      hint: s.hint || '',
      columns: (s.columns || []).map((c) => ({
        field: c.field,
        label: c.label || c.field,
        enabled: c.enabled !== false,
      }))
    }));
    this.activeKey = activeKey || this.sections?.[0]?.key || 'project';
    this.onSave = onSave || (() => {});
    this.onClose = onClose || (() => {});

    this._modal = null;
    this._overlay = null;
    this._dragIndex = null;
    this._dropIndex = null;
    this._saving = false;
  }

  open() {
    this.close();

    const content = document.createElement('div');
    content.innerHTML = `
      <div class="sb-coltabs">
        ${(this.sections || []).map((s) => `
          <button type="button" class="sb-coltabs__tab ${s.key === this.activeKey ? 'is-active' : ''}" data-key="${escapeHtml(s.key)}">
            ${escapeHtml(s.label)}
          </button>
        `).join('')}
      </div>
      <div class="sb-modal__hint" id="sbColMgrHint"></div>
      <div class="sb-colmgr" id="sbColMgrList"></div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';
    footer.innerHTML = `
      <button class="btn btn-default" type="button" id="sbColMgrCancel">Cancel</button>
      <button class="btn btn-primary" type="button" id="sbColMgrSave">Save</button>
    `;

    this._modal = new Modal({
      title: this.title,
      contentEl: content,
      footerEl: footer,
      onClose: () => this.onClose()
    });

    this._modal.open();
    this._overlay = content;

    footer.querySelector('#sbColMgrCancel')?.addEventListener('click', () => this.close());
    footer.querySelector('#sbColMgrSave')?.addEventListener('click', () => this._handleSave());

    content.querySelector('.sb-coltabs')?.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.sb-coltabs__tab');
      if (!btn) return;
      const key = btn.dataset.key;
      if (!key) return;
      this.activeKey = key;
      this._rerender();
    });

    this._rerender();
  }

  _getActiveSection() {
    return (this.sections || []).find((s) => s.key === this.activeKey) || this.sections?.[0] || null;
  }

  _rowHTML(c, idx) {
    return `
      <div class="sb-colmgr__row" draggable="true" data-index="${idx}">
        <div class="sb-colmgr__drag" title="Drag to reorder">⋮⋮</div>
        <label class="sb-colmgr__label">
          <input type="checkbox" class="sb-colmgr__check" data-index="${idx}" ${c.enabled ? 'checked' : ''}/>
          <span class="sb-colmgr__text">${escapeHtml(c.label)}</span>
          <span class="sb-colmgr__field">${escapeHtml(c.field)}</span>
        </label>
      </div>
    `;
  }

  _bindList(listEl) {
    // Remove previous listeners by cloning
    const fresh = listEl.cloneNode(true);
    listEl.parentNode.replaceChild(fresh, listEl);
    listEl = fresh;

    const active = this._getActiveSection();
    if (!active) return;

    listEl.addEventListener('change', (e) => {
      const cb = e.target?.closest?.('.sb-colmgr__check');
      if (!cb) return;
      const idx = Number(cb.dataset.index);
      if (Number.isFinite(idx) && active.columns[idx]) {
        active.columns[idx].enabled = !!cb.checked;
      }
    });

    listEl.addEventListener('dragstart', (e) => {
      const row = e.target?.closest?.('.sb-colmgr__row');
      if (!row) return;
      this._dragIndex = Number(row.dataset.index);
      this._dropIndex = this._dragIndex;
      row.classList.add('is-dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
      } catch (err) {}
    });

    listEl.addEventListener('dragend', () => {
      listEl.querySelectorAll('.sb-colmgr__row').forEach((r) => {
        r.classList.remove('is-dragging');
        r.classList.remove('is-drop-target');
      });
      this._dragIndex = null;
      this._dropIndex = null;
      this._rerenderList();
    });

    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      const overRow = e.target?.closest?.('.sb-colmgr__row');
      if (!overRow) return;
      const overIndex = Number(overRow.dataset.index);
      if (this._dragIndex == null || overIndex === this._dragIndex) return;
      this._dropIndex = overIndex;
      listEl.querySelectorAll('.sb-colmgr__row').forEach((r) => r.classList.remove('is-drop-target'));
      overRow.classList.add('is-drop-target');
    });

    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = this._dragIndex;
      const to = this._dropIndex;
      if (from == null || to == null || from === to) return;
      const moved = active.columns.splice(from, 1)[0];
      active.columns.splice(to, 0, moved);
      this._dragIndex = to;
      this._rerenderList();
    });
  }

  _rerenderTabs() {
    const tabs = this._overlay?.querySelectorAll?.('.sb-coltabs__tab') || [];
    tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.key === this.activeKey));
  }

  _rerenderList() {
    const list = this._overlay?.querySelector?.('#sbColMgrList');
    if (!list) return;
    const active = this._getActiveSection();
    list.innerHTML = (active?.columns || []).map((c, idx) => this._rowHTML(c, idx)).join('');
    this._bindList(list);
  }

  _rerenderHint() {
    const hint = this._overlay?.querySelector?.('#sbColMgrHint');
    const active = this._getActiveSection();
    if (!hint) return;
    hint.textContent = active?.hint || '勾选要显示的列，拖拽改变顺序。';
  }

  _rerender() {
    this._rerenderTabs();
    this._rerenderHint();
    this._rerenderList();
  }

  async _handleSave() {
    if (this._saving) return;
    const out = {};
    for (const s of (this.sections || [])) {
      const enabled = (s.columns || []).filter((c) => c.enabled);
      if (enabled.length === 0) {
        notify(`至少需要保留 1 列：${s.label}`, 'red');
        return;
      }
      out[s.key] = enabled;
    }

    const btn = this._modal?._overlay?.querySelector?.('#sbColMgrSave');
    this._saving = true;
    if (btn) btn.disabled = true;
    try {
      await Promise.resolve(this.onSave(out));
      this.close();
    } catch (e) {
      notify('Save columns failed', 'red');
    } finally {
      this._saving = false;
      if (btn) btn.disabled = false;
    }
  }

  close() {
    this._modal?.close?.();
    this._modal = null;
    this._overlay = null;
    this._dragIndex = null;
    this._dropIndex = null;
    this._saving = false;
  }
}


