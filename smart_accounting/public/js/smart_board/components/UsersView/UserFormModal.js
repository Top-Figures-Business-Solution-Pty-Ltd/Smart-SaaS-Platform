import { Modal } from '../Common/Modal.js';
import { escapeHtml } from '../../utils/dom.js';
import { PasswordService } from '../../services/passwordService.js';

export class UserFormModal {
  constructor({ title = 'User', initial = {}, submitLabel = 'Save', onSubmit, onClose } = {}) {
    this.title = title;
    this.initial = initial || {};
    this.submitLabel = submitLabel;
    this.onSubmit = onSubmit || (async () => {});
    this.onClose = onClose || (() => {});
    this._modal = null;
    this._root = null;
  }

  async open() {
    this.close();
    const isCreate = !String(this.initial?.name || '').trim();
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="sb-userform">
        <div class="sb-newproj__row">
          <label class="sb-newproj__label">Full Name *</label>
          <input class="form-control" id="sbUserFullName" type="text" placeholder="e.g. Jeffrey Wang" />
        </div>
        <div class="sb-newproj__row">
          <label class="sb-newproj__label">Email ${isCreate ? '*' : ''}</label>
          <input class="form-control" id="sbUserEmail" type="email" placeholder="e.g. user@example.com" ${isCreate ? '' : 'disabled'} />
        </div>
        ${isCreate ? `
          <div class="sb-newproj__row">
            <label class="sb-newproj__label">Initial Password *</label>
            <input class="form-control" id="sbUserPassword" type="password" placeholder="Temporary password" />
            <div class="text-muted" id="sbUserPasswordHint" style="font-size:12px;margin-top:6px;"></div>
          </div>
        ` : ''}
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:8px;">
          <label style="display:flex;gap:8px;align-items:center;">
            <input id="sbUserEnabled" type="checkbox" />
            <span>Enabled</span>
          </label>
          <label style="display:flex;gap:8px;align-items:center;">
            <input id="sbUserAccounting" type="checkbox" />
            <span>Smart Accounting Access</span>
          </label>
          <label style="display:flex;gap:8px;align-items:center;">
            <input id="sbUserGrants" type="checkbox" />
            <span>Smart Grants Access</span>
          </label>
        </div>
        <div class="sb-newproj__error text-danger" id="sbUserFormError" style="display:none;margin-top:12px;"></div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';
    footer.innerHTML = `
      <button class="btn btn-default" type="button" id="sbUserCancel">Cancel</button>
      <button class="btn btn-primary" type="button" id="sbUserSave">${escapeHtml(this.submitLabel)}</button>
    `;

    this._modal = new Modal({
      title: this.title,
      contentEl: content,
      footerEl: footer,
      onClose: () => this.onClose(),
    });
    this._modal.open();
    this._root = content;

    content.querySelector('#sbUserFullName').value = this.initial?.full_name || '';
    content.querySelector('#sbUserEmail').value = this.initial?.email || this.initial?.name || '';
    content.querySelector('#sbUserEnabled').checked = Number(this.initial?.enabled ?? 1) !== 0;
    content.querySelector('#sbUserAccounting').checked = !!this.initial?.smart_accounting_access;
    content.querySelector('#sbUserGrants').checked = !!this.initial?.smart_grants_access;

    const pwd = content.querySelector('#sbUserPassword');
    pwd?.addEventListener('input', async () => {
      const hint = content.querySelector('#sbUserPasswordHint');
      if (!hint) return;
      const out = await PasswordService.testStrength(pwd?.value || '');
      const feedback = String(out?.feedback || out?.warning || '').trim();
      hint.textContent = feedback || '';
    });

    footer.querySelector('#sbUserCancel')?.addEventListener('click', () => this.close());
    footer.querySelector('#sbUserSave')?.addEventListener('click', () => this._handleSubmit());
  }

  close() {
    this._modal?.close?.();
    this._modal = null;
    this._root = null;
  }

  _setError(msg) {
    const el = this._root?.querySelector?.('#sbUserFormError');
    if (!el) return;
    const text = String(msg || '').trim();
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
  }

  _getPayload() {
    const isCreate = !String(this.initial?.name || '').trim();
    return {
      name: String(this.initial?.name || '').trim(),
      full_name: String(this._root?.querySelector?.('#sbUserFullName')?.value || '').trim(),
      email: String(this._root?.querySelector?.('#sbUserEmail')?.value || '').trim(),
      password: isCreate ? String(this._root?.querySelector?.('#sbUserPassword')?.value || '') : '',
      enabled: !!this._root?.querySelector?.('#sbUserEnabled')?.checked,
      smart_accounting_access: !!this._root?.querySelector?.('#sbUserAccounting')?.checked,
      smart_grants_access: !!this._root?.querySelector?.('#sbUserGrants')?.checked,
    };
  }

  async _handleSubmit() {
    this._setError('');
    const payload = this._getPayload();
    const isCreate = !String(this.initial?.name || '').trim();
    if (!payload.full_name) {
      this._setError('Full Name is required');
      return;
    }
    if (isCreate && !payload.email) {
      this._setError('Email is required');
      return;
    }
    if (isCreate && !payload.password) {
      this._setError('Initial Password is required');
      return;
    }

    const btn = this._modal?._overlay?.querySelector?.('#sbUserSave');
    if (btn) btn.disabled = true;
    try {
      await this.onSubmit(payload);
      this.close();
    } catch (e) {
      this._setError(e?.message || String(e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }
}
