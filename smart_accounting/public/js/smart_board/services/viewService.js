/**
 * Smart Board - View Service
 * Saved View相关API调用
 */

import { ApiService } from './api.js';

export class ViewService {
    static _defaultViewCache = new Map(); // projectType -> { ts, view }
    static _cacheTtlMs = 15_000;
    static _pageSize = 200;
    static _maxPages = 50;
    static normalizeFilters(raw) {
        // Normalize Saved View.filters into:
        // { filters: [], or_filters: [], search: '', ui: {} }
        let obj = raw;
        if (obj == null || obj === '') {
            return { filters: [], or_filters: [], search: '', ui: {} };
        }
        if (typeof obj === 'string') {
            try { obj = JSON.parse(obj); } catch (e) { obj = null; }
        }
        if (Array.isArray(obj)) {
            return { filters: obj, or_filters: [], search: '', ui: {} };
        }
        if (obj && typeof obj === 'object') {
            if ('filters' in obj || 'or_filters' in obj || 'search' in obj || 'ui' in obj) {
                return {
                    filters: Array.isArray(obj.filters) ? obj.filters : [],
                    or_filters: Array.isArray(obj.or_filters) ? obj.or_filters : [],
                    search: typeof obj.search === 'string' ? obj.search : '',
                    ui: (obj.ui && typeof obj.ui === 'object') ? obj.ui : {},
                };
            }
            return { filters: [], or_filters: [], search: '', ui: obj };
        }
        return { filters: [], or_filters: [], search: '', ui: {} };
    }

