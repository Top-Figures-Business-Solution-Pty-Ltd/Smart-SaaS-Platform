/**
 * Smart Board - Main Application
 * 主应用组件
 */

import { Sidebar } from './components/Layout/Sidebar.js';
import { Header } from './components/Layout/Header.js';
import { MainContent } from './components/Layout/MainContent.js';
import { Modal } from './components/Common/Modal.js';
import { PROJECT_TYPE_ICONS, DEFAULT_PROJECT_TYPE_ICON, DEFAULT_COLUMNS, isSortableProjectField } from './utils/constants.js';
import { Store } from './store/store.js';
import { ProjectTypeService } from './services/projectTypeService.js';
import * as ViewTypes from './utils/viewTypes.js';
import { handleHeaderAction } from './controllers/headerActionHandler.js';
import { openProject, createProject } from './services/navigationService.js';
import { msgprint, confirmDialog, notify } from './services/uiAdapter.js';
import { ViewService } from './services/viewService.js';
import './columns/registerDefaultSpecs.js';
import { isDesk } from './utils/env.js';
import { getUrlState, setUrlState } from './utils/urlState.js';
import { Perf } from './utils/perf.js';
import { ClientsService } from './services/clientsService.js';
import { ProjectService } from './services/projectService.js';
import { sanitizeProjectColumnsConfig } from './utils/deprecatedColumns.js';
import { exportCurrentClientsCSV, exportCurrentProjectsCSV } from './utils/csvExport.js';
import {
    createSimpleFilterReset,
    createTransientBoardEntryFilterReset,
} from './utils/filterState.js';
import { filterProjectColumnsForModule } from './utils/moduleConfig.js';

export class SmartBoardApp {
    constructor(container) {
        this.container = container;
        this.store = new Store();
        const runtimeConfig = window.smart_accounting || {};
        this.moduleKey = String(runtimeConfig?.module_key || 'accounting').trim().toLowerCase() === 'grants' ? 'grants' : 'accounting';
        this.initialView = String(runtimeConfig?.initial_view || '').trim();
        this.allowedViews = Array.isArray(runtimeConfig?.allowed_views)
            ? runtimeConfig.allowed_views.map((x) => String(x || '').trim()).filter(Boolean)
            : null;
        this.allowedProjectTypes = Array.isArray(runtimeConfig?.allowed_project_types)
            ? runtimeConfig.allowed_project_types.map((x) => String(x || '').trim()).filter(Boolean)
            : null;
        this.excludedProjectTypes = Array.isArray(runtimeConfig?.excluded_project_types)
            ? runtimeConfig.excluded_project_types.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
        this.sidebarOptions = (runtimeConfig?.sidebar_options && typeof runtimeConfig.sidebar_options === 'object')
            ? runtimeConfig.sidebar_options
            : {};
        const urlState = getUrlState();
        // 默认先落在 dashboard，避免系统还没加载 Project Type 时误用不存在的 type（例如 ITR）
        this.currentView = urlState?.view || this.initialView || 'dashboard';
        // Only treat URL customer param as meaningful for client-projects view
        this._initialUrlCustomer = (this.currentView === 'client-projects') ? String(urlState?.customer || '').trim() : '';
        this._initialUrlStatus = (this.currentView === 'status-projects') ? String(urlState?.status || '').trim() : '';
        this._initialUrlProject = String(urlState?.project || '').trim();
        this.projectTypes = [];   // 运行时从系统获取
        this._unsubscribers = [];
        this._onWindowResize = null;
        this._clientProjects = null;
        this._statusProjects = '';
        this._scopedCustomer = '';
        this._scopedProjectName = '';
        this._scopedProjectView = '';
        this._automationLogsFilters = {};
        if (!this._isConfiguredViewAllowed(this.currentView)) {
            this.currentView = this._resolveFallbackView();
        }
        
        this.init();
    }

    _isConfiguredProductViewAllowed(viewType) {
        const view = String(viewType || '').trim();
        if (!view) return false;
        if (this.allowedViews === null) return true;
        return this.allowedViews.includes(view);
    }

    _isConfiguredProjectTypeAllowed(projectType) {
        const value = String(projectType || '').trim();
        if (!value) return false;
        if (this.allowedProjectTypes !== null && !this.allowedProjectTypes.includes(value)) {
            return false;
        }
        return !this.excludedProjectTypes.includes(value);
    }

