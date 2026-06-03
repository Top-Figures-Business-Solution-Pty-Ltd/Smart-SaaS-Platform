/**
 * ProjectQueryService
 * - Read/query paths for Projects/Tasks used by Smart Board.
 * - Keeps caching + dedupe local (does not depend on UI/components).
 */

import { ApiService } from './api.js';
import { Perf } from '../utils/perf.js';
import { DoctypeMetaService } from './doctypeMetaService.js';
import { isSortableProjectField } from '../utils/constants.js';

export class ProjectQueryService {
  static _warnedMissingFields = false;
  static _extraFields = null;
  static _inflightList = new Map(); // key -> Promise(result)

  static _stableKey(obj) {
    // Create a stable-ish string key (sort object keys, normalize arrays)
    const normalize = (v) => {
      if (Array.isArray(v)) return v.map(normalize);
      if (v && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
        return out;
      }
      return v;
    };
    try {
      return JSON.stringify(normalize(obj));
    } catch (e) {
      return String(Date.now());
    }
  }

  static _resolveBoardOrderBy(firstColumnField) {
    const f = String(firstColumnField || '').trim().toLowerCase();
    if (f === 'project_name') return 'project_name asc, name asc';
    if (f === 'customer' || f === 'customer_name' || f === 'client_name' || f === 'client') {
      return 'customer asc, name asc';
    }
    // Default: project name (when first visible column is not client/project name).
    return 'project_name asc, name asc';
  }

