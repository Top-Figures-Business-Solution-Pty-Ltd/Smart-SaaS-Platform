export class ProjectActivityService {
  static async getProjectActivity(projectName, { limitStart = 0, limit = 100 } = {}) {
    const r = await frappe.call({
      method: 'smart_accounting.api.activity_log.get_project_activity',
      args: {
        project: String(projectName || '').trim(),
        limit_start: Math.max(0, Number(limitStart) || 0),
        limit_page_length: Math.max(1, Number(limit) || 100),
      },
    });
    return r?.message || { items: [], meta: {} };
  }

  static async undoProjectActivity(projectName, activityName, expectedToValue) {
    const project = String(projectName || '').trim();
    const activity = String(activityName || '').trim();
    if (!project) throw new Error('Missing project');
    if (!activity) throw new Error('Missing activity name');
    const r = await frappe.call({
      method: 'smart_accounting.api.activity_log.undo_project_activity',
      args: {
        project,
        activity_name: activity,
        expected_to_value: expectedToValue == null ? '' : String(expectedToValue || ''),
      },
    });
    return r?.message || { ok: false };
  }

  static async undoProjectActivityBatch(batchId) {
    const batch = String(batchId || '').trim();
    if (!batch) throw new Error('Missing batch id');
    const r = await frappe.call({
      method: 'smart_accounting.api.activity_log.undo_project_activity_batch',
      args: { batch_id: batch },
    });
    return r?.message || { ok: false };
  }

  static async undoProjectActivityBatch(batchId) {
    const batch = String(batchId || '').trim();
    if (!batch) throw new Error('Missing batch id');
    const r = await frappe.call({
      method: 'smart_accounting.api.activity_log.undo_project_activity_batch',
      args: { batch_id: batch },
    });
    return r?.message || { ok: false };
  }
}