    _isConfiguredViewAllowed(viewType) {
        const view = String(viewType || '').trim();
        if (!view) return false;
        if (typeof ViewTypes?.isProductView === 'function' && ViewTypes.isProductView(view)) {
            return this._isConfiguredProductViewAllowed(view);
        }
        if (this._isArchivedView(view)) {
            return this._isConfiguredProductViewAllowed(view);
        }
        return this._isConfiguredProjectTypeAllowed(view);
    }

    _resolveFallbackView() {
        if (this.initialView && this._isConfiguredViewAllowed(this.initialView)) {
            return this.initialView;
        }
        if (Array.isArray(this.projectTypes) && this.projectTypes.length) {
            return this.projectTypes[0].value;
        }
        if (this._isConfiguredProductViewAllowed('dashboard')) {
            return 'dashboard';
        }
        if (Array.isArray(this.allowedViews) && this.allowedViews.length) {
            return this.allowedViews[0];
        }
        return 'dashboard';
    }

    _getProjectScopeFilters() {
        const out = {};
        const allowed = Array.isArray(this.allowedProjectTypes)
            ? this.allowedProjectTypes.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
        const excluded = Array.isArray(this.excludedProjectTypes)
            ? this.excludedProjectTypes.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
        if (allowed.length === 1) out.project_type = allowed[0];
        else if (allowed.length > 1) out.project_type_in = allowed;
        if (excluded.length) out.excluded_project_types = excluded;
        return out;
    }
    
    init() {
        // 清空容器
        this.container.innerHTML = '';
        
        // 创建主布局
        this.createLayout();
        
        // 初始化组件
        this.initComponents();
        
        // 绑定事件
        this.bindEvents();
        
        // 加载初始数据
        this.loadInitialData();
    }
    
    createLayout() {
        this.container.innerHTML = `
            <div class="smart-board-app">
                <div class="smart-board-sidebar" id="smartBoardSidebar"></div>
                <div class="smart-board-main">
                    <div class="smart-board-header" id="smartBoardHeader"></div>
                    <div class="smart-board-content" id="smartBoardContent"></div>
                </div>
            </div>
        `;
    }
    
    initComponents() {
        // 初始化侧边栏
        const sidebarContainer = this.container.querySelector('#smartBoardSidebar');
        this.sidebar = new Sidebar(sidebarContainer, {
            projectTypes: this.projectTypes,
            currentView: this.currentView,
            onViewChange: (viewType, opts) => this.handleViewChange(viewType, opts),
            onBoardSettings: () => this.handleHeaderAction('board_settings'),
            onBoardMenuAction: (action, viewType) => this.handleBoardMenuAction(action, viewType),
            allowedViews: this.allowedViews,
            showBoardSettings: this.sidebarOptions.showBoardSettings,
            showArchivedProjects: this.sidebarOptions.showArchivedProjects,
            showCreateProjectType: this.sidebarOptions.showCreateProjectType,
        });
        
        // 初始化头部
        const headerContainer = this.container.querySelector('#smartBoardHeader');
        this.header = new Header(headerContainer, {
            currentView: this.currentView,
            isBoardView: (viewType) => this.isBoardView(viewType),
            moduleKey: this.moduleKey,
            store: this.store,
            onAction: (action, data) => this.handleHeaderAction(action, data)
        });
        
        // 初始化主内容区
        const contentContainer = this.container.querySelector('#smartBoardContent');
        this.mainContent = new MainContent(contentContainer, {
            currentView: this.currentView,
            store: this.store,
            app: this,
            isBoardView: (viewType) => this.isBoardView(viewType),
            onProjectClick: (project) => this.handleProjectClick(project)
        });
    }
    
    bindEvents() {
        // 监听 store 变化：只更新 loading/empty 状态，避免反复 render 导致订阅泄漏
        const unsubStore = this.store.subscribe((state) => {
            const loading = !!state.projects?.loading;
            const items = state.projects?.items || [];

            if (this.mainContent) {
                this.mainContent.showLoading(loading);
                this.mainContent.showEmptyState(!loading && items.length === 0);
            }
        });
        this._unsubscribers.push(unsubStore);
        
        // 监听窗口resize
        this._onWindowResize = () => this.handleWindowResize();
        window.addEventListener('resize', this._onWindowResize);
    }
    
