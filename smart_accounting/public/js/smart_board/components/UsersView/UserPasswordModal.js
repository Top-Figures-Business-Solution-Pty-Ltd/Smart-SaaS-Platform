import { Modal } from '../Common/Modal.js';
import { PasswordService } from '../../services/passwordService.js';

export class UserPasswordModal {
  constructor({ user = null, onSubmit, onClose } = {}) {
    this.user = user || null;
    this.onSubmit = onSubmit || (async () => {});
    this.onClose = onClose || (() => {});
    this._modal = null;
    this._root = null;
  }

  async open() {
    this.close();
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="sb-userpwd">
        <div class="sb-newproj__row">
          <label class="sb-newproj__label">New Password *</label>
          <input class="form-control" id="sbUserNewPassword" type="password" placeholder="Enter new password" />
        </div>
        <div class="sb-newproj__row">
          <label class="sb-newproj__label">Confirm Password *</label>
          <input class="form-control" id="sbUserConfirmPassword" type="password" placeholder="Re-enter new password" />
        </div>
        <div class="text-muted" id="sbUserPwdHint" style="font-size:12px;margin-top:6px;"></div>
        <div class="sb-newproj__error text-danger" id="sbUserPwdError" style="display:none;margin-top:12px;"></div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';
    footer.innerHTML = `
      <button class="btn btn-default" type="button" id="sbUserPwdCancel">Cancel</button>
      <button class="btn btn-primary" type="button" id="sbUserPwdSave">Set Password</button>
    `;

    this._modal = new Modal({
      title: `Set Password · ${String(this.user?.full_name || this.user?.name || 'User')}`,
      contentEl: content,
      footerEl: footer,
      onClose: () => this.onClose(),
    });
    this._modal.open();
    this._root = content;

    const pwd = content.querySelector('#sbUserNewPassword');
    pwd?.addEventListener('input', async () => {
      const hint = content.querySelector('#sbUserPwdHint');
      if (!hint) return;
      const out = await PasswordService.testStrength(pwd?.value || '');
      const feedback = String(out?.feedback || out?.warning || '').trim();
      hint.textContent = feedback || '';
    });

    footer.querySelector('#sbUserPwdCancel')?.addEventListener('click', () => this.close());
    footer.querySelector('#sbUserPwdSave')?.addEventListener('click', () => this._handleSubmit());
  }

  close() {
    this._modal?.close?.();
    this._modal = null;
    this._root = null;
  }

  _setError(msg) {
    const el = this._root?.querySelector?.('#sbUserPwdError');
    if (!el) return;
    const text = String(msg || '').trim();
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
  }

  async _handleSubmit() {
    const password = String(this._root?.querySelector?.('#sbUserNewPassword')?.value || '');
    const confirm = String(this._root?.querySelector?.('#sbUserConfirmPassword')?.value || '');
    const name = String(this.user?.name || '').trim();
    this._setError('');
    if (!password) {
      this._setError('New Password is required');
      return;
    }
    if (password !== confirm) {
      this._setError('Passwords do not match');
      return;
    }

    const btn = this._modal?._overlay?.querySelector?.('#sbUserPwdSave');
    if (btn) btn.disabled = true;
    try {
      await this.onSubmit({ name, new_password: password });
      this.close();
    } catch (e) {
      this._setError(e?.message || String(e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }
}
