/**
 * Smart Board - Main Content Component
 * 主内容区域组件
 */

import { BoardTable } from '../BoardView/BoardTable.js';
import { isPlaceholderView, renderPlaceholderHTML } from './placeholderPages.js';
import { ClientsApp } from '../ClientsView/ClientsApp.js';
import { ClientProjectsApp } from '../ClientsView/ClientProjectsApp.js';
import { ActivityLogApp } from '../ActivityLogView/ActivityLogApp.js';
import { AutomationLogsApp } from '../AutomationLogsView/AutomationLogsApp.js';
import { SettingsApp } from '../SettingsView/SettingsApp.js';
import { ReportApp } from '../ReportView/ReportApp.js';
import { UsersApp } from '../UsersView/UsersApp.js';
import { openNewProjectFlow } from '../../controllers/newProjectController.js';

const PRODUCT_APP_KEYS = [
    '_clientsApp',
    '_archivedClientsApp',
    '_clientProjectsApp',
    '_activityLogApp',
    '_automationLogsApp',
    '_settingsApp',
    '_reportApp',
    '_usersApp',
];

export class MainContent {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.currentView = options.currentView || 'ITR';
        this.store = options.store;
        this.isBoardView = options.isBoardView || (() => false);
        this.onProjectClick = options.onProjectClick || (() => {});
        this._unsub = null;
        this._clientsApp = null;
        this._archivedClientsApp = null;
        this._clientProjectsApp = null;
        this._activityLogApp = null;
        this._automationLogsApp = null;
        this._settingsApp = null;
        this._reportApp = null;
        this._usersApp = null;
        
        this.render();