    async loadInitialData() {
        try {
            // 显示加载状态
            this.showLoading(true);

            // 先加载系统 Project Type（让左侧导航实时反映系统配置）
            await this.loadProjectTypes();
            
            // 加载当前视图的数据
            // If URL points to a scoped product view, seed filters before the first fetch.
            this._seedInitialScopedFilters();
            await this._reloadCurrentView({ syncUrl: false });
            await this._openInitialProjectTarget();
            
            this.showLoading(false);
        } catch (error) {
            console.error('Failed to load initial data:', error);
            frappe.show_alert({
                message: __('Failed to load data'),
                indicator: 'red'
            });
            this.showLoading(false);
        }
    }
    
    async loadViewData(viewType) {
        const label = `loadViewData ${String(viewType || '')}`;
        const run = async () => {
        // Dashboard uses its own lightweight API (avoid loading all Projects)
        if (viewType === 'dashboard') {
            await this.store.dispatch('dashboard/fetchMyProjects');
            return;
        }
        // Clients uses its own module/state
        if (viewType === 'clients') {
            await this.store.dispatch('clients/fetchClients', { search: '', limit: 200 });
            return;
        }
        if (viewType === 'archived-clients') {
            await this.store.dispatch('clients/fetchClients', { search: '', limit: 50, disabledOnly: true });
            return;
        }
        // Settings / Activity / Users are product views (no board data needed)
        if (viewType === 'settings' || viewType === 'activity' || viewType === 'report' || viewType === 'automation-logs' || viewType === 'users') {
            return;
        }
        if (viewType === 'status-projects') {
            // Resolve the active status from filter state first (set by openStatusProjects /
            // URL hydration / search refresh), then fall back to the in-memory marker.
            const stateFilters = this.store?.getState?.()?.filters || {};
            const statusList = Array.isArray(stateFilters?.status)
                ? stateFilters.status
                : (stateFilters?.status ? [stateFilters.status] : []);
            const statusValue = String(statusList[0] || this._statusProjects || '').trim();

            // Always derive the eligible name list directly from the server, NOT from
            // dashboard.myProjects (which is a paginated cache and would silently hide
            // matches whose project_name sorts past the dashboard page boundary).
            let names = [];
            if (statusValue) {
                try {
                    const r = await ProjectService.getMyProjectNamesByStatus(statusValue);
                    names = Array.isArray(r?.names) ? r.names : [];
                } catch (e) {
                    names = [];
                }
            }

            const merged = { ...stateFilters };
            merged.fields = ['name', 'project_name', 'customer', 'project_type', 'status', 'modified', 'is_active'];

            if (!names.length) {
                // No matching projects for this user/status — feed an unmatchable
                // sentinel into name_in so the regular projects pipeline returns 0
                // rows (preserves loading/error/empty UI states from the store).
                // We MUST NOT pass an empty name_in here: buildFilters drops empty
                // arrays, which would otherwise leak unrelated projects matching
                // the status filter alone.
                merged.name_in = ['__sb_status_projects_no_match__'];
                await this.store.dispatch('projects/fetchProjects', merged);
                return;
            }

            merged.name_in = names;
            // The status name list is normally small (it equals the dashboard card count).
            // Make sure the page can hold all of them in a single request so the table is
            // complete without requiring "Load more" interactions.
            const wantedLimit = Math.max(100, names.length);
            const currentLimit = Number(merged.limit);
            if (!Number.isFinite(currentLimit) || currentLimit < wantedLimit) {
                merged.limit = wantedLimit;
            }
            await this.store.dispatch('projects/fetchProjects', merged);
            return;
        }
        // Client Projects: a cross-project-type view, still backed by Projects module
        if (viewType === 'client-projects') {
            const stateFilters = this.store?.getState?.()?.filters || {};
            const merged = { ...stateFilters, ...this._getProjectScopeFilters() };
            // Keep payload minimal; this view is read-only.
            merged.fields = ['name', 'project_name', 'customer', 'project_type', 'status', 'modified'];
            await this.store.dispatch('projects/fetchProjects', merged);
            return;
        }
        // 从store加载数据：合并 filters（含 advanced filter rules/groups + search）
        const projectTypeValues = new Set(this.projectTypes.map(t => t.value));

        // v2: board view 默认仍按 project_type 过滤（Saved View.filters 只是“默认配置来源”，不会阻塞删除 Project Type）
        const base = this._isArchivedView(viewType)
            ? { ...this._getProjectScopeFilters(), is_active: false }
            : (projectTypeValues.has(viewType) ? { project_type: viewType, is_active: true } : {});

        const stateFilters = this.store?.getState?.()?.filters || {};
        // base 覆盖 stateFilters 里的 project_type（避免旧视图残留）
        const merged = { ...stateFilters, ...base };

        // PERF (SaaS-ready):
        // Derive Project query fields from the current Saved View (visible columns).
        // This prevents pulling a giant payload for every board, and scales much better.
        if (this.isBoardView(viewType)) {
            try {
                const fallbackCols = (DEFAULT_COLUMNS[viewType] || DEFAULT_COLUMNS['DEFAULT'] || []).map((c) => ({ field: c.field, label: c.label }));
                const view = await ViewService.getOrCreateDefaultView(viewType, {
                    fallbackTitle: `${viewType} Board`,
                    fallbackColumns: fallbackCols
                });

                const parseColumns = (raw) => {
                    if (!raw) return [];
                    let v = raw;
                    if (typeof v === 'string') {
                        try { v = JSON.parse(v); } catch (e) { v = null; }
                    }
                    if (Array.isArray(v)) return v;
                    if (v && typeof v === 'object') {
                        return Array.isArray(v.project) ? v.project : (Array.isArray(v.projectColumns) ? v.projectColumns : []);
                    }
                    return [];
                };

                const cols = filterProjectColumnsForModule(
                    sanitizeProjectColumnsConfig(parseColumns(view?.columns)),
                    this.moduleKey,
                    { viewType }
                );
                const viewFiltersPayload = ViewService.normalizeFilters(view?.filters);
                // Derive the current first visible project column from Saved View config.
                // Sorting rule:
                // - first column = project_name => sort by project_name
                // - first column = customer/client name => sort by customer
                // - otherwise => default sort by project_name
                let firstProjectColumn = 'project_name';
                for (const c of (cols || [])) {
                    const f = String(c?.field || '').trim();
                    if (!f) continue;
                    if (f.startsWith('__sb_')) continue;
                    firstProjectColumn = f;
                    break;
                }
                merged.first_column = firstProjectColumn;
                const rawSortBy = String(viewFiltersPayload?.ui?.sort_field || '').trim();
                const rawSortOrder = String(viewFiltersPayload?.ui?.sort_order || '').trim().toLowerCase();
                const safeSortBy = isSortableProjectField(rawSortBy) ? rawSortBy : '';
                const isAdhoc = /ad[\s-]?hoc/i.test(String(viewType || '').trim());
                if (safeSortBy) {
                    merged.sort_field = safeSortBy;
                    merged.sort_order = rawSortOrder === 'desc' ? 'desc' : 'asc';
                } else if (isAdhoc) {
                    merged.sort_field = 'creation';
                    merged.sort_order = 'desc';
                } else {
                    merged.sort_field = null;
                    merged.sort_order = null;
                }
                if (rawSortBy && !safeSortBy && view?.name) {
                    try {
                        const sanitizedPayload = ViewService.normalizeFilters(view?.filters);
                        sanitizedPayload.ui = { ...(sanitizedPayload.ui || {}) };
                        delete sanitizedPayload.ui.sort_field;
                        delete sanitizedPayload.ui.sort_order;
                        await ViewService.updateView(view.name, { filters: sanitizedPayload });
                        if (view) view.filters = sanitizedPayload;
                    } catch (e) {}
                }
                try {
                    const currentFilters = this.store?.getState?.()?.filters || {};
                    if (String(currentFilters?.sort_field || '') !== String(merged.sort_field || '') ||
                        String(currentFilters?.sort_order || '') !== String(merged.sort_order || '')) {
                        this.store?.dispatch?.('filters/setSort', { field: merged.sort_field, order: merged.sort_order });
                    }
                } catch (e) {}
                // Base fields are always fetched even if not visible in Columns Manager.
                // IMPORTANT: `custom_fiscal_year` is required for Task Monthly Status interactions
                // (cells need a fiscal year to call setMonthlyStatus), so never omit it.
                const baseFields = [
                    'name',
                    'project_name',
                    'customer',
                    'project_type',
                    'status',
                    'company',
                    'is_active',
                    'modified',
                    'custom_fiscal_year',
                ];
                const fields = new Set(baseFields);
                for (const c of (cols || [])) {
                    const f = String(c?.field || '').trim();
                    if (!f) continue;
                    // Skip virtual/computed columns
                    if (f.startsWith('__sb_')) continue;
                    // Derived column: team:<Role> needs custom_team_members
                    if (f.startsWith('team:')) {
                        fields.add('custom_team_members');
                        continue;
                    }
                    // Entity display is derived from the Customer Entity link (override)
                    if (f === 'custom_entity_type') {
                        fields.add('custom_customer_entity');
                        fields.add('custom_entity_type');
                        continue;
                    }
                    fields.add(f);
                }
                merged.fields = Array.from(fields);
            } catch (e) {
                // Fail-safe: if Saved View fetch fails, fall back to legacy behavior.
            }
        }

        await this.store.dispatch('projects/fetchProjects', merged);
        };
        return await Perf.timeAsync(label, run, () => ({
            view: String(viewType || ''),
            isBoard: !!this.isBoardView?.(viewType),
        }));
    }

