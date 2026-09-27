export class AutomationHealthService {
  static async getHealth({ lookbackHours = 24, recentLimit = 10 } = {}) {
    const r = await frappe.call({
      method: 'smart_accounting.api.automation_health.get_automation_health',
      args: {
        lookback_hours: Math.max(1, Number(lookbackHours) || 24),
        recent_limit: Math.max(1, Number(recentLimit) || 10),
      },
    });
    return r?.message || {};
  }
}
