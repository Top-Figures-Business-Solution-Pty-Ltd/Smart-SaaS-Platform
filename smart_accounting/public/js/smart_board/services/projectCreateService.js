/**
 * ProjectCreateService
 * - Data access for creating Projects from the product shell (/smart).
 * - Kept separate from ProjectService to avoid mixing list/query logic with creation workflow.
 */
import { notify } from './uiAdapter.js';
import { getErrorMessage } from '../utils/errorMessage.js';
import { isDesk } from '../utils/env.js';

export class ProjectCreateService {
  static _defaultCompany = undefined;
  static _currentFiscalYear = undefined;
  static _adHocCustomer = undefined;

  static async getDefaultCompany() {
    if (this._defaultCompany !== undefined) return this._defaultCompany;
    try {
      const r = await frappe.call({
        method: 'frappe.client.get_list',
        args: {
          doctype: 'Company',
          fields: ['name'],
          order_by: 'creation asc',
          limit_page_length: 1,
        }
      });
      this._defaultCompany = String(r?.message?.[0]?.name || '').trim();
    } catch (e) {
      this._defaultCompany = '';
    }
    return this._defaultCompany;
  }

  static async getCurrentFiscalYear() {
    if (this._currentFiscalYear !== undefined) return this._currentFiscalYear;
    const today = new Date().toISOString().slice(0, 10);
    try {
      const r = await frappe.call({
        method: 'frappe.client.get_list',
        args: {
          doctype: 'Fiscal Year',
          fields: ['name'],
          filters: [
            ['year_start_date', '<=', today],
            ['year_end_date', '>=', today],
          ],
          order_by: 'year_start_date desc, creation desc',
          limit_page_length: 1,
        }
      });
      this._currentFiscalYear = String(r?.message?.[0]?.name || '').trim();
      if (this._currentFiscalYear) return this._currentFiscalYear;
    } catch (e) {
      this._currentFiscalYear = '';
    }

    try {
      const r = await frappe.call({
        method: 'frappe.client.get_list',
        args: {
          doctype: 'Fiscal Year',
          fields: ['name'],
          order_by: 'year_start_date desc, creation desc',
          limit_page_length: 1,
        }
      });
      this._currentFiscalYear = String(r?.message?.[0]?.name || '').trim();
    } catch (e) {
      this._currentFiscalYear = '';
    }
    return this._currentFiscalYear;
  }

  static async getDefaultFiscalYear() {
    return await this.getCurrentFiscalYear();
  }

  static async getOrCreateAdHocCustomer() {
    if (this._adHocCustomer !== undefined) return this._adHocCustomer;

    const customerName = 'Ad-Hoc';
    const findExisting = async () => {
      const r = await frappe.call({
        method: 'frappe.client.get_list',
        args: {
          doctype: 'Customer',
          fields: ['name', 'customer_name'],
          or_filters: [
            ['name', '=', customerName],
            ['customer_name', '=', customerName],
            ['name', '=', 'ad-hoc'],
            ['customer_name', '=', 'ad-hoc'],
          ],
          order_by: 'creation asc',
          limit_page_length: 1,
        }
      });
      return String(r?.message?.[0]?.name || '').trim();
    };

    try {
      const existing = await findExisting();
      if (existing) {
        this._adHocCustomer = existing;
        return this._adHocCustomer;
      }

      const created = await frappe.call({
        method: 'smart_accounting.api.clients.create_client',
        type: 'POST',
        args: {
          payload: {
            customer_name: customerName,
            customer_type: 'Company',
          },
        },
      });
      const createdName = String(created?.message?.item?.name || '').trim();
      this._adHocCustomer = createdName || await findExisting();
      if (!this._adHocCustomer) throw new Error('Create Ad-Hoc client failed');
      return this._adHocCustomer;
    } catch (e) {
      // If another user/session created it between lookup and insert, reuse it.
      try {
        const existing = await findExisting();
        if (existing) {
          this._adHocCustomer = existing;
          return this._adHocCustomer;
        }
      } catch (lookupError) {}

      const msg = getErrorMessage(e) || 'Create Ad-Hoc client failed';
      throw new Error(msg);
    }
  }

  /**
   * Create a new Project using frappe.client.insert.
   * Returns the created doc (best-effort).
   */
  static async createProject(payload = {}, options = {}) {
    const doc = {
      doctype: 'Project',
      ...payload,
    };

    // Keep minimal required fields; other fields (e.g. status) can be set later by the user.
    const required = Array.isArray(options?.requiredFields) && options.requiredFields.length
      ? options.requiredFields
      : ['project_name', 'customer', 'company', 'custom_fiscal_year', 'project_type'];
    const missing = required.filter((k) => !String(doc?.[k] || '').trim());
    if (missing.length) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    try {
      const r = await frappe.call({
        method: 'frappe.client.insert',
        type: 'POST',
        // Prevent server-side msgprint popups from interrupting /smart UX.
        silent: true,
        args: { doc }
      });
      return r?.message || null;
    } catch (e) {
      const msg = getErrorMessage(e) || 'Create project failed';
      // Website shell: do not use alert() popups; surface the message in the modal only.
      if (isDesk()) notify(`Create project failed: ${msg}`, 'red');
      throw new Error(msg);
    }
  }
}