    isBoardView(viewType) {
        const fn = typeof ViewTypes?.isBoardView === 'function'
            ? ViewTypes.isBoardView
            : ((view, projectTypes = []) => {
                const values = new Set((projectTypes || []).map(t => t?.value).filter(Boolean));
                return values.has(view);
            });
        return fn(viewType, this.projectTypes);
    }

    _isArchivedView(viewType) {
        const fn = typeof ViewTypes?.isArchivedView === 'function'
            ? ViewTypes.isArchivedView
            : ((view) => String(view || '').trim() === 'archived-projects');
        return !!fn(viewType);
    }

    _isLoadableView(viewType) {
        if (!this._isConfiguredViewAllowed(viewType)) return false;
        return this.isBoardView(viewType)
            || viewType === 'dashboard'
            || viewType === 'clients'
            || viewType === 'client-projects'
            || viewType === 'status-projects'
            || viewType === 'archived-clients'
            || viewType === 'users'
            || viewType === 'report'
            || viewType === 'automation-logs';
    }

    _setCurrentView(viewType, {
        updateHeader = true,
        updateMain = true,
        updateSidebar = true,
    } = {}) {
        this.currentView = viewType;
        if (updateHeader) this.header?.updateView?.(viewType);
        if (updateMain) this.mainContent?.updateView?.(viewType);
        if (updateSidebar) this.sidebar?.updateView?.(viewType);
    }