  static _resolveExplicitOrderBy(sortField, sortOrder) {
    const fieldRaw = String(sortField || '').trim();
    const order = String(sortOrder || 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
    if (!fieldRaw) return '';
    if (fieldRaw === 'creation') return `creation ${order}, name ${order}`;
    const field = fieldRaw.toLowerCase();
    if (field === 'customer' || field === 'customer_name' || field === 'client' || field === 'client_name') {
      return `customer ${order}, name ${order}`;
    }
    if (field === 'project_name') return `project_name ${order}, name ${order}`;
    if (!/^[a-zA-Z0-9_]+$/.test(fieldRaw)) return '';
    if (!isSortableProjectField(fieldRaw)) return '';
    return `${fieldRaw} ${order}, name asc`;
  }

  /**
   * 获取Projects列表
   */
  static async fetchProjects(filters = {}) {
    const fullFields = [
      'name',
      'project_name',
      'customer',
      'company',
      'project_type',
      'status',
      'priority',
      'expected_start_date',
      'expected_end_date',
      'estimated_costing',
      'notes',
      'is_active',
      'modified',
      'custom_archive_source',
      'custom_archive_source_ref',

      'custom_entity_type',
      'custom_team_members',
      'custom_fiscal_year',
      'custom_year_end',
      'custom_grants_fy_label',
      'custom_grants_abn_snapshot',
      'custom_grants_state',
      'custom_grants_industry_category',
      'custom_grants_partner_label',
      'custom_grants_referral_text',
      'custom_grants_owner_name',
      'custom_grants_address_snapshot',
      'custom_grants_contact_name',
      'custom_grants_primary_communication',
      'custom_grants_status',
      'custom_ap_submit_date',
      'custom_industry_approval_date',
      'custom_tax_lodgement_date',
      'custom_rebate_amount_text',
      'custom_fee_percentage_text',
      'custom_target_month',
      'custom_lodgement_due_date',
      'custom_reset_date',
      'custom_project_frequency',
      'custom_softwares',
      'custom_ato_status',
      'custom_lodgeit_status',
      'custom_company_agent_status',
      'custom_xeroquickbooks_status',
      'custom_board_row_highlight',
    ];

    const minimalFields = [
      'name',
      'project_name',
      'customer',
      'company',
      'project_type',
      'status',
      'expected_start_date',
      'expected_end_date',
      'notes',
      'is_active',
      'custom_grants_status',
    ];

    // PERF:
    // If caller provides an explicit fields list (derived from visible columns),
    // we should respect it and avoid inflating payloads.
    const explicitFields = Array.isArray(filters?.fields) ? filters.fields.filter(Boolean) : [];
    const hasExplicit = explicitFields.length > 0;

    // Include optional extra fields (website-safe, best-effort) only for the legacy "full fields" path.
    if (!hasExplicit) {
      const extra = await this._getExtraFields();
      if (Array.isArray(extra) && extra.length) {
        for (const f of extra) {
          if (f && !fullFields.includes(f)) fullFields.push(f);
        }
      }
    }

    const fetchWithFields = async (fields) => {
      const limitStart = Number.isFinite(Number(filters?.limit_start)) ? Number(filters.limit_start) : 0;
      const limit = Number.isFinite(Number(filters?.limit)) ? Number(filters.limit) : 100;
      // For pre-resolving name lists (advanced groups / multi-field search), use a higher cap than page size.
      const resolveLimit = Math.max(2000, Math.min(10000, limit * 50));

      // Advanced groups (supports nested AND/OR across groups).
      const hasGroups = Array.isArray(filters?.advanced_groups) && filters.advanced_groups.length > 0;
      let nameIn = null; // final restriction list (AND)
      if (hasGroups) {
        try {
          const r = await frappe.call({
            method: 'smart_accounting.api.project_board.query_project_names_advanced',
            args: {
              project_type: filters.project_type || null,
              project_types: Array.isArray(filters?.project_type_in) ? filters.project_type_in : null,
              excluded_project_types: Array.isArray(filters?.excluded_project_types) ? filters.excluded_project_types : null,
              groups: filters.advanced_groups,
              limit: resolveLimit,
              // Smart Board default: active-only (Archive => is_active="No" should disappear).
              is_active_only: filters.is_active === true ? 1 : 0,
              // Search is resolved separately (multi-field) and intersected as name_in.
              search: null,
            },
          });
          const msg = r?.message || {};
          const noRestriction = !!msg?.no_restriction;
          const names = msg?.names ?? msg;

          if (noRestriction) {
            nameIn = null;
          } else if (Array.isArray(names) && names.length) {
            nameIn = names;
          } else {
            return { items: [], meta: { total_count: 0 } };
          }
        } catch (e) {
          // fall back to old path
        }
      }

      // Advanced rules OR filters (legacy advanced_rules join=or)
      const advOrFilters = this.buildOrFilters(filters);

      // Search: multi-field, derived from current visible columns when possible.
      const rawSearch = String(filters?.search || '').trim();
      const hasSearch = !!rawSearch;
      let fallbackSearchProjectName = '';
      const searchCandidates = Array.isArray(filters?.search_fields)
        ? filters.search_fields
        : (Array.isArray(filters?.fields) ? filters.fields : fields);
      const searchFields = Array.isArray(searchCandidates)
        ? searchCandidates.map(String).map((s) => s.trim()).filter(Boolean)
        : [];

      const cleanSearchFields = await (async () => {
        const seen = new Set();
        const out = [];

        // Only search in text-like fields (Date/Datetime filters with "%q%" can throw "Invalid Date").
        const allowedTypes = new Set(['Data', 'Text', 'Text Editor', 'Small Text', 'Long Text', 'Link', 'Select', 'Read Only']);
        let meta = null;
        try {
          meta = await DoctypeMetaService.getMeta('Project');
        } catch (e) {
          meta = null;
        }
        const fieldsMeta = Array.isArray(meta?.fields) ? meta.fields : [];
        const typeByField = new Map(fieldsMeta.map((f) => [String(f?.fieldname || ''), String(f?.fieldtype || '')]));

        const add = (f) => {
          const s = String(f || '').trim();
          if (!s || seen.has(s)) return;
          // Skip virtual/derived and child table fields
          if (s.startsWith('__')) return;
          if (s.includes(':')) return;
          if (s === 'custom_team_members' || s === 'custom_softwares') return;

          // name is special (not always a DocField in meta.fields)
          if (s !== 'name') {
            const t = typeByField.get(s) || '';
            if (allowedTypes.size && t && !allowedTypes.has(t)) return;
            if (!t && s !== 'project_name' && s !== 'customer') return; // unknown field: skip
          }

          out.push(s);
          seen.add(s);
        };

        // Always include core identifiers
        add('name');
        add('project_name');
        add('customer');
        for (const f of searchFields) add(f);

        // Fail-safe minimal set
        if (!out.length) return ['name', 'project_name', 'customer'];
        return out;
      })();

      const searchOrFilters = hasSearch
        ? cleanSearchFields.map((f) => [f, 'like', `%${rawSearch}%`])
        : [];

      const hasAdvOr = Array.isArray(advOrFilters) && advOrFilters.length > 0;
      const hasSearchOr = Array.isArray(searchOrFilters) && searchOrFilters.length > 0;
      const hasSpecialSearchField = searchFields.some((f) => ['custom_softwares', 'software', 'customer_name'].includes(String(f || '').trim()));
      let searchResolvedToNameIn = false;

      // Frappe get_list supports only ONE `or_filters` group. If both advanced OR rules and search OR exist,
      // we pre-resolve search matches to a name_in list and keep advanced OR rules as-is.
      // Also pre-resolve when search includes special fields (e.g. custom_softwares) that cannot be
      // represented by direct Project `or_filters`.
      if (hasSearch && ((hasAdvOr && hasSearchOr) || hasSpecialSearchField)) {
        try {
          const backendSearchFields = Array.from(new Set([...(searchFields || []), ...(cleanSearchFields || [])]));
          const r = await frappe.call({
            method: 'smart_accounting.api.project_board.search_project_names',
            args: {
              search: rawSearch,
              fields: backendSearchFields,
              project_type: filters.project_type || null,
              project_types: Array.isArray(filters?.project_type_in) ? filters.project_type_in : null,
              excluded_project_types: Array.isArray(filters?.excluded_project_types) ? filters.excluded_project_types : null,
              is_active_only: filters.is_active === true ? 1 : 0,
              limit: resolveLimit,
            }
          });
          const msg = r?.message || {};
          const names = Array.isArray(msg?.names) ? msg.names : (Array.isArray(msg) ? msg : []);

          if (Array.isArray(names) && names.length) {
            if (Array.isArray(nameIn) && nameIn.length) {
              // Intersect with advanced group restriction
              const set = new Set(nameIn.map(String));
              const inter = names.map(String).filter((x) => set.has(String(x)));
              nameIn = inter.length ? inter : [];
            } else {
              nameIn = names;
            }
            searchResolvedToNameIn = true;
          } else {
            // Search yields no matches => empty result
            return { items: [], meta: { total_count: 0 } };
          }
        } catch (e) {
          // Fail-safe: if search resolution fails, fall back to legacy behavior (project_name only)
          // by narrowing search to project_name in the main query.
          fallbackSearchProjectName = rawSearch;
        }
      }

      // Effective or_filters:
      // - If advanced OR exists, keep it (search may have been converted to name_in above)
      // - Else if search OR exists, use it
      // - Else none
      const effectiveOrFilters = hasAdvOr ? advOrFilters : (searchResolvedToNameIn ? [] : (hasSearchOr ? searchOrFilters : []));
      const resolvedOrderBy =
        String(filters?.order_by || '').trim() ||
        this._resolveExplicitOrderBy(filters?.sort_field, filters?.sort_order) ||
        this._resolveBoardOrderBy(filters?.first_column);

      const args = {
        doctype: 'Project',
        fields,
        filters: this.buildFilters({ ...filters, ...(fallbackSearchProjectName ? { __sb_search_fallback_project_name: fallbackSearchProjectName } : {}), ...(nameIn ? { name_in: nameIn } : {}) }),
        ...(effectiveOrFilters && effectiveOrFilters.length ? { or_filters: effectiveOrFilters } : {}),
        order_by: resolvedOrderBy,
        limit_start: Math.max(0, limitStart),
        limit_page_length: Math.max(1, limit),
      };

      // Total count for UI ("Loaded X / total") and correctness checks.
      // Only needed on the first page; load-more can reuse the stored total.
      const shouldCount = Number(args?.limit_start || 0) === 0;
      const countArgs = shouldCount
        ? {
            ...args,
            fields: ['count(name) as cnt'],
            limit_start: 0,
            limit_page_length: 1,
          }
        : null;

      // In-flight de-dupe: same query fired repeatedly (e.g. rapid view/filter changes)
      // should share a single request to reduce server load and client work.
      const key = this._stableKey({
        doctype: 'Project',
        // field order doesn't matter for response shape in our usage; sort for stable key
        fields: Array.isArray(fields) ? fields.map(String).sort() : fields,
        filters: args.filters,
        or_filters: args.or_filters || [],
        order_by: args.order_by,
        limit_start: args.limit_start,
        limit_page_length: args.limit_page_length,
      });

      if (this._inflightList.has(key)) return await this._inflightList.get(key);

      const p = (async () => {
        return await Perf.timeAsync(
          'projects.get_list',
          async () => {
            const listPromise = frappe.call({
              // Smart Board Project list API (adds customer_name for UI display).
              // Keeps filters/or_filters semantics identical to frappe.client.get_list.
              method: 'smart_accounting.api.project_board.get_projects_list',
              type: 'POST',
              args: {
                fields: args?.fields,
                filters: args?.filters,
                or_filters: args?.or_filters || [],
                order_by: args?.order_by,
                limit_start: args?.limit_start,
                limit_page_length: args?.limit_page_length,
              },
            });
            const countPromise = countArgs
              ? frappe
                  .call({
                    method: 'frappe.client.get_list',
                    type: 'POST',
                    args: countArgs,
                  })
                  .catch(() => null)
              : Promise.resolve(null);

            const response = await listPromise;
            const rows = response?.message?.items || response?.message || [];

            let total_count = null;
            try {
              const cr = await countPromise;
              const cnt = cr?.message?.[0]?.cnt;
              const n = cnt == null ? null : Number(cnt);
              total_count = n == null || !Number.isFinite(n) ? null : n;
            } catch (e) {
              total_count = null;
            }

            // Hydrate child tables (get_list doesn't include Table/child rows).
            // Only do it if the current visible columns actually need them.
            const needsTeam = Array.isArray(fields) && fields.includes('custom_team_members');
            const needsSoft = Array.isArray(fields) && fields.includes('custom_softwares');
            if (needsTeam || needsSoft) {
              try {
                await this._hydrateChildTables(rows);
              } catch (e) {}
            }
            return { items: rows, meta: { total_count } };
          },
          () => ({
            project_type: String(filters?.project_type || ''),
            limit_start: Number(args?.limit_start || 0),
            limit: Number(args?.limit_page_length || 0),
            fields_count: Array.isArray(fields) ? fields.length : null,
          })
        );
      })();

      this._inflightList.set(key, p);
      try {
        return await p;
      } finally {
        // Only delete if it still points to the same promise (avoid races)
        if (this._inflightList.get(key) === p) this._inflightList.delete(key);
      }
    };

    try {
      // If caller gave explicit fields (usually derived from visible columns), use them.
      if (hasExplicit) return await fetchWithFields(explicitFields);
      return await fetchWithFields(fullFields);
    } catch (error) {
      console.error('Failed to fetch projects (full fields):', error);

      // If custom fields are missing on site meta, fallback so UI still works.
      try {
        if (!this._warnedMissingFields) {
          this._warnedMissingFields = true;
          frappe.show_alert?.({
            message: __('Some Project custom fields are missing on this site. Falling back to a minimal field set.'),
            indicator: 'orange',
          });
        }
        return await fetchWithFields(minimalFields);
      } catch (error2) {
        console.error('Failed to fetch projects (minimal fields):', error2);
        frappe.show_alert?.({
          message: __('Failed to load projects'),
          indicator: 'red',
        });
        return { items: [], meta: { total_count: null } };
      }
    }
  }

  static async _hydrateChildTables(projects) {
    const list = Array.isArray(projects) ? projects : [];
    const names = list.map((p) => p?.name).filter(Boolean);
    if (!names.length) return;

    // Use website-safe backend API to avoid PermissionError on child tables
    try {
      const r = await frappe.call({
        method: 'smart_accounting.api.project_board.hydrate_project_children',
        args: { projects: names },
      });
      const msg = r?.message || {};
      const team = msg?.team || {};
      const softwares = msg?.softwares || {};
      for (const p of list) {
        if (!p?.name) continue;
        p.custom_team_members = team[p.name] || [];
        p.custom_softwares = softwares[p.name] || [];
      }
    } catch (e) {
      // Fail-safe: keep UI functional even if child hydration is unavailable
    }
  }

  static async _getExtraFields() {
    // Cache per page load
    if (Array.isArray(this._extraFields)) return this._extraFields;
    this._extraFields = [];

    // Engagement Letter attach field (if present on site meta)
    try {
      const r = await frappe.call({
        method: 'frappe.desk.form.load.getdoctype',
        type: 'GET',
        args: { doctype: 'Project' },
      });
      const docs = r?.docs || [];
      const meta = docs.find((d) => d?.name === 'Project') || docs[0];
      const fields = meta?.fields || [];
      const f = fields.find(
        (x) =>
          (x?.fieldtype === 'Attach' || x?.fieldtype === 'Attach Image') &&
          String(x?.label || '').trim() === 'Engagement Letter'
      );
      if (f?.fieldname) this._extraFields.push(String(f.fieldname));
    } catch (e) {}

    return this._extraFields;
  }

  /**
   * 获取单个Project详情
   */
  static async getProject(name) {
    return ApiService.getDoc('Project', name);
  }

  static async getTaskCounts(projects) {
    const names = Array.isArray(projects) ? projects : [];
    if (!names.length) return {};
    try {
      const r = await frappe.call({
        method: 'smart_accounting.api.project_board.get_task_counts',
        args: { projects: names },
      });
      return r?.message?.counts || {};
    } catch (e) {
      return {};
    }
  }

  static async getTasksForProjects(projects, fields = [], limitPerProject = 200) {
    const names = Array.isArray(projects) ? projects : [];
    if (!names.length) return {};
    try {
      const r = await frappe.call({
        method: 'smart_accounting.api.project_board.get_tasks_for_projects',
        args: { projects: names, fields, limit_per_project: limitPerProject },
      });
      return r?.message?.tasks || {};
    } catch (e) {
      return {};
    }
  }

  static async getBoardFiscalStartMonth(projects) {
    const names = Array.isArray(projects) ? projects : [];
    if (!names.length) return { start_month: null, counts: {}, by_project: {} };
    try {
      const r = await frappe.call({
        method: 'smart_accounting.api.project_board.get_board_fiscal_start_month',
        args: { projects: names },
      });
      return r?.message || { start_month: null, counts: {}, by_project: {} };
    } catch (e) {
      return { start_month: null, counts: {}, by_project: {} };
    }
  }

  static async getMyProjectsWithRoles({ limitStart = 0, limit = 50 } = {}) {
    const r = await frappe.call({
      method: 'smart_accounting.api.project_board.get_my_projects_with_roles',
      args: {
        limit_start: Math.max(0, Number(limitStart) || 0),
        limit_page_length: Math.max(1, Number(limit) || 50),
      },
    });
    return {
      projects: r?.message?.projects || [],
      meta: r?.message?.meta || {},
    };
  }

  /**
   * Return the FULL list of Project names where the current user is a Project
   * Team Member, the project is active, and Project.status equals `status`.
   *
   * The Status Projects view uses this to build an accurate `name IN (...)`
   * query without depending on the dashboard's paginated `myProjects` cache.
   * Always call this directly (do NOT derive from `dashboard.myProjects`).
   */
  static async getMyProjectNamesByStatus(status) {
    const s = String(status || '').trim();
    if (!s) return { names: [], total: 0 };
    try {
      const r = await frappe.call({
        method: 'smart_accounting.api.project_board.get_my_project_names_by_status',
        args: { status: s },
      });
      const names = Array.isArray(r?.message?.names) ? r.message.names : [];
      const total = Number(r?.message?.total);
      return {
        names,
        total: Number.isFinite(total) ? total : names.length,
      };
    } catch (e) {
      return { names: [], total: 0, error: String(e?.message || e) };
    }
  }

  /**
   * 构建筛选条件
   */
  static buildFilters(filters) {
    const result = [];

    // project_type筛选
    if (filters.project_type) {
      result.push(['project_type', '=', filters.project_type]);
    }
    if (Array.isArray(filters.project_type_in) && filters.project_type_in.length) {
      result.push(['project_type', 'in', filters.project_type_in]);
    }
    if (Array.isArray(filters.excluded_project_types) && filters.excluded_project_types.length) {
      result.push(['project_type', 'not in', filters.excluded_project_types]);
    }

    // status筛选（支持多选）
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        // IMPORTANT: empty array should mean "no status filter"
        if (filters.status.length) result.push(['status', 'in', filters.status]);
      } else if (String(filters.status).trim()) {
        result.push(['status', '=', filters.status]);
      }
    }

