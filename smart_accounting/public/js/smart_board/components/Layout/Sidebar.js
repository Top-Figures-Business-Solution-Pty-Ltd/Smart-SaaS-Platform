/**
 * Smart Board - Sidebar Component
 * 左侧导航栏组件
 */

import { renderIcon } from '../../utils/iconUtils.js';

export class Sidebar {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.projectTypes = options.projectTypes || [];
        this.currentView = options.currentView || 'ITR';
        this.allowedViews = Array.isArray(options.allowedViews) ? options.allowedViews : null;
        this.showBoardSettings = options.showBoardSettings !== false;
        this.showArchivedProjects = options.showArchivedProjects !== false;
        this.showCreateProjectType = options.showCreateProjectType !== false;
        this.onViewChange = options.onViewChange || (() => {});
        this.onBoardMenuAction = options.onBoardMenuAction || (() => {});
        this._onContainerClick = null;
        this._openBoardMenuFor = '';
        
        this.render();
        this.bindEvents();
    }
    
    render() {
        const productItems = [];
        const otherItems = [];
        const canSee = (view) => this._isViewVisible(view);

        if (canSee('dashboard')) {
            productItems.push(`
                <a href="#" class="nav-item" data-view="dashboard">
                    ${this._iconMarkup('es-line-home')}
                    <span class="nav-label">Home</span>
                </a>
            `);
        }
        if (canSee('report')) {
            productItems.push(`
                <a href="#" class="nav-item" data-view="report">
                    ${this._iconMarkup('es-line-reports')}
                    <span class="nav-label">Report</span>
                </a>
            `);
        }
        if (canSee('clients')) {
            otherItems.push(`
                <a href="#" class="nav-item" data-view="clients">
                    ${this._iconMarkup('users')}
                    <span class="nav-label">Clients</span>
                </a>
            `);
        }
        if (canSee('users')) {
            otherItems.push(`
                <a href="#" class="nav-item" data-view="users">
                    ${this._iconMarkup('es-solid-user')}
                    <span class="nav-label">Users</span>
                </a>
            `);
        }
        if (canSee('archived-clients')) {
            otherItems.push(`
                <a href="#" class="nav-item" data-view="archived-clients">
                    ${this._iconMarkup('es-line-folder')}
                    <span class="nav-label">Archived Clients</span>
                </a>
            `);
        }
        if (canSee('automation-logs')) {
            otherItems.push(`
                <a href="#" class="nav-item" data-view="automation-logs">
                    ${this._iconMarkup('es-line-zap')}
                    <span class="nav-label">Automation Logs</span>
                </a>
            `);
        }
        if (canSee('settings')) {
            otherItems.push(`
                <a href="#" class="nav-item" data-view="settings">
                    ${this._iconMarkup('es-line-settings')}
                    <span class="nav-label">Settings</span>
                </a>
            `);
        }

        const productSection = productItems.length
            ? `
                <div class="nav-section">
                    ${productItems.join('')}
                </div>
            `
            : '';
        const boardsSection = this.renderProjectTypes();
        const otherSection = otherItems.length
            ? `
                <div class="nav-section">
                    ${otherItems.join('')}
                </div>
            `
            : '';
        const sections = [productSection, boardsSection, otherSection].filter(Boolean);

        this.container.innerHTML = `
            <div class="sidebar-wrapper">
                <nav class="sidebar-nav">
                    ${sections.join('<div class="nav-divider"></div>')}
                </nav>
            </div>
        `;
        
        // 高亮当前视图
        this.highlightCurrentView();
    }
    
    renderProjectTypes() {
        if ((!this.projectTypes || this.projectTypes.length === 0) && !this.showCreateProjectType) {
            return '';
        }

        if (!this.projectTypes || this.projectTypes.length === 0) {
            return `
                <div class="nav-section">
                    <div class="nav-section-title sb-boards-title">
                        <span>Boards</span>
                        ${this.showBoardSettings ? this._iconButtonMarkup('es-line-settings', 'sb-boards-settings', 'id="sbBoardsSettings" title="Board settings" aria-label="Board settings"') : ''}
                    </div>
                    <div class="nav-empty">
                        <div class="text-muted" style="padding: 8px 20px; font-size: 13px;">
                            No Project Types yet
                        </div>
                        ${this.showCreateProjectType ? `
                            <a href="#" class="nav-item" data-view="__create_project_type__">
                                ${this._iconMarkup('plus')}
                                <span class="nav-label">Create Project Type</span>
                            </a>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        const dynamicRows = this.projectTypes.map(type => `
            <div class="sb-board-item ${this._openBoardMenuFor === type.value ? 'is-open' : ''}" data-board-item="${type.value}">
                <a href="#" class="nav-item" data-view="${type.value}">
                    ${this._iconMarkup(type.icon || 'clipboard')}
                    <span class="nav-label">${type.label}</span>
                </a>
                ${this._iconButtonMarkup('es-line-dot-horizontal', 'sb-board-item__more', `data-role="board-menu-trigger" data-view="${type.value}" aria-label="Board menu"`)}
                <div class="sb-board-item__menu" data-role="board-menu" data-view="${type.value}">
                    <button type="button" data-role="board-menu-item" data-action="export_csv" data-view="${type.value}">
                        Export to Excel (CSV)
                    </button>
                </div>
            </div>
        `).join('');

        const archivedRow = this.showArchivedProjects && this._isViewVisible('archived-projects') ? `
            <div class="sb-board-item sb-board-item--archived" data-board-item="archived-projects">
                <a href="#" class="nav-item nav-item--archived" data-view="archived-projects">
                    ${this._iconMarkup('es-line-folder-alt')}
                    <span class="nav-label">Archived Projects</span>
                </a>
            </div>
        ` : '';

        return `
            <div class="nav-section">
                <div class="nav-section-title sb-boards-title">
                    <span>Boards</span>
                    ${this.showBoardSettings ? this._iconButtonMarkup('es-line-settings', 'sb-boards-settings', 'id="sbBoardsSettings" title="Board settings" aria-label="Board settings"') : ''}
                </div>
                ${dynamicRows}${archivedRow}
            </div>
        `;
    }

    _iconMarkup(iconName) {
        return `
            <span class="nav-icon" aria-hidden="true">
                ${renderIcon(iconName, 'md', 'nav-icon-svg')}
            </span>
        `;
    }

    _iconButtonMarkup(iconName, buttonClass, attrs = '') {
        return `
            <button type="button" class="${buttonClass}" ${attrs}>
                <span class="icon-button__icon" aria-hidden="true">${renderIcon(iconName, 'sm', 'icon-button-svg')}</span>
            </button>
        `;
    }

    _isViewVisible(view) {
        const v = String(view || '').trim();
        if (!v) return false;
        if (!Array.isArray(this.allowedViews)) return true;
        return this.allowedViews.includes(v);
    }
    
    bindEvents() {
        // 导航点击事件（事件委托）
        this._onContainerClick = (e) => {
            const settingsBtn = e.target?.closest?.('#sbBoardsSettings');
            if (settingsBtn) {
                e.preventDefault();
                e.stopPropagation();
                try { this.options?.onBoardSettings?.(); } catch (e2) {}
                return;
            }
            const boardMenuTrigger = e.target?.closest?.('[data-role="board-menu-trigger"]');
            if (boardMenuTrigger) {
                e.preventDefault();
                e.stopPropagation();
                const view = String(boardMenuTrigger.getAttribute('data-view') || '');
                const isSame = this._openBoardMenuFor === view;
                this._openBoardMenuFor = isSame ? '' : view;
                this.render();
                return;
            }
            const boardMenuItem = e.target?.closest?.('[data-role="board-menu-item"]');
            if (boardMenuItem) {
                e.preventDefault();
                e.stopPropagation();
                const action = String(boardMenuItem.getAttribute('data-action') || '');
                const view = String(boardMenuItem.getAttribute('data-view') || '');
                this._openBoardMenuFor = '';
                this.render();
                try { this.onBoardMenuAction(action, view); } catch (e2) {}
                return;
            }
            const navItem = e.target.closest('.nav-item');
            if (navItem) {
                e.preventDefault();
                const view = navItem.dataset.view;
                this._openBoardMenuFor = '';
                this.selectView(view);
                return;
            }
            this._openBoardMenuFor = '';
            this.render();
        };
        this.container.addEventListener('click', this._onContainerClick);
    }
    
    selectView(view) {
        const isReselect = view === this.currentView;
        
        // Special action: go to Project Type list
        if (view === '__create_project_type__') {
            // Lazy import to avoid circular deps and keep Sidebar lightweight
            import('../../services/navigationService.js').then(({ openProjectTypeList }) => openProjectTypeList());
            return;
        }

        if (!isReselect) {
            this.currentView = view;
            this.highlightCurrentView();
        }
        
        // 触发回调
        this.onViewChange(view, { reselect: isReselect });
    }
    
    highlightCurrentView() {
        // 移除所有active状态
        this.container.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const effectiveView = (this.currentView === 'client-projects') ? 'clients' : this.currentView;

        // 添加active到当前视图
        const currentItem = this.container.querySelector(
            `.nav-item[data-view="${effectiveView}"]`
        );
        if (currentItem) {
            currentItem.classList.add('active');
        }
    }
    
    updateView(view) {
        this.currentView = view;
        this.highlightCurrentView();
    }

    setProjectTypes(projectTypes) {
        this.projectTypes = projectTypes || [];
        this.render();
        // 事件是绑定在 container 上的（事件委托），render 后无需重复绑定
    }
    
    destroy() {
        if (this._onContainerClick) {
            this.container.removeEventListener('click', this._onContainerClick);
            this._onContainerClick = null;
        }
        this.container.innerHTML = '';
    }
}