    async _navigateToView(viewType, {
        updateHeader = true,
        updateMain = true,
        updateSidebar = true,
        load = true,
        syncUrl = true,
    } = {}) {
        this._setCurrentView(viewType, { updateHeader, updateMain, updateSidebar });
        if (load && this._isLoadableView(viewType)) {
            await this.loadViewData(viewType);
        }
        if (syncUrl) {
            try { this._syncUrl?.(); } catch (e) {}
        }
    }

    async _reloadCurrentView({ syncUrl = true } = {}) {
        await this.loadViewData(this.currentView);
        if (syncUrl) {
            try { this._syncUrl?.(); } catch (e) {}
        }
    }

    async _setFiltersAndRefresh(filters, {
        clearFocusedProject = true,
        syncUrl = true,
    } = {}) {
        const nextFilters = clearFocusedProject
            ? { ...(filters || {}), focused_project_name: null }
            : { ...(filters || {}) };

        this.store.dispatch('filters/setFilters', nextFilters);

        if (clearFocusedProject) {
            this._scopedProjectName = '';
            this._scopedProjectView = '';
        }

        await this._reloadCurrentView({ syncUrl });
    }

    async _setSearchAndRefresh(searchTerm, { syncUrl = true } = {}) {
        this.store.dispatch('filters/setSearch', searchTerm);
        await this._reloadCurrentView({ syncUrl });
    }

    _seedInitialScopedFilters() {
        if (this.currentView === 'client-projects' && this._initialUrlCustomer) {
            this.store.dispatch('filters/setFilters', createSimpleFilterReset({
                customer: this._initialUrlCustomer,
            }));
            this._clientProjects = { customer: this._initialUrlCustomer, customer_name: this._initialUrlCustomer };
            return;
        }

        if (this.currentView === 'status-projects' && this._initialUrlStatus) {
            this.store.dispatch('filters/setFilters', createTransientBoardEntryFilterReset({}, {
                status: [this._initialUrlStatus],
            }));
            this._statusProjects = this._initialUrlStatus;
        }
    }

