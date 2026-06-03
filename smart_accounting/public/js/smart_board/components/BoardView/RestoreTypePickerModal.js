/**
 * RestoreTypePickerModal (Website-safe)
 * - Shown when restoring archived projects whose project_type is the
 *   "Archived (Holding)" placeholder (i.e. their original board was deleted).
 * - Lets the user pick a target Project Type per project before restoring.
 * - Resolves a map { [projectName]: chosenType } via onConfirm, or cancels.
 */
import { Modal } from '../Common/Modal.js';
import { escapeHtml } from '../../utils/dom.js';

export class RestoreTypePickerModal {
  constructor({ projects = [], projectTypes = [], onConfirm, onClose } = {}) {
    // projects: [{ name, project_name?, original_type? }]
    this.projects = Array.isArray(projects) ? projects : [];
    this.projectTypes = (Array.isArray(projectTypes) ? projectTypes : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    this.onConfirm = typeof onConfirm === 'function' ? onConfirm : (async () => {});
    this.onClose = typeof onClose === 'function' ? onClose : (() => {});

    this._modal = null;
    this._root = null;
    this._submitting = false;
  }

  async open() {
    this.close();

    const optionsHtml = (defaultType) => {
      const def = String(defaultType || '').trim();
      const opts = this.projectTypes.map((t) => {
        const sel = t === def ? ' selected' : '';
        return `<option value="${escapeHtml(t)}"${sel}>${escapeHtml(t)}</option>`;
      }).join('');
      const placeholder = def && this.projectTypes.includes(def)
        ? ''
        : '<option value="" disabled selected>Select board</option>';
      return placeholder + opts;
    };

    const rows = this.projects.map((p, i) => {
      const title = escapeHtml(p?.project_name || p?.name || '—');
      const orig = String(p?.original_type || '').trim();
      const hint = orig
        ? `<div class="text-muted" style="font-size:12px;">Was: ${escapeHtml(orig)}</div>`
        : '';
      return `
        <div class="sb-restore-row" style="display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid #f0f0f0;">
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title}</div>
            ${hint}
          </div>
          <select class="form-control sb-restore-type" data-name="${escapeHtml(p?.name || '')}" style="width:220px; flex:0 0 220px;">
            ${optionsHtml(orig)}
          </select>
        </div>`;
    }).join('');

    const content = document.createElement('div');
    content.innerHTML = `
      <div class="sb-newclient">
        <div class="text-muted" style="font-size:13px; margin-bottom:10px;">
          ${this.projects.length > 1
            ? 'These projects were on a board that no longer exists. Choose a board for each before restoring.'
            : 'This project was on a board that no longer exists. Choose a board before restoring.'}
        </div>
        ${this.projects.length > 1 ? `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
          <span class="text-muted" style="font-size:12px;">Apply to all:</span>
          <select class="form-control" id="sbRestoreApplyAll" style="width:220px;">
            <option value="" disabled selected>Select board…</option>
            ${this.projectTypes.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
          </select>
        </div>` : ''}
        <div id="sbRestoreRows">${rows}</div>
        <div class="sb-newproj__error text-danger" id="sbRestoreErr" style="display:none; margin-top:10px;"></div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';
    footer.innerHTML = `
      <button class="btn btn-default" type="button" id="sbRestoreCancel">Cancel</button>
      <button class="btn btn-primary" type="button" id="sbRestoreConfirm">Restore</button>
    `;

    this._modal = new Modal({
      title: 'Restore — choose a board',
      contentEl: content,
      footerEl: footer,
      onClose: () => this.onClose(),
    });
    this._modal.open();
    this._root = content;

    content.querySelector('#sbRestoreApplyAll')?.addEventListener('change', (e) => {
      const v = String(e.target.value || '').trim();
      if (!v) return;
      content.querySelectorAll('.sb-restore-type').forEach((sel) => { sel.value = v; });
    });

    footer.querySelector('#sbRestoreCancel')?.addEventListener('click', () => this.close());
    footer.querySelector('#sbRestoreConfirm')?.addEventListener('click', () => this._handleConfirm());
  }

  close() {
    this._modal?.close?.();
    this._modal = null;
    this._root = null;
  }

  _setError(msg) {
    const el = this._root?.querySelector?.('#sbRestoreErr');
    if (!el) return;
    const m = String(msg || '').trim();
    el.textContent = m;
    el.style.display = m ? 'block' : 'none';
  }

  async _handleConfirm() {
    this._setError('');
    if (this._submitting) return;

    const map = {};
    let missing = 0;
    this._root?.querySelectorAll?.('.sb-restore-type').forEach((sel) => {
      const name = String(sel.dataset.name || '').trim();
      const val = String(sel.value || '').trim();
      if (!name) return;
      if (!val) { missing += 1; return; }
      map[name] = val;
    });
    if (missing > 0) {
      this._setError('Please choose a board for every project.');
      return;
    }

    this._submitting = true;
    const btnCancel = this._modal?._overlay?.querySelector?.('#sbRestoreCancel');
    const btnConfirm = this._modal?._overlay?.querySelector?.('#sbRestoreConfirm');
    const prev = btnConfirm?.textContent || '';
    if (btnCancel) btnCancel.disabled = true;
    if (btnConfirm) { btnConfirm.disabled = true; btnConfirm.textContent = 'Restoring…'; }

    try {
      await this.onConfirm(map);
      this.close();
    } catch (e) {
      this._setError(e?.message || String(e) || 'Restore failed');
      this._submitting = false;
      if (btnCancel) btnCancel.disabled = false;
      if (btnConfirm) { btnConfirm.disabled = false; btnConfirm.textContent = prev || 'Restore'; }
    }
  }
}