    // company筛选
    if (filters.company && String(filters.company).trim()) {
      result.push(['company', '=', filters.company]);
    }

    // customer筛选
    if (filters.customer && String(filters.customer).trim()) {
      result.push(['customer', '=', filters.customer]);
    }

    // Temporary scoped filter: focus on a single project from notifications.
    if (filters.focused_project_name && String(filters.focused_project_name).trim()) {
      result.push(['name', '=', String(filters.focused_project_name).trim()]);
    }

    // fiscal_year筛选
    if (filters.fiscal_year && String(filters.fiscal_year).trim()) {
      result.push(['custom_fiscal_year', '=', filters.fiscal_year]);
    }

    // 日期范围筛选
    if (filters.date_from && String(filters.date_from).trim()) {
      result.push(['custom_lodgement_due_date', '>=', filters.date_from]);
    }
    if (filters.date_to && String(filters.date_to).trim()) {
      result.push(['custom_lodgement_due_date', '<=', filters.date_to]);
    }

    // NOTE (2026-02):
    // Global search is resolved as:
    // - OR across multiple visible columns (via `or_filters`) when possible
    // - OR pre-resolution to `name_in` when advanced OR rules are present
    // So we intentionally do NOT apply `filters.search` here (otherwise it would AND-restrict to project_name only).
    // Fail-safe: allow explicit fallback to legacy project_name-only search.
    const fallbackSearch = String(filters?.__sb_search_fallback_project_name || '').trim();
    if (fallbackSearch) result.push(['project_name', 'like', `%${fallbackSearch}%`]);