    async _openInitialProjectTarget() {
        const projectName = String(this._initialUrlProject || '').trim();
        if (!projectName) return;
        this._initialUrlProject = '';
        try {
            await this.openProjectUpdatesByName(projectName);
        } catch (e) {}
        try { this._syncUrl?.(); } catch (e) {}
    }

    _clearScopedCustomerState() {
        if (!this._scopedCustomer) return;
        try {
            const st = this.store?.getState?.()?.filters || {};
            this.store?.dispatch?.('filters/setFilters', { ...st, customer: null });
        } catch (e) {}
        this._scopedCustomer = '';
        this._clientProjects = null;
    }

    _clearScopedProjectState(nextViewType) {
        if (!this._scopedProjectName || String(nextViewType || '') === String(this._scopedProjectView || '')) {
            return;
        }
        try {
            const st = this.store?.getState?.()?.filters || {};
            this.store?.dispatch?.('filters/setFilters', { ...st, focused_project_name: null });
        } catch (e) {}
        this._scopedProjectName = '';
        this._scopedProjectView = '';
    }

    _clearTransientBoardEntryFilters() {
        try {
            const st = this.store?.getState?.()?.filters || {};
            this.store?.dispatch?.('filters/setFilters', createTransientBoardEntryFilterReset(st));
        } catch (e) {}
    }

    async loadProjectTypes() {
        const names = await ProjectTypeService.fetchProjectTypes();
        this.projectTypes = names
            .filter((name) => this._isConfiguredProjectTypeAllowed(name))
            .map((name) => ({
                value: name,
                label: name,
                icon: PROJECT_TYPE_ICONS[name] || DEFAULT_PROJECT_TYPE_ICON
            }));

        // 如果系统里有 Project Type：仅当 currentView 不是产品页且不是合法 board 时，才切到第一个
        if (
            this.projectTypes.length &&
            !(typeof ViewTypes?.isProductView === 'function' ? ViewTypes.isProductView(this.currentView) : false) &&
            !this._isArchivedView(this.currentView) &&
            !this.projectTypes.find(t => t.value === this.currentView)
        ) {
            this.currentView = this.projectTypes[0].value;
        }
        if (!this._isConfiguredViewAllowed(this.currentView)) {
            this.currentView = this._resolveFallbackView();
        }

        // 刷新 Sidebar + Header 标题
        this.sidebar?.setProjectTypes(this.projectTypes);
        this.sidebar?.updateView(this.currentView);
        this.header?.updateView(this.currentView);
        this.mainContent?.updateView(this.currentView);
    }
    
    handleViewChange(viewType, { reselect = false } = {}) {
        console.log('View changed to:', viewType);
        if (!this._isConfiguredViewAllowed(viewType)) {
            return;
        }
        // Reselect behavior:
        // - Clicking the already-active view should still be useful (Monday-like).
        // - We treat it as "close overlays / return focus to the board" without re-fetching data.
        if (reselect && String(viewType || '') === String(this.currentView || '')) {
            try { Modal.closeAll?.(); } catch (e) {}
            return;
        }
        // Leaving a client-scoped view: clear the transient customer filter so it doesn't "stick" everywhere.
        // This matches user expectation: customer filter added from Clients navigation should not persist when switching boards/pages.
        this._clearScopedCustomerState();
        if (this._statusProjects && String(viewType || '') !== 'status-projects') {
            this._statusProjects = '';
        }
        // Leaving notification-scoped project focus: clear temporary single-project filter
        // when user switches to another view/board to avoid confusion.
        this._clearScopedProjectState(viewType);

        const leavingProductView = typeof ViewTypes?.isProductView === 'function'
            ? ViewTypes.isProductView(this.currentView)
            : false;
        const enteringBoardView = this.isBoardView(viewType);
        if (leavingProductView && enteringBoardView) {
            // Unify navigation behavior:
            // when leaving Dashboard / Client Projects / Status Projects / other product views
            // for a normal board, clear transient filters so users don't carry hidden scope
            // into the next board with a confusing badge-only state.
            this._clearTransientBoardEntryFilters();
        }

        this._navigateToView(viewType, {
            updateSidebar: false,
            load: true,
            syncUrl: true,
        });
    }
    
    handleHeaderAction(action, data) {
        console.log('Header action:', action, data);
        return handleHeaderAction(this, action, data);
    }
    
    handleProjectClick(project) {
        console.log('Project clicked:', project);
        return openProject(project.name);
    }

