/**
 * Smart Board - Header Component
 * 顶部工具栏组件
 */

import { renderHeaderActions, bindHeaderActions } from './headerToolbars.js';
import { isProductView } from '../../utils/viewTypes.js';
import { AdvancedFilterModal } from '../BoardView/AdvancedFilterModal.js';
import { buildAdvancedFilterColumns } from '../../utils/filterColumns.js';
import { BoardStatusService } from '../../services/boardStatusService.js';
import { countActiveFilters } from '../../utils/filterCount.js';
import { createSimpleFilterReset } from '../../utils/filterState.js';

export class Header {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.currentView = options.currentView || 'ITR';
        this.onAction = options.onAction || (() => {});
        this._unsub = null;
        
        this.render();
        this.bindEvents();
        this.subscribeToStore();
    }
    
    isBoardView() {
        if (typeof this.options.isBoardView === 'function') {
            try {
                return !!this.options.isBoardView(this.currentView);
            } catch (e) {}
        }
        // Default fallback
        return !isProductView(this.currentView);
    }

    render() {
        const isBoard = this.isBoardView();
        this.container.innerHTML = `
            <div class="header-wrapper">
                <!-- Left: View Title -->
                <div class="header-left">
                    <h2 class="view-title">${this.getViewTitle()}</h2>
                    <div class="view-subtitle">${this.getViewSubtitle()}</div>
                </div>
                
                <!-- Right: Actions -->
                <div class="header-right">
                    ${renderHeaderActions(this.currentView, {
                        isBoardView: isBoard,
                        moduleKey: this.options?.moduleKey,
                    })}
                </div>
            </div>
        `;
    }
    
    bindEvents() {
        bindHeaderActions(this.container, this.currentView, {
            isBoardView: this.isBoardView(),
            moduleKey: this.options?.moduleKey,
            onAction: this.onAction,
            onShowFilter: () => this.showFilterDialog(),
        });
    }
    
    getViewTitle() {
        const viewTitles = {
            'dashboard': 'Dashboard',
            'ITR': 'Income Tax Returns',
            'BAS': 'Business Activity Statements',
            'Payroll': 'Payroll',
            'Payroll & Super': 'Payroll & Super',
            'Bookkeeping': 'Bookkeeping',
            'R&D Grant': 'R&D Grants',
            'SMSF': 'SMSF',
            'Audit': 'Audit',
            'Financial Statements': 'Financial Statements',
            'clients': 'Clients',
            'users': 'Users',
            'archived-clients': 'Archived Clients',
            'automation-logs': 'Automation Logs',
            'quality': 'Quality',
            'activity': 'Activity Log',
            'settings': 'Settings',
            'client-projects': 'Client Projects',
            'status-projects': 'Status Projects',
            'archived-projects': 'Archived Projects',
            'report': 'Report',
        };
        
        return viewTitles[this.currentView] || this.currentView;
    }

    getModuleLabel() {
        return String(this.options?.moduleKey || '').trim() === 'grants'
            ? 'Smart Grants'
            : 'Smart Accounting';
    }
    
    getViewSubtitle() {
        const moduleLabel = this.getModuleLabel();
        if (this.currentView === 'clients') {
            return `Showing clients with ${moduleLabel} project counts.`;
        }
        if (this.currentView === 'users') {
            return `Directory of users who can access ${moduleLabel}.`;
        }
        if (this.currentView === 'client-projects') {
            return `Projects in ${moduleLabel} for the selected client.`;
        }
        if (this.currentView === 'archived-clients') {
            return `Clients archived within ${moduleLabel}.`;
        }
        if (this.currentView === 'archived-projects') {
            return `Archived projects in ${moduleLabel}.`;
        }
        if (this.currentView === 'quality') {
            return `Data quality checks for ${moduleLabel}.`;
        }
        return '';
    }
    
    async showFilterDialog() {
        // Website-safe modal (Monday-like)
        const initial = this.options?.store?.getState?.()?.filters || {};
        const statusOptions = await BoardStatusService.getEffectiveOptions({
            projectType: this.currentView,
            currentValue: '',
        });
        const columns = await buildAdvancedFilterColumns({
            viewType: this.currentView,
            statusOptions,
        });

        const modal = new AdvancedFilterModal({
            title: `Filter · ${this.currentView}`,
            viewKey: this.currentView,
            columns,
            initial,
            onApply: (values) => this.onAction('filter', {
                // Clear legacy simple filters to avoid confusing double-filtering.
                ...createSimpleFilterReset(values)
            }),
        });
        modal.open();
    }
    
    updateView(view) {
        this.currentView = view;

        // Re-render to switch toolbars between board/page modes
        this.render();
        this.bindEvents();
        this._updateCountsSubtitle();
        this._updateFilterBadge();
        this._updateSortBadge();
    }

    subscribeToStore() {
        const store = this.options?.store;
        if (!store?.subscribe) return;
        if (this._unsub) {
            try { this._unsub(); } catch (e) {}
            this._unsub = null;
        }
        this._unsub = store.subscribe(() => {
            this._updateCountsSubtitle();
            this._updateFilterBadge();
            this._updateSortBadge();
        });
        this._updateCountsSubtitle();
        this._updateFilterBadge();
        this._updateSortBadge();
    }

    _updateFilterBadge() {
        try {
            const badge = this.container?.querySelector?.('#filterBadge');
            if (!badge) return;

            const filters = this.options?.store?.getState?.()?.filters || {};
            const count = countActiveFilters(filters);

            if (count > 0) {
                badge.textContent = String(count);
                badge.style.display = 'inline-block';
            } else {
                badge.textContent = '';
                badge.style.display = 'none';
            }
        } catch (e) {}
    }

    _updateSortBadge() {
        try {
            const badge = this.container?.querySelector?.('#sortBadge');
            if (!badge) return;
            const filters = this.options?.store?.getState?.()?.filters || {};
            const hasSort = !!String(filters?.sort_field || '').trim();
            if (hasSort) {
                badge.textContent = '1';
                badge.style.display = 'inline-block';
            } else {
                badge.textContent = '';
                badge.style.display = 'none';
            }
        } catch (e) {}
    }

    _updateCountsSubtitle() {
        try {
            const el = this.container?.querySelector?.('.view-subtitle');
            if (!el) return;

            const view = String(this.currentView || '');

            const state = this.options?.store?.getState?.() || {};

            // Clients view: show loaded/total like boards (same UX)
            if (view === 'clients') {
                const c = state?.clients || {};
                const loaded = Array.isArray(c?.items) ? c.items.length : 0;
                const total = (c?.totalCount == null) ? null : Number(c.totalCount);
                const loading = !!c?.loading;
                const loadingMore = !!c?.loadingMore;
                const hasMore = c?.hasMore !== false;

                if (loading && loaded === 0) {
                    el.textContent = 'Loading…';
                    return;
                }
                if (total != null && Number.isFinite(total)) {
                    const all = loaded >= total;
                    el.textContent = all
                        ? `Loaded ${loaded} / ${total} · All loaded`
                        : `Loaded ${loaded} / ${total}${loadingMore ? ' · Loading…' : ''}`;
                    return;
                }
                if (!hasMore && !loadingMore) {
                    el.textContent = `Loaded ${loaded} · All loaded`;
                    return;
                }
                el.textContent = `Loaded ${loaded}${loadingMore ? ' · Loading…' : ''}`;
                return;
            }

            // Only show counts for board views (Project Type boards)
            if (!this.isBoardView()) {
                el.textContent = '';
                return;
            }

            const p = state?.projects || {};
            const loaded = Array.isArray(p?.items) ? p.items.length : 0;
            const total = (p?.totalCount == null) ? null : Number(p.totalCount);
            const loading = !!p?.loading;
            const loadingMore = !!p?.loadingMore;
            const hasMore = p?.hasMore !== false;

            if (loading && loaded === 0) {
                el.textContent = 'Loading…';
                return;
            }

            if (total != null && Number.isFinite(total)) {
                const all = loaded >= total;
                el.textContent = all
                    ? `Loaded ${loaded} / ${total} · All loaded`
                    : `Loaded ${loaded} / ${total}${loadingMore ? ' · Loading…' : ''}`;
                return;
            }

            // Fallback when total is unknown
            if (!hasMore && !loadingMore) {
                el.textContent = `Loaded ${loaded} · All loaded`;
                return;
            }
            el.textContent = `Loaded ${loaded}${loadingMore ? ' · Loading…' : ''}`;
        } catch (e) {}
    }
    
    destroy() {
        try { this._unsub?.(); } catch (e) {}
        this._unsub = null;
        this.container.innerHTML = '';
    }
}

