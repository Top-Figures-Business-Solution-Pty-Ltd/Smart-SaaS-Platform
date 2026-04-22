/**
 * BoardSettingsService
 * - Data access for board-level settings (currently Project Type order).
 */
import { notify } from './uiAdapter.js';

export class BoardSettingsService {
  static async getProjectTypeOrder() {
    try {
      const r = await frappe.call({
        method: 'smart_accounting.api.board_settings.get_project_type_order',
        type: 'GET',
        args: {},
      });
      return r?.message || { order: [], all: [] };
    } catch (e) {
      notify(`Failed to load board settings: ${e?.message || String(e)}`, 'red');
      throw e;
    }
  }

  static async setProjectTypeOrder(order = []) {
    try {
      const r = await frappe.call({
        method: 'smart_accounting.api.board_settings.set_project_type_order',
        type: 'POST',
        args: { order },
      });
      return r?.message || { ok: true };
    } catch (e) {
      notify(`Failed to save board settings: ${e?.message || String(e)}`, 'red');
      throw e;
    }
  }

  static async fetchOrderedProjectTypes() {
    try {
      const r = await frappe.call({
        method: 'smart_accounting.api.board_settings.get_project_types',
        type: 'GET',
        args: {},
      });
      const items = r?.message?.items || [];
      return items.map((x) => x?.name).filter(Boolean);
    } catch (e) {
      // fallback: let caller handle
      return [];
    }
  }

  static async getSpecialRuleFlag(key) {
    try {
      const r = await frappe.call({
        method: 'smart_accounting.api.board_settings.get_special_rule_flag',
        type: 'GET',
        args: { key },
      });
      return r?.message || { key, enabled: true };
    } catch (e) {
      notify(`Failed to load special rule flag: ${e?.message || String(e)}`, 'red');
      throw e;
    }
  }

  static async setSpecialRuleFlag(key, enabled) {
    try {
      const r = await frappe.call({
        method: 'smart_accounting.api.board_settings.set_special_rule_flag',
        type: 'POST',
        args: { key, enabled: enabled ? 1 : 0 },
      });
      return r?.message || { ok: true, key, enabled: !!enabled };
    } catch (e) {
      notify(`Failed to save special rule flag: ${e?.message || String(e)}`, 'red');
      throw e;
    }
  }
}