    /**
     * Website shell helper: open a Project's Updates modal by name.
     * Used by in-app notifications (bell).
     */
    async openProjectUpdatesByName(projectName) {
        const name = String(projectName || '').trim();
        if (!name) return;

        const state = this.store?.getState?.() || {};
        const list = state?.projects?.items || [];
        let project = (list || []).find((p) => p?.name === name) || null;

        // If not in current list (different board / filtered out), fetch minimal doc to determine project_type.
        if (!project) {
            try {
                const r = await frappe.call({
                    method: 'frappe.client.get',
                    args: { doctype: 'Project', name }
                });
                project = r?.message || null;
            } catch (e) {
                return;
            }
        }
        if (!project) return;

        // Product rule: archived project should not deep-navigate from notification.
        if (String(project?.is_active || '').trim() === 'No') {
            notify('This project has been archived. Please restore it first.', 'orange');
            return;
        }

        await this.focusProject(project);

        // Re-resolve from store after load
        const nextState = this.store?.getState?.() || {};
        const nextList = nextState?.projects?.items || [];
        const resolved = (nextList || []).find((p) => p?.name === name) || project;
        try { this.mainContent?.boardTable?.openUpdates?.(resolved); } catch (e) {}
    }
    
    // handleStoreUpdate 已废弃：交给 BoardTable 自己订阅 store 并更新行
    
    handleWindowResize() {
        // 处理窗口大小变化
        if (this.mainContent) {
            this.mainContent.handleResize();
        }
    }
    
    createNewProject() {
        // Desk: keep native ERPNext behavior (open form)
        if (isDesk()) return createProject(this.currentView);
        // Website shell: enable modal flow (minimal required fields).
        return this.mainContent?.createNewProject?.();
    }
    
    applyFilters(filters) {
        return this._setFiltersAndRefresh(filters, {
            clearFocusedProject: true,
            syncUrl: true,
        });
    }
    
    performSearch(searchTerm) {
        return this._setSearchAndRefresh(searchTerm, { syncUrl: true });
    }

    goBackToClients() {
        return this._navigateToView('clients');
    }

    goBackToDashboard() {
        return this._navigateToView('dashboard');
    }
    
    showColumnManager() {
        // Delegate to BoardTable (only meaningful for board views)
        const table = this.mainContent?.boardTable;
        if (table?.openColumnManager) {
            return table.openColumnManager();
        }
        msgprint('Column Manager is not available in this view.');
    }

    setClientsSearch(q) {
        // Delegate to ClientsApp mounted inside MainContent
        return this.mainContent?.setClientsSearch?.(q);
    }

    showClientsColumnManager() {
        return this.mainContent?.openClientsColumnsManager?.();
    }

    showSortDialog() {
        return this.mainContent?.openSortDialog?.();
    }

