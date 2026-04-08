/**
 * ActivityLogApp (website-safe)
 * - Shows project/client create/update/delete events with filters.
 */
import { ActivityLogService } from '../../services/activityLogService.js';
import { escapeHtml } from '../../utils/dom.js';
import { notify } from '../../services/uiAdapter.js';

export class ActivityLogApp {
  constructor(container, { app } = {}) {
    this.container = container;
    this.app = app || null;
    this._state = {
      items: [],
      loading: false,
      error: null,
      limit: 50,
      offset: 0,
      hasMore: true,
      totalCount: 0,
      unlocked: false,
    };
    this._filters = {
      user: '',
      target: '',
      activity: '',
      password: '',
    };
    this._users = [];
  }

  async init() {
    await this._loadUsers();
    await this._fetch(true);
    this.render();
    this._bind();
  }

  destroy() {
    try { this.container.innerHTML = ''; } catch (e) {}
  }

  async _loadUsers() {
    try {
      this._users = await ActivityLogService.fetchUsers();
    } catch (e) {
      this._users = [];
    }
  }

  async _fetch(reset = false) {
    if (this._state.loading) return;
    this._state.loading = true;
    this._state.error = null;
    if (reset) {
      this._state.offset = 0;
      this._state.hasMore = true;
    }
    this.render();
    try {
      const r = await ActivityLogService.fetchActivityLog({
        limitStart: this._state.offset,
        limit: this._state.limit,
        user: this._filters.user,
        target: this._filters.target,
        activity: this._filters.activity,
        password: this._filters.password,
      });
      const items = r?.items || [];
      const unlocked = !!r?.meta?.unlocked;
      if (reset) {
        this._state.items = items;
      } else {
        this._state.items = [...(this._state.items || []), ...items];
      }
      this._state.unlocked = unlocked;
      this._state.totalCount = Number(r?.meta?.total_count || this._state.items.length || 0);
      this._state.hasMore = (this._state.items || []).length < this._state.totalCount;
      this._state.offset = (this._state.items || []).length;
    } catch (e) {
      this._state.error = e?.message || String(e);
    } finally {
      this._state.loading = false;
      this.render();
    }
  }

  _bind() {
    this.container.addEventListener('click', (e) => {
      const refreshBtn = e.target?.closest?.('#sbActivityRefresh');
      if (refreshBtn) {
        e.preventDefault();
        this._fetch(true);
        return;
      }
      const unlockBtn = e.target?.closest?.('#sbActivityUnlock');
      if (unlockBtn) {
        e.preventDefault();
        const pwd = this.container.querySelector('#sbActivityPassword')?.value || '';
        this._filters.password = String(pwd || '');
        this._fetch(true);
        return;
      }
      const clearBtn = e.target?.closest?.('#sbActivityClearPassword');
      if (clearBtn) {
        e.preventDefault();
        this._filters.password = '';
        const input = this.container.querySelector('#sbActivityPassword');
        if (input) input.value = '';
        this._fetch(true);
        return;
      }
      const loadMore = e.target?.closest?.('#sbActivityLoadMore');
      if (loadMore) {
        e.preventDefault();
        this._fetch(false);
      }
    });

    this.container.addEventListener('change', (e) => {
      const userSel = e.target?.closest?.('#sbActivityUser');
      const targetSel = e.target?.closest?.('#sbActivityTarget');
      const actSel = e.target?.closest?.('#sbActivityType');
      if (userSel || targetSel || actSel) {
        this._filters.user = String(userSel?.value || this._filters.user || '');
        this._filters.target = String(targetSel?.value || this._filters.target || '');
        this._filters.activity = String(actSel?.value || this._filters.activity || '');
        this._fetch(true);
      }
    });
  }

  render() {
    const { items, loading, error, hasMore, unlocked, totalCount } = this._state;
    const userOptions = [
      '<option value="">All users</option>',
      ...this._users.map((u) => {
        const val = escapeHtml(u?.user || '');
        const label = escapeHtml(u?.label || u?.user || '');
        return `<option value="${val}">${label}</option>`;
      })
    ].join('');

    const rows = (items || []).map((ev) => {
      const time = escapeHtml(ev?.timestamp || '');
      const user = escapeHtml(ev?.user_label || 'Someone');
      const action = escapeHtml(ev?.action || 'Update');
      const target = escapeHtml(ev?.target_label || 'a record');
      const name = escapeHtml(ev?.doc_label || '—');
      return `
        <tr>
          <td>${time}</td>
          <td>${user}</td>
          <td>${action}</td>
          <td>${target}</td>
          <td>${name}</td>
        </tr>
      `;
    }).join('');

    this.container.innerHTML = `
      <div class="sb-page">
        <div class="sb-activity__bar">
          <div class="sb-activity__filters">
            <select class="form-control" id="sbActivityUser">${userOptions}</select>
            <select class="form-control" id="sbActivityTarget">
              <option value="">All targets</option>
              <option value="project">Projects</option>
              <option value="client">Clients</option>
            </select>
            <select class="form-control" id="sbActivityType">
              <option value="">All activity</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
            </select>
          </div>
          <div class="sb-activity__actions">
            <input class="form-control" id="sbActivityPassword" type="password" placeholder="Password to unlock details" />
            <button class="btn btn-default" id="sbActivityUnlock">Unlock</button>
            <button class="btn btn-default" id="sbActivityClearPassword">Lock</button>
            <button class="btn btn-default" id="sbActivityRefresh">Refresh</button>
            <span class="sb-activity__status ${unlocked ? 'is-unlocked' : ''}">
              ${unlocked ? 'Unlocked' : 'Locked'}
            </span>
          </div>
        </div>

        <div class="sb-table-scroll sb-activity__table-wrap">
          <div class="text-muted" style="font-size:12px; padding:12px 12px 0 12px;">Showing ${(items || []).length} of ${Math.max((items || []).length, Number(totalCount) || 0)}</div>
          <table class="table table-borderless sb-activity__table" style="margin:0;">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Target</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              ${rows || ''}
            </tbody>
          </table>
          ${!rows && !loading && !error ? `<div class="text-muted" style="padding:12px;">No activity found.</div>` : ''}
          ${error ? `<div class="text-danger" style="padding:12px;">${escapeHtml(error)}</div>` : ''}
          ${loading ? `<div class="text-muted" style="padding:12px;">Loading…</div>` : ''}
        </div>

        <div style="display:flex; justify-content:flex-end; margin-top:10px;">
          <button class="btn btn-default" id="sbActivityLoadMore" ${!hasMore || loading ? 'disabled' : ''}>
            ${loading ? 'Loading…' : (hasMore ? 'Load more' : 'No more')}
          </button>
        </div>
      </div>
    `;

    // Sync selects after re-render
    this.container.querySelector('#sbActivityUser')?.setAttribute('value', this._filters.user || '');
    this.container.querySelector('#sbActivityTarget')?.setAttribute('value', this._filters.target || '');
    this.container.querySelector('#sbActivityType')?.setAttribute('value', this._filters.activity || '');
    const userSel = this.container.querySelector('#sbActivityUser');
    if (userSel && this._filters.user) userSel.value = this._filters.user;
    const targetSel = this.container.querySelector('#sbActivityTarget');
    if (targetSel && this._filters.target) targetSel.value = this._filters.target;
    const actSel = this.container.querySelector('#sbActivityType');
    if (actSel && this._filters.activity) actSel.value = this._filters.activity;
  }
}


