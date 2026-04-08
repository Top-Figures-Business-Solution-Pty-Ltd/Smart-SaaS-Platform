/**
 * NotificationsService (website-safe)
 */
export class NotificationsService {
  static async list({ limitStart = 0, limit = 20, unreadOnly = false } = {}) {
    const r = await frappe.call({
      method: 'smart_accounting.api.notifications.get_my_notifications',
      args: {
        limit_start: Math.max(0, Number(limitStart) || 0),
        limit_page_length: Math.max(1, Number(limit) || 20),
        unread_only: unreadOnly ? 1 : 0,
      }
    });
    return {
      items: r?.message?.items || [],
      meta: r?.message?.meta || {},
    };
  }

  static async unreadCount() {
    const r = await frappe.call({
      method: 'smart_accounting.api.notifications.get_unread_count',
      args: {}
    });
    return Number(r?.message?.count) || 0;
  }

  static async markAsRead(name) {
    const docname = String(name || '').trim();
    if (!docname) return true;
    await frappe.call({
      method: 'smart_accounting.api.notifications.mark_as_read',
      args: { docname }
    });
    return true;
  }

  static async markAllAsRead() {
    await frappe.call({
      method: 'smart_accounting.api.notifications.mark_all_as_read',
      args: {}
    });
    return true;
  }
}


