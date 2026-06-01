/**
 * AutomationService
 * - Data access layer for Board Automation CRUD.
 * - Website-safe (uses frappe.call).
 */

const API_BASE = 'smart_accounting.api.automation';

export class AutomationService {
  /**
   * Get metadata: available trigger types, action types, and their config schemas.
   */
  static async getMeta(module = '') {
    const r = await frappe.call({
      method: `${API_BASE}.get_automation_meta`,
      quiet: true,
      args: { module: String(module || '') },
    });
    return r?.message || { triggers: {}, actions: {} };
  }

  /**
   * List all automation rules.
   */
  static async getAutomations({ limitStart = 0, limit = 50, search = '', module = '' } = {}) {
    const r = await frappe.call({
      method: `${API_BASE}.get_automations`,
      quiet: true,
      args: {
        limit_start: Math.max(0, Number(limitStart) || 0),
        limit_page_length: Math.max(1, Number(limit) || 50),
        search: String(search || ''),
        module: String(module || ''),
      },
    });
    return {
      items: r?.message?.items || [],
      meta: r?.message?.meta || {},
    };
  }

  /**
   * Create or update an automation rule.
   * actions: array of { action_type, config }
   */
  static async saveAutomation({ name, enabled, automation_name, trigger_type, trigger_config, actions, module = '' } = {}) {
    const r = await frappe.call({
      method: `${API_BASE}.save_automation`,
      quiet: true,
      args: {
        name: name || '',
        enabled: enabled ? 1 : 0,
        automation_name: String(automation_name || '').trim(),
        trigger_type,
        trigger_config: typeof trigger_config === 'string' ? trigger_config : JSON.stringify(trigger_config || {}),
        actions: typeof actions === 'string' ? actions : JSON.stringify(actions || []),
        module: String(module || ''),
      },
    });
    return r?.message || {};
  }

  /**
   * Toggle automation enabled/disabled.
   */
  static async toggleAutomation(name, enabled) {
    const r = await frappe.call({
      method: `${API_BASE}.toggle_automation`,
      quiet: true,
      args: { name, enabled: enabled ? 1 : 0 },
    });
    return r?.message || {};
  }

  /**
   * Delete an automation rule.
   */
  static async deleteAutomation(name) {
    const r = await frappe.call({
      method: `${API_BASE}.delete_automation`,
      quiet: true,
      args: { name },
    });
    return r?.message || {};
  }
}
