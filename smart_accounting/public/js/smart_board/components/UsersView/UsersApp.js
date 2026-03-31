import { UsersService } from '../../services/usersService.js';
import { escapeHtml } from '../../utils/dom.js';
import { notify } from '../../services/uiAdapter.js';
import { isAdminLike } from '../../utils/authz.js';
import { UserFormModal } from './UserFormModal.js';
import { UserPasswordModal } from './UserPasswordModal.js';

export class UsersApp {
  constructor(container) {
    this.container = container;
    this._state = {
      items: [],
      loading: false,
      error: null,
      search: '',
      totalCount: 0,
      canManageUsers: false,
    };
    this._bind = this._bind.bind(this);
    this._onClick = this._onClick.bind(this);
    this._searchTimer = null;
  }

  async init() {
    this.render();
    this.container.addEventListener('input', this._bind);
    this.container.addEventListener('click', this._onClick);
    await this._fetch({ reset: true });
  }

  destroy() {
    try { this.container.removeEventListener('input', this._bind); } catch (e) {}
    try { this.container.removeEventListener('click', this._onClick); } catch (e) {}
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    try { this.container.innerHTML = ''; } catch (e) {}
  }

  _bind(e) {
    const input = e.target?.closest?.('#sbUsersSearch');
    if (!input) return;
    this._state.search = String(input.value || '');
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this._fetch({ reset: true });
    }, 180);
  }

  _onClick(e) {
    const createBtn = e.target?.closest?.('#sbUsersCreate');
    if (createBtn) {
      e.preventDefault();
      this._openCreateUserModal();
      return;
    }

    const editBtn = e.target?.closest?.('[data-action="edit-user"]');
    if (editBtn) {
      e.preventDefault();
      const name = String(editBtn.getAttribute('data-name') || '').trim();
      const user = (this._state.items || []).find((x) => String(x?.name || '').trim() === name) || null;
      if (user) this._openEditUserModal(user);
      return;
    }

    const pwdBtn = e.target?.closest?.('[data-action="set-password"]');
    if (pwdBtn) {
      e.preventDefault();
      const name = String(pwdBtn.getAttribute('data-name') || '').trim();
      const user = (this._state.items || []).find((x) => String(x?.name || '').trim() === name) || null;
      if (user) this._openPasswordModal(user);
    }
  }

  async _fetch({ reset = false } = {}) {
    this._state.loading = true;
    this._state.error = null;
    this.render();
    try {
      const r = await UsersService.fetchUsers({
        search: this._state.search,
        limitStart: 0,
        limit: 200,
      });
      this._state.items = Array.isArray(r?.items) ? r.items : [];
      this._state.totalCount = Number(r?.meta?.total_count || this._state.items.length || 0);
      this._state.canManageUsers = !!(r?.meta?.can_manage_users ?? isAdminLike());
    } catch (e) {
      this._state.error = e?.message || String(e);
      if (reset) this._state.items = [];
      this._state.totalCount = 0;
      this._state.canManageUsers = isAdminLike();
    } finally {
      this._state.loading = false;
      this.render();
    }
  }

  async _openCreateUserModal() {
    const modal = new UserFormModal({
      title: 'New User',
      submitLabel: 'Create',
      initial: {
        enabled: 1,
        smart_accounting_access: false,
        smart_grants_access: false,
      },
      onSubmit: async (payload) => {
        await UsersService.createUser(payload);
        notify('User created', 'green');
        await this._fetch({ reset: true });
      }
    });
    await modal.open();
  }

  async _openEditUserModal(user) {
    if (Number(user?.locked || 0)) return;
    const modal = new UserFormModal({
      title: 'Edit User',
      submitLabel: 'Save',
      initial: user,
      onSubmit: async (payload) => {
        await UsersService.updateUser({
          name: user?.name,
          full_name: payload?.full_name,
          enabled: payload?.enabled,
          smart_accounting_access: payload?.smart_accounting_access,
          smart_grants_access: payload?.smart_grants_access,
        });
        notify('User updated', 'green');
        await this._fetch({ reset: true });
      }
    });
    await modal.open();
  }

  async _openPasswordModal(user) {
    if (Number(user?.locked || 0)) return;
    const modal = new UserPasswordModal({
      user,
      onSubmit: async ({ name, new_password } = {}) => {
        await UsersService.setUserPassword({ name, newPassword: new_password });
        notify('Password updated', 'green');
      }
    });
    await modal.open();
  }

  render() {
    const { items, loading, error, search, totalCount, canManageUsers } = this._state;
    const rows = (items || []).map((user) => {
      const fullName = escapeHtml(user?.full_name || user?.name || 'Unknown User');
      const email = escapeHtml(user?.email || user?.name || '');
      const img = escapeHtml(user?.user_image || '');
      const access = [
        user?.smart_accounting_access ? '<span class="status-badge" style="background:#dbeafe;color:#1d4ed8;">Accounting</span>' : '',
        user?.smart_grants_access ? '<span class="status-badge" style="background:#ede9fe;color:#6d28d9;">Grants</span>' : '',
      ].filter(Boolean).join(' ');
      const disabled = Number(user?.enabled || 0) ? '' : '<span class="text-muted" style="font-size:12px;">Disabled</span>';
      const initial = escapeHtml(String(user?.full_name || user?.name || 'U').trim().charAt(0).toUpperCase() || 'U');
      const actions = canManageUsers && !Number(user?.locked || 0)
        ? `
          <button class="btn btn-default btn-xs" data-action="edit-user" data-name="${escapeHtml(user?.name || '')}">Edit</button>
          <button class="btn btn-default btn-xs" data-action="set-password" data-name="${escapeHtml(user?.name || '')}">Set Password</button>
        `
        : (Number(user?.locked || 0) ? '<span class="text-muted" style="font-size:12px;">Managed in ERPNext</span>' : '');
      return `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:10px;">
              ${img
                ? `<img src="${img}" alt="" style="width:28px;height:28px;border-radius:999px;object-fit:cover;" />`
                : `<span style="width:28px;height:28px;border-radius:999px;background:#e5e7eb;color:#374151;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;">${initial}</span>`}
              <div>
                <div style="font-weight:600;">${fullName}</div>
                ${disabled}
              </div>
            </div>
          </td>
          <td><a href="mailto:${email}">${email}</a></td>
          <td>${access || '<span class="text-muted">No module access</span>'}</td>
          <td style="white-space:nowrap;">${actions}</td>
        </tr>
      `;
    }).join('');

    this.container.innerHTML = `
      <div class="sb-page">
        <div class="sb-users__bar" style="display:flex;gap:12px;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <input
              id="sbUsersSearch"
              class="form-control"
              type="search"
              placeholder="Search name or email"
              value="${escapeHtml(search)}"
              style="max-width:320px;"
            />
            <div class="text-muted" style="font-size:13px;">${loading ? 'Loading users...' : `${totalCount} users`}</div>
          </div>
          ${canManageUsers ? `<button class="btn btn-primary" id="sbUsersCreate" type="button">New User</button>` : ''}
        </div>

        ${error ? `<div class="text-danger" style="margin-bottom:12px;">${escapeHtml(error)}</div>` : ''}

        <div class="sb-users__table-wrap" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <table class="table table-bordered" style="margin:0;">
            <thead>
              <tr>
                <th style="width:34%;">Name</th>
                <th>Email</th>
                <th style="width:24%;">Access</th>
                <th style="width:22%;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;">${loading ? 'Loading...' : 'No users found.'}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}
