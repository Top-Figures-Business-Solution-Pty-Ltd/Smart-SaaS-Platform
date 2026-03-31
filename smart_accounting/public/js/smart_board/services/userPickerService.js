import { MentionService } from './mentionService.js';

export class UserPickerService {
  static async defaultUserList({ limit = 20 } = {}) {
    try {
      const items = await MentionService.searchUsers('', { limit });
      return (items || []).map((u) => String(u?.name || '').trim()).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  static async searchUserNames(query, { limit = 12 } = {}) {
    try {
      const items = await MentionService.searchUsers(query, { limit });
      return (items || []).map((u) => String(u?.name || '').trim()).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  static async resolveUserMeta(values) {
    try {
      const arr = Array.isArray(values) ? values.filter(Boolean) : [];
      if (!arr.length) return {};
      const r = await frappe.call({
        method: 'smart_accounting.api.project_board.get_user_meta',
        args: { users: arr }
      });
      return r?.message || {};
    } catch (e) {
      return {};
    }
  }
}