        // Keep placeholder pages (Dashboard / Clients / Settings) reactive to store updates
        if (this.store?.subscribe) {
            this._unsub = this.store.subscribe(() => {
                if (isPlaceholderView(this.currentView)) {
                    const placeholder = this.container.querySelector('#pagePlaceholder');
                    if (placeholder && placeholder.style.display !== 'none') {
                        placeholder.innerHTML = renderPlaceholderHTML(this.currentView, this.store);
                    }
                }
            });
        }
    }
    
    render() {
        this.container.innerHTML = `
            <div class="main-content-wrapper">
                <!-- Board Table Container -->
                <div class="board-table-container" id="boardTableContainer"></div>

                <!-- Placeholder Pages (Dashboard / Clients / Settings) -->
                <div class="page-placeholder" id="pagePlaceholder" style="display: none;"></div>
                
                <!-- Empty State -->
                <div class="empty-state" id="emptyState" style="display: none;">
                    <div class="empty-state-content">
                        <div class="empty-state-icon">📋</div>
                        <h3>No projects found</h3>
                        <p>Create your first project to get started</p>
                        <button class="btn btn-primary" id="btnCreateFirst">
                            Create Project
                        </button>
                    </div>
                </div>
                
                <!-- Loading State -->
                <div class="loading-state" id="loadingState" style="display: none;">
                    <div class="spinner"></div>
                    <p>Loading projects...</p>
                </div>
            </div>
        `;
        
        // 初始化BoardTable
        this.initBoardTable();
        
        // 绑定事件
        this.bindEvents();
    }
    
    initBoardTable() {
        const container = this.container.querySelector('#boardTableContainer');
        if (!container) return;
        
        this.boardTable = new BoardTable(container, {
            viewType: this.currentView,
            moduleKey: this.options?.app?.moduleKey,
            store: this.store,
            isBoardView: (viewType) => this.isBoardView(viewType),
            onSortChange: (payload) => this.options?.app?.applySort?.(payload),
            onRowClick: (project) => this.onProjectClick(project)
        });
    }
    
    bindEvents() {
        // Empty state按钮
        const btnCreateFirst = this.container.querySelector('#btnCreateFirst');
        if (btnCreateFirst) {
            btnCreateFirst.addEventListener('click', () => {
                this.createNewProject();
            });
        }

        // Dashboard: Open Board action (event delegation)
        this.container.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('.sb-dash-open-board');
            if (!btn) return;
            e.preventDefault();
            const name = btn.getAttribute('data-project-name') || '';
            const state = this.store?.getState?.() || {};
            const list = state?.dashboard?.myProjects || [];
            const project = (list || []).find((p) => String(p?.name) === String(name)) || null;
            if (!project) return;
            try { this.options?.app?.openBoardForProject?.(project); } catch (e2) {}
        });
        this.container.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('.sb-dash-status-card');
            if (!btn) return;
            e.preventDefault();
            const status = btn.getAttribute('data-status') || '';
            try { this.options?.app?.openStatusProjects?.(status); } catch (e2) {}
        });
        this.container.addEventListener('click', async (e) => {
            const btn = e.target?.closest?.('.sb-dash-load-more');
            if (!btn) return;
            e.preventDefault();
            try { await this.store?.dispatch?.('dashboard/fetchMyProjects', { append: true }); } catch (e2) {}
        });
    }
    
    updateView(view) {
        this.currentView = view;

        // Non-board views should not show the projects table
        if (view === 'clients' || view === 'users' || view === 'client-projects' || view === 'status-projects' || view === 'archived-clients' || view === 'activity' || view === 'automation-logs' || view === 'settings' || view === 'report' || isPlaceholderView(view)) {
            this.showPlaceholder(view);
            return;
        }

        this.hidePlaceholder();

        if (this.boardTable) this.boardTable.updateView(view);
    }
    
    showLoading(show) {
        const loadingState = this.container.querySelector('#loadingState');
        const boardTableContainer = this.container.querySelector('#boardTableContainer');
        const emptyState = this.container.querySelector('#emptyState');
        const placeholder = this.container.querySelector('#pagePlaceholder');

        // When placeholder pages are active, ignore loading UI from projects store
        if (placeholder && placeholder.style.display !== 'none') {
            if (loadingState) loadingState.style.display = 'none';
            if (emptyState) emptyState.style.display = 'none';
            if (boardTableContainer) boardTableContainer.style.display = 'none';
            return;
        }
        
        if (show) {
            if (loadingState) loadingState.style.display = 'flex';
            if (boardTableContainer) boardTableContainer.style.display = 'none';
            if (emptyState) emptyState.style.display = 'none';
        } else {
            if (loadingState) loadingState.style.display = 'none';
            if (boardTableContainer) boardTableContainer.style.display = 'block';
        }
    }
    
    showEmptyState(show) {
        const emptyState = this.container.querySelector('#emptyState');
        const boardTableContainer = this.container.querySelector('#boardTableContainer');
        const placeholder = this.container.querySelector('#pagePlaceholder');

        // When placeholder pages are active, ignore empty UI from projects store
        if (placeholder && placeholder.style.display !== 'none') {
            if (emptyState) emptyState.style.display = 'none';
            if (boardTableContainer) boardTableContainer.style.display = 'none';
            return;
        }
        
        if (show) {
            if (emptyState) emptyState.style.display = 'flex';
            if (boardTableContainer) boardTableContainer.style.display = 'none';
        } else {
            if (emptyState) emptyState.style.display = 'none';
            if (boardTableContainer) boardTableContainer.style.display = 'block';
        }
    }
    
    createNewProject() {
        return openNewProjectFlow({ app: this.options?.app, viewType: this.currentView });
    }

    hidePlaceholder() {
        const placeholder = this.container.querySelector('#pagePlaceholder');
        const boardTableContainer = this.container.querySelector('#boardTableContainer');
        if (placeholder) placeholder.style.display = 'none';
        if (boardTableContainer) boardTableContainer.style.display = 'block';
    }

    _destroyAppInstance(key) {
        if (!key) return;
        try { this[key]?.destroy?.(); } catch (e) {}
        this[key] = null;
    }

    _destroyMountedApps(exceptKeys = []) {
        const keep = new Set(Array.isArray(exceptKeys) ? exceptKeys : []);
        PRODUCT_APP_KEYS.forEach((key) => {
            if (keep.has(key)) return;
            this._destroyAppInstance(key);
        });
    }

    _productViewRegistry() {
        return {
            'clients': {
                mountId: 'sbClientsMount',
                appKey: '_clientsApp',
                create: (mount) => new ClientsApp(mount, {
                    store: this.store,
                    canArchive: this.options?.app?.moduleKey === 'accounting',
                    onOpenProjects: (client) => {
                        try { this.options?.app?.openCustomerProjects?.(client); } catch (e) {}
                    }
                }),
            },
            'archived-clients': {
                mountId: 'sbArchivedClientsMount',
                appKey: '_archivedClientsApp',
                create: (mount) => new ClientsApp(mount, {
                    store: this.store,
                    archivedMode: true,
                    canRestore: this.options?.app?.moduleKey === 'accounting',
                }),
            },
            'users': {
                mountId: 'sbUsersMount',
                appKey: '_usersApp',
                create: (mount) => new UsersApp(mount),
            },
            'client-projects': {
                mountId: 'sbClientProjectsMount',
                appKey: '_clientProjectsApp',
                create: (mount) => new ClientProjectsApp(mount, {
                    store: this.store,
                    onOpenBoard: (project) => {
                        try { this.options?.app?.openBoardForProject?.(project); } catch (e) {}
                    }
                }),
            },
            'status-projects': {
                mountId: 'sbStatusProjectsMount',
                appKey: '_clientProjectsApp',
                create: (mount) => new ClientProjectsApp(mount, {
                    store: this.store,
                    onOpenBoard: (project) => {
                        try { this.options?.app?.focusProject?.(project); } catch (e) {}
                    }
                }),
            },
            'activity': {
                mountId: 'sbActivityLogMount',
                appKey: '_activityLogApp',
                create: (mount) => new ActivityLogApp(mount, { app: this.options?.app }),
            },
            'automation-logs': {
                mountId: 'sbAutomationLogsMount',
                appKey: '_automationLogsApp',
                create: (mount) => new AutomationLogsApp(mount, {
                    app: this.options?.app,
                    initialFilters: this.options?.app?._automationLogsFilters || {},
                    projectTypes: this.options?.app?.projectTypes || [],
                }),
            },
            'settings': {
                mountId: 'sbSettingsMount',
                appKey: '_settingsApp',
                create: (mount) => {
                    const initialTab = this.options?.app?._settingsTab || null;
                    return new SettingsApp(mount, { initialTab });
                },
            },
            'report': {
                mountId: 'sbReportMount',
                appKey: '_reportApp',
                create: (mount) => new ReportApp(mount, { app: this.options?.app }),
            },
        };
    }

    _mountRegisteredProductView(placeholder, view) {
        const config = this._productViewRegistry()[view];
        if (!config) return false;

        this._destroyMountedApps();
        placeholder.innerHTML = `<div id="${config.mountId}"></div>`;
        const mount = placeholder.querySelector(`#${config.mountId}`);
        const app = config.create(mount);
        this[config.appKey] = app;
        app?.init?.();
        return true;
    }

    showPlaceholder(view) {
        const placeholder = this.container.querySelector('#pagePlaceholder');
        const boardTableContainer = this.container.querySelector('#boardTableContainer');
        const emptyState = this.container.querySelector('#emptyState');
        const loadingState = this.container.querySelector('#loadingState');

        if (boardTableContainer) boardTableContainer.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
        if (loadingState) loadingState.style.display = 'none';
        if (!placeholder) return;

        placeholder.style.display = 'block';
        if (this._mountRegisteredProductView(placeholder, view)) return;

        // Dashboard and any remaining static placeholder pages stay HTML-only.
        this._destroyMountedApps();
        placeholder.innerHTML = renderPlaceholderHTML(view, this.store);
    }

    setClientsSearch(q) {
        try { return this._clientsApp?.search?.(q); } catch (e) {}
    }

    openClientsColumnsManager() {
        try { return this._clientsApp?.openColumnsManager?.(); } catch (e) {}
    }

    openSortDialog() {
        try { return this.boardTable?.openSortDialog?.(); } catch (e) {}
    }
    
    handleResize() {
        if (this.boardTable) {
            this.boardTable.handleResize();
        }
    }
    
    destroy() {
        if (this.boardTable) {
            this.boardTable.destroy();
        }
        this._destroyMountedApps();
        try { this._unsub?.(); } catch (e) {}
        this._unsub = null;
        this.container.innerHTML = '';
    }
}