    async applySort({ field, order } = {}) {
        const requestedField = String(field || '').trim();
        const sortField = requestedField && isSortableProjectField(requestedField) ? requestedField : null;
        const sortOrder = sortField ? (String(order || 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc') : null;
        if (requestedField && !sortField) {
            notify('This column cannot be used for sorting.', 'orange');
        }
        await this.store?.dispatch?.('filters/setSort', { field: sortField, order: sortOrder });
        if (this.isBoardView(this.currentView)) {
            try {
                const table = this.mainContent?.boardTable;
                const view = table?._savedView;
                if (view?.name) {
                    const payload = ViewService.normalizeFilters(view?.filters);
                    payload.ui = { ...(payload.ui || {}) };
                    if (sortField) {
                        payload.ui.sort_field = sortField;
                        payload.ui.sort_order = sortOrder || 'asc';
                    } else {
                        delete payload.ui.sort_field;
                        delete payload.ui.sort_order;
                    }
                    await ViewService.updateView(view.name, {
                        filters: payload,
                    });
                    if (table?._savedView) {
                        table._savedView = { ...table._savedView, filters: payload };
                    }
                }
            } catch (e) {}
        }
        await this._reloadCurrentView({ syncUrl: true });
        return true;
    }

    async handleBoardMenuAction(action, viewType) {
        const act = String(action || '').trim();
        const vt = String(viewType || '').trim();
        if (!act || !vt) return;
        if (act === 'export_csv') {
            if (this.currentView !== vt) {
                await this._navigateToView(vt);
            }
            await this.exportCurrentProjectsCSV();
        }
    }

    async exportCurrentProjectsCSV() {
        return exportCurrentProjectsCSV({
            store: this.store,
            viewType: this.currentView,
        });
    }

    async exportCurrentClientsCSV() {
        return exportCurrentClientsCSV({
            store: this.store,
        });
    }

    openSettingsTab(tabKey) {
        this._settingsTab = String(tabKey || '').trim() || null;
        return this._navigateToView('settings');
    }

    // normalizeClientNames removed (no longer needed)

    openBoardForProject(project) {
        const pt = String(project?.project_type || '').trim();
        if (!pt) return;
        if (!this._isConfiguredProjectTypeAllowed(pt)) {
            notify('This project belongs to another module.', 'orange');
            return;
        }

        // Switch to the board view
        this._setCurrentView(pt);

        // Keep the customer filter so the board is scoped to the same client (transient).
        const customer = String(project?.customer || '').trim();
        const stateFilters = this.store?.getState?.()?.filters || {};
        this.applyFilters({
            ...stateFilters,
            customer: customer || stateFilters.customer || '',
            search: '',
        });
        if (customer) this._scopedCustomer = customer;
    }

    async focusProject(project) {
        const name = String(project?.name || '').trim();
        const pt = String(project?.project_type || '').trim();
        if (!name || !pt) return;
        if (!this._isConfiguredProjectTypeAllowed(pt)) {
            notify('This project belongs to another module.', 'orange');
            return;
        }

        try {
            const st = this.store?.getState?.()?.filters || {};
            this.store?.dispatch?.('filters/setFilters', createTransientBoardEntryFilterReset(st, {
                focused_project_name: name,
            }));
            this._scopedProjectName = name;
            this._scopedProjectView = pt;
        } catch (e) {}

        try {
            await this._navigateToView(pt);
        } catch (e) {}
    }

    openAutomationLogs(filters = {}) {
        this._automationLogsFilters = { ...(filters || {}) };
        return this._navigateToView('automation-logs');
    }

    openStatusProjects(statusValue) {
        const status = String(statusValue || '').trim();
        if (!status) return;
        this._statusProjects = status;
        this._setCurrentView('status-projects');
        this.applyFilters(createTransientBoardEntryFilterReset({}, {
            status: [status],
        }));
    }

    /**
     * Navigate from Clients -> Projects (board) filtered by customer.
     * Strategy (MVP):
     * - Switch to the customer's most recent project_type (if any)
     * - Apply filters.customer and load that board
     */
    async openCustomerProjects(client) {
        const customer = String(client?.name || '').trim();
        if (!customer) return;
        // Navigate to a dedicated cross-project-type view
        this._setCurrentView('client-projects');
        this._clientProjects = { customer, customer_name: client?.customer_name || customer };

        // Apply customer filter within the current module scope.
        this.applyFilters(createSimpleFilterReset({
            customer,
            ...this._getProjectScopeFilters(),
        }));
        this._scopedCustomer = customer;
    }

    _syncUrl() {
        const state = this.store?.getState?.() || {};
        const customer = String(state?.filters?.customer || this._clientProjects?.customer || '').trim();
        const status = (this.currentView === 'status-projects')
            ? String((Array.isArray(state?.filters?.status) ? state.filters.status[0] : state?.filters?.status) || this._statusProjects || '').trim()
            : '';
        const focusedProject = (String(this.currentView || '') === String(this._scopedProjectView || '').trim())
            ? String(state?.filters?.focused_project_name || this._scopedProjectName || '').trim()
            : '';
        // Only keep `customer` in URL for client-projects view to avoid confusing sticky filters on other pages.
        setUrlState({
            view: this.currentView,
            customer: (this.currentView === 'client-projects') ? (customer || '') : '',
            status,
            project: focusedProject,
        });
    }
    
    showLoading(show) {
        if (show) {
            this.container.classList.add('loading');
        } else {
            this.container.classList.remove('loading');
        }
    }
    
    destroy() {
        // 取消订阅 / 解绑全局事件（避免多次进入页面后越来越卡）
        try {
            this._unsubscribers.forEach((fn) => {
                try { fn && fn(); } catch (e) {}
            });
        } finally {
            this._unsubscribers = [];
        }

        if (this._onWindowResize) {
            window.removeEventListener('resize', this._onWindowResize);
            this._onWindowResize = null;
        }

        // 清理资源
        if (this.sidebar) this.sidebar.destroy();
        if (this.header) this.header.destroy();
        if (this.mainContent) this.mainContent.destroy();
    }
}

