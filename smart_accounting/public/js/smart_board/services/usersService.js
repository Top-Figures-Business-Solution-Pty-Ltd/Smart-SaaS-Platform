import { Perf } from '../utils/perf.js';

export class UsersService {
  static async fetchUsers({ search = '', limitStart = 0, limit = 100 } = {}) {
    return await Perf.timeAsync('users.get_users', async () => {
      const r = await frappe.call({
        method: 'smart_accounting.api.users.get_users',
        args: {
          search: String(search || ''),
          limit_start: Math.max(0, Number(limitStart) || 0),
          limit_page_length: Math.max(1, Number(limit) || 100),
        }
      });
      return {
        items: r?.message?.items || [],
        meta: r?.message?.meta || {},
      };
    }, () => ({
      search: String(search || ''),
      limitStart: Number(limitStart) || 0,
      limit: Number(limit) || 100,
    }));
  }

  static async createUser(payload = {}) {
    const r = await frappe.call({
      method: 'smart_accounting.api.users.create_user',
      type: 'POST',
      args: { payload },
    });
    return r?.message?.item || null;
  }

  static async updateUser(payload = {}) {
    const r = await frappe.call({
      method: 'smart_accounting.api.users.update_user',
      type: 'POST',
      args: { payload },
    });
    return r?.message?.item || null;
  }

  static async setUserPassword({ name, newPassword } = {}) {
    const r = await frappe.call({
      method: 'smart_accounting.api.users.set_user_password',
      type: 'POST',
      args: {
        payload: {
          name: String(name || '').trim(),
          new_password: String(newPassword || ''),
        }
      },
    });
    return !!r?.message?.ok;
  }
}
