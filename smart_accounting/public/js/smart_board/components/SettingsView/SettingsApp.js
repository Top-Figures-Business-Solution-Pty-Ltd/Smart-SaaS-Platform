/**
 * SettingsApp
 * - Currently only implements "My Settings" -> Change Password.
 */
import { ChangePasswordForm } from './ChangePasswordForm.js';
import { ProfileForm } from './ProfileForm.js';
import { ProjectEntitySyncTools } from './ProjectEntitySyncTools.js';

export class SettingsApp {
  constructor(container, { initialTab } = {}) {
    this.container = container;
    this._form = null;
    this._active = initialTab || 'profile';
    this._onNavClick = null;
  }

  init() {
    const showDebug = this._isDebugEnabled() && this._isProbablyAdmin();
    if (!showDebug && this._active === 'debug') this._active = 'profile';
    const isProfile = this._active === 'profile';
    const isPassword = this._active === 'password';
    const isDebug = this._active === 'debug';
    this.container.innerHTML = `
      <div class="sb-page">
        <div class="sb-settings">
          <div class="sb-settings__nav" id="sbSettingsNav">
            <button class="sb-settings__tab ${isProfile ? 'sb-settings__tab--active' : ''}" type="button" data-key="profile">My Profile</button>
            <button class="sb-settings__tab ${isPassword ? 'sb-settings__tab--active' : ''}" type="button" data-key="password">Change Password</button>
            <button class="sb-settings__tab" type="button" data-key="prefs" disabled title="Coming soon">Personal Preferences</button>
            <button class="sb-settings__tab" type="button" data-key="notifs" disabled title="Coming soon">Notification Preferences</button>
            ${showDebug ? `<button class="sb-settings__tab ${isDebug ? 'sb-settings__tab--active' : ''}" type="button" data-key="debug">Debug Tools</button>` : ''}
          </div>
          <div class="sb-settings__content" id="sbSettingsContent"></div>
        </div>
      </div>
    `;

    this._mountActive();
    this._bind();
  }

  _bind() {
    const nav = this.container.querySelector('#sbSettingsNav');
    if (!nav) return;
    this._onNavClick = (e) => {
      const btn = e.target?.closest?.('button[data-key]');
      if (!btn) return;
      const key = String(btn.getAttribute('data-key') || '');
      if (!key || btn.disabled) return;
      this._active = key;
      this._renderNavActive();
      this._mountActive();
    };
    nav.addEventListener('click', this._onNavClick);
  }

  _renderNavActive() {
    const nav = this.container.querySelector('#sbSettingsNav');
    if (!nav) return;
    nav.querySelectorAll('button[data-key]').forEach((b) => {
      const k = String(b.getAttribute('data-key') || '');
      b.classList.toggle('sb-settings__tab--active', k === this._active);
    });
  }

  _mountActive() {
    const mount = this.container.querySelector('#sbSettingsContent');
    if (!mount) return;
    try { this._form?.destroy?.(); } catch (e) {}
    this._form = null;

    if (this._active === 'profile') {
      this._form = new ProfileForm(mount);
      this._form.render();
      return;
    }
    if (this._active === 'debug') {
      this._form = new ProjectEntitySyncTools(mount);
      this._form.render();
      return;
    }
    // Password (fallback)
    this._form = new ChangePasswordForm(mount);
    this._form.render();
  }

  _isDebugEnabled() {
    try {
      const u = new URL(window.location.href);
      const qp = String(u.searchParams.get('sb_debug') || '').trim();
      if (qp === '1' || qp.toLowerCase() === 'true') return true;
    } catch (e) {}
    try {
      const v = String(window?.localStorage?.getItem?.('sb_debug') || '').trim();
      if (v === '1' || v.toLowerCase() === 'true') return true;
    } catch (e) {}
    return false;
  }

  _isProbablyAdmin() {
    try {
      const user = String(frappe?.session?.user || '').trim();
      if (user === 'Administrator') return true;
    } catch (e) {}
    try {
      const roles = (frappe?.boot?.user?.roles) || frappe?.user_roles || [];
      if (Array.isArray(roles) && roles.map(String).includes('System Manager')) return true;
    } catch (e) {}
    return false;
  }

  destroy() {
    try { this._form?.destroy?.(); } catch (e) {}
    this._form = null;
    try {
      const nav = this.container.querySelector('#sbSettingsNav');
      if (nav && this._onNavClick) nav.removeEventListener('click', this._onNavClick);
    } catch (e) {}
    this._onNavClick = null;
    this.container.innerHTML = '';
  }
}