    static inferPinnedProjectType(view) {
        // 1) New schema: filters.ui.pinned_project_type
        const payload = this.normalizeFilters(view?.filters);
        const pinned = payload?.ui?.pinned_project_type;
        if (pinned) return String(pinned);
        // 2) Fallback: find project_type filter
        for (const t of (payload.filters || [])) {
            try {
                if (t?.[0] === 'project_type' && t?.[1] === '=' && t?.[2]) return String(t[2]);
            } catch (e) {}
        }
        // 3) Legacy (now Data/hidden)
        if (view?.project_type) return String(view.project_type);
        return '';
    }
    static _jsonify(value) {
        if (value === undefined) return value;
        if (value === null) return value;
        // Frappe JSON field expects a string in DB; passing list/dict will raise validation errors.
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value);
        } catch (e) {
            return value;
        }
    }

    static async _getListPaged({ filters = [], orderBy = 'modified desc', limitPageLength = null } = {}) {
        const pageSize = Math.max(1, Number(limitPageLength) || this._pageSize);
        const all = [];

        for (let page = 0; page < this._maxPages; page += 1) {
            const response = await frappe.call({
                method: 'frappe.client.get_list',
                args: {
                    doctype: 'Saved View',
                    fields: ['name', 'title', 'project_type', 'columns', 'filters', 'sort_by', 'sort_order', 'is_default', 'owner', 'modified', 'reference_doctype', 'is_active', 'scope', 'sidebar_order'],
                    filters,
                    order_by: orderBy,
                    limit_start: page * pageSize,
                    limit_page_length: pageSize,
                }
            });
            const rows = Array.isArray(response?.message) ? response.message : [];
            all.push(...rows);
            if (rows.length < pageSize) break;
        }

        return all;
    }
    /**
     * 获取所有Saved Views
     */
    static async fetchViews(projectType = null) {
        try {
            // v2: projectType is derived from filters; do not hard-filter by Saved View.project_type (deprecated)
            const rows = await this._getListPaged({
                filters: [],
                orderBy: 'is_default desc, title asc',
                limitPageLength: this._pageSize,
            });
            if (!projectType) return rows;
            const pt = String(projectType);
            return rows.filter((v) => this.inferPinnedProjectType(v) === pt);
        } catch (error) {
            console.error('Failed to fetch views:', error);
            return [];
        }
    }
    
    /**
     * 获取某个 project_type 的默认 View（团队共享），找不到返回 null
     */
    static async getDefaultView(projectType) {
        try {
            const pt = String(projectType || '').trim();
            if (pt) {
                const cached = this._defaultViewCache.get(pt);
                if (cached && (Date.now() - (cached.ts || 0) < this._cacheTtlMs)) {
                    return cached.view || null;
                }
            }
            const rows = await this._getListPaged({
                // Server-side narrow-down (still need client-side match for pinned project type)
                filters: [
                    ['reference_doctype', '=', 'Project'],
                    ['scope', '=', 'Shared'],
                    ['is_active', '=', 1],
                    ['is_default', '=', 1],
                ],
                orderBy: 'modified desc',
                limitPageLength: this._pageSize,
            });
            const matched = rows
                .filter((v) => this.inferPinnedProjectType(v) === pt)
                .filter((v) => Number(v?.is_default || 0) === 1);
            const out = matched[0] || null;
            if (pt) this._defaultViewCache.set(pt, { ts: Date.now(), view: out });
            return out;
        } catch (error) {
            console.error('Failed to get default view:', error);
            return null;
        }
    }

    /**
     * 获取或创建某个 project_type 的默认 View
     * - 目标：团队共享默认列（不做个人视图隔离）
     */
    static async getOrCreateDefaultView(projectType, { fallbackTitle, fallbackColumns, fallbackTaskColumns } = {}) {
        const existing = await this.getDefaultView(projectType);
        if (existing) return existing;

        // Create a minimal default view
        const title = fallbackTitle || `${projectType} Board`;
        const columns = Array.isArray(fallbackColumns) ? fallbackColumns : [];
        const taskColumns = Array.isArray(fallbackTaskColumns) ? fallbackTaskColumns : [];
        const columnsPayload = taskColumns.length ? { project: columns, tasks: taskColumns } : columns;

        try {
            const response = await frappe.call({
                method: 'frappe.client.insert',
                args: {
                    doc: {
                        doctype: 'Saved View',
                        title,
                        // v2 schema
                        reference_doctype: 'Project',
                        is_active: 1,
                        scope: 'Shared',
                        sidebar_order: 0,
                        project_type: projectType, // legacy (Data/hidden) for compatibility only
                        columns: this._jsonify(columnsPayload),
                        filters: this._jsonify({
                            filters: [['project_type', '=', projectType]],
                            or_filters: [],
                            search: '',
                            ui: { pinned_project_type: projectType }
                        }),
                        sort_by: 'modified',
                        sort_order: 'desc',
                        is_default: 1
                    }
                }
            });
            return response.message || null;
        } catch (error) {
            console.error('Failed to create default view:', error);
            frappe.show_alert?.({ message: __('Failed to create default view'), indicator: 'red' });
            return null;
        }
    }
    
    /**
     * 保存View
     */
    static async saveView(data) {
        try {
            const response = await frappe.call({
                method: 'frappe.client.insert',
                args: {
                    doc: {
                        doctype: 'Saved View',
                        ...(data?.columns !== undefined ? { columns: this._jsonify(data.columns) } : {}),
                        ...(data?.filters !== undefined ? { filters: this._jsonify(data.filters) } : {}),
                        ...data
                    }
                }
            });
            
            frappe.show_alert({
                message: __('View saved successfully'),
                indicator: 'green'
            });
            
            return response.message;
        } catch (error) {
            console.error('Failed to save view:', error);
            frappe.show_alert({
                message: __('Failed to save view'),
                indicator: 'red'
            });
            return null;
        }
    }
    
    /**
     * 更新View
     */
    static async updateView(name, data) {
        const payload = { ...data };
        if (payload.columns !== undefined) payload.columns = this._jsonify(payload.columns);
        if (payload.filters !== undefined) payload.filters = this._jsonify(payload.filters);
        // Invalidate cache best-effort (unknown which projectType it belongs to, so clear all)
        try { this._defaultViewCache?.clear?.(); } catch (e) {}
        return ApiService.updateDoc('Saved View', name, payload);
    }
    
    /**
     * 删除View
     */
    static async deleteView(name) {
        return ApiService.deleteDoc('Saved View', name);
    }
}

