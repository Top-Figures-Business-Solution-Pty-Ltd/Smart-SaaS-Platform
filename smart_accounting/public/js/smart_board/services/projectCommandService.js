/**
 * ProjectCommandService
 * - Write/command paths for Projects/Tasks used by Smart Board.
 * - No UI dependencies; errors bubble up to callers.
 */

import { ApiService } from './api.js';

export class ProjectCommandService {
  /**
   * 更新Project字段
   */
  static async updateProject(name, data) {
    return ApiService.updateDoc('Project', name, data);
  }

  /**
   * 更新Task
   */
  static async updateTask(name, data) {
    return ApiService.updateDoc('Task', name, data);
  }

  /**
   * 删除Project
   */
  static async deleteProject(name) {
    const n = String(name || '').trim();
    if (!n) throw new Error('Missing project');
    const r = await frappe.call({
      method: 'smart_accounting.api.project_board.delete_project_cascade',
      type: 'POST',
      args: {
        project: n,
        dry_run: 0,
        delete_tasks_first: 1,
        delete_auto_repeat: 1,
        cascade_subtasks: 1,
      }
    });
    const msg = r?.message || {};
    if (msg?.ok) return msg;
    const reason = msg?.reason ? String(msg.reason) : 'project_delete_failed';
    const error = msg?.error ? String(msg.error) : '';
    const detail = error || reason;
    throw new Error(detail || 'Delete project failed');
  }

  /**
   * Bulk update a single field across many Projects (single request).
   */
  static async bulkSetProjectField(projects, field, value) {
    const names = Array.isArray(projects) ? projects : [];
    if (!names.length) return { updated: [] };
    const r = await frappe.call({
      method: 'smart_accounting.api.project_board.bulk_set_project_field',
      args: { projects: names, field, value },
    });
    return r?.message || { updated: [] };
  }

  /**
   * Roll over / duplicate selected projects (single request).
   * @param {object} opts
   * @param {string[]} opts.sourceNames
   * @param {string} opts.targetProjectType
   * @param {string[]} opts.carryFields
   * @param {object} opts.overrides
   * @param {string} opts.nameSuffix
   * @param {string} opts.resetStatus
   */
  static async rollOverProjects({
    sourceNames = [],
    targetProjectType = '',
    carryFields = [],
    clearFields = [],
    overrides = {},
    nameSuffix = '',
    resetStatus = 'Not started',
    advanceFiscalYear = false,
    advanceYearFields = [],
    archiveSource = false,
  } = {}) {
    const names = Array.isArray(sourceNames) ? sourceNames : [];
    if (!names.length) throw new Error('No projects selected');
    const r = await frappe.call({
      method: 'smart_accounting.api.project_rollover.roll_over_projects',
      type: 'POST',
      args: {
        source_names: names,
        target_project_type: targetProjectType || null,
        carry_fields: carryFields,
        clear_fields: Array.isArray(clearFields) ? clearFields : [],
        overrides: overrides || {},
        name_suffix: nameSuffix || null,
        reset_status: resetStatus || 'Not started',
        advance_fiscal_year: advanceFiscalYear ? 1 : 0,
        advance_year_fields: Array.isArray(advanceYearFields) ? advanceYearFields : [],
        archive_source: archiveSource ? 1 : 0,
      },
    });
    return r?.message || { created: [], errors: [], count: 0 };
  }

  /**
   * Per-field meta for the Project DocType (fieldtype/options/read_only),
   * used to build the Roll Over "Set new value" editors. Cached per session.
   */
  static _rollOverFieldMeta = undefined;
  static async getRollOverFieldMeta() {
    if (this._rollOverFieldMeta !== undefined) return this._rollOverFieldMeta;
    try {
      const r = await frappe.call({
        method: 'smart_accounting.api.project_rollover.get_rollover_field_meta',
      });
      this._rollOverFieldMeta = (r && r.message) ? r.message : {};
    } catch (e) {
      this._rollOverFieldMeta = {};
    }
    return this._rollOverFieldMeta;
  }

  static async createTask(project, data = {}) {
    const p = String(project || '').trim();
    if (!p) throw new Error('Missing project');
    const subject = data?.subject != null ? String(data.subject) : null;
    const r = await frappe.call({
      method: 'smart_accounting.api.project_board.create_task_for_project',
      args: { project: p, subject },
    });
    return r?.message?.task || r?.message;
  }

  static async setTaskTeamMembers(task, members = [], role = 'Assigned Person') {
    const t = String(task || '').trim();
    if (!t) throw new Error('Missing task');
    const list = Array.isArray(members) ? members : [];
    const r = await frappe.call({
      method: 'smart_accounting.api.project_board.set_task_team_members',
      args: { task: t, members: list, role },
    });
    return r?.message || {};
  }
}