    // 只显示活跃的项目（Smart Board 默认只展示 Active）
    if (filters.is_active === true) {
      result.push(['is_active', '=', 'Yes']);
    } else if (filters.is_active === false) {
      result.push(['is_active', '=', 'No']);
    }

    // name IN (from advanced groups resolution)
    if (Array.isArray(filters.name_in) && filters.name_in.length) {
      result.push(['name', 'in', filters.name_in]);
    }

    // Advanced rules (AND rules)
    const rules = Array.isArray(filters?.advanced_rules) ? filters.advanced_rules : [];
    for (const r of rules) {
      const join = (r?.join || '').toLowerCase();
      if (join === 'or') continue; // OR rules handled by buildOrFilters
      const triple = this._ruleToFilterTriple(r);
      if (triple) result.push(triple);
    }

    return result;
  }

  /**
   * Build OR filters from advanced_rules.
   * Semantics in frappe.get_list:
   * - filters are ANDed
   * - or_filters are ORed (then ANDed with filters)
   */
  static buildOrFilters(filters) {
    const out = [];
    const rules = Array.isArray(filters?.advanced_rules) ? filters.advanced_rules : [];
    for (const r of rules) {
      const join = (r?.join || '').toLowerCase();
      if (join !== 'or') continue;
      const triple = this._ruleToFilterTriple(r);
      if (triple) out.push(triple);
    }
    return out;
  }

  static _ruleToFilterTriple(rule) {
    const field = (rule?.field || '').trim();
    const cond = (rule?.condition || '').trim();
    const value = rule?.value;
    if (!field || !cond) return null;

    const needsValue = !['is_empty', 'is_not_empty'].includes(cond);
    const v = value == null ? '' : String(value);
    if (needsValue && !v) return null;

    switch (cond) {
      case 'equals':
        return [field, '=', v];
      case 'not_equals':
        return [field, '!=', v];
      case 'contains':
        return [field, 'like', `%${v}%`];
      case 'not_contains':
        return [field, 'not like', `%${v}%`];
      case 'starts_with':
        return [field, 'like', `${v}%`];
      case 'before':
        return [field, '<', v];
      case 'after':
        return [field, '>', v];
      case 'on_or_before':
        return [field, '<=', v];
      case 'on_or_after':
        return [field, '>=', v];
      case 'is_empty':
        return [field, '=', ''];
      case 'is_not_empty':
        return [field, '!=', ''];
      default:
        return null;
    }
  }

  /**
   * 获取Project统计信息
   */
  static async getStats(projectType) {
    try {
      const result = await this.fetchProjects({ project_type: projectType });
      const projects = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : [];

      const stats = {
        total: projects.length,
        by_status: {},
        by_company: {},
      };

      projects.forEach((project) => {
        // 按状态统计
        if (project.status) {
          stats.by_status[project.status] = (stats.by_status[project.status] || 0) + 1;
        }

        // 按公司统计
        if (project.company) {
          stats.by_company[project.company] = (stats.by_company[project.company] || 0) + 1;
        }
      });

      return stats;
    } catch (error) {
      console.error('Failed to get stats:', error);
      return null;
    }
  }
}


