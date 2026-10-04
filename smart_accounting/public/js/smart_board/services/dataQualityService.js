export class DataQualityService {
  static async getReport() {
    const r = await frappe.call({
      method: 'smart_accounting.api.data_quality.get_data_quality_report',
      args: {},
    });
    return r?.message || { checks: [], summary: {} };
  }
}
