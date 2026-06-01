/**
 * Header Toolbars
 * - Renders and binds the right-side actions area based on view type.
 * - Keeps Header.js small and prevents it from growing unbounded.
 */

export function renderHeaderActions(view, { isBoardView, moduleKey }) {
    const isBoard = !!isBoardView;
    const isArchived = String(view || '').trim() === 'archived-projects';

    if (isBoard) {
        return `
            <div class="header-search">
                <input 
                    type="text" 
                    class="form-control search-input" 
                    placeholder="Search projects..."
                    id="headerSearchInput"
                />
            </div>
            <button class="btn btn-default btn-filter" id="btnFilter">Filter<span class="filter-badge" id="filterBadge"></span></button>
            <button class="btn btn-default btn-sort" id="btnSort">Sort<span class="filter-badge" id="sortBadge"></span></button>
            <button class="btn btn-default btn-automation" id="btnAutomation">Automation</button>
            <button class="btn btn-default btn-columns" id="btnManageColumns">Columns</button>
            ${isArchived ? '' : '<button class="btn btn-primary btn-new-project" id="btnNewProject">New Project</button>'}
        `;
    }

    if (view === 'clients') {
        return `
            <div class="header-search">
                <input 
                    type="text" 
                    class="form-control search-input" 
                    placeholder="Search clients..."
                    id="headerClientSearchInput"
                />
            </div>
            <button class="btn btn-default" id="btnExportClientsCsv">Export CSV</button>
            <button class="btn btn-default" id="btnClientsColumns">Columns</button>
            <button class="btn btn-primary" id="btnNewClient">New Client</button>
        `;
    }

    if (view === 'client-projects') {
        return `
            <button class="btn btn-default" id="btnClientProjectsBack">Back</button>
            <div class="header-search">
                <input 
                    type="text" 
                    class="form-control search-input" 
                    placeholder="Search projects..."
                    id="headerClientProjectsSearchInput"
                />
            </div>
            <button class="btn btn-primary" id="btnClientProjectsNewProject">New Project</button>
        `;
    }

    if (view === 'status-projects') {
        return `
            <button class="btn btn-default" id="btnStatusProjectsBack">Back</button>
            <div class="header-search">
                <input 
                    type="text" 
                    class="form-control search-input" 
                    placeholder="Search projects..."
                    id="headerStatusProjectsSearchInput"
                />
            </div>
        `;
    }

    if (view === 'dashboard') {
        return `<button class="btn btn-default" id="btnDashboardRefresh">Refresh</button>`;
    }

    return '';
}

export function bindHeaderActions(rootEl, view, { isBoardView, moduleKey, onAction, onShowFilter }) {
    const isBoard = !!isBoardView;

    if (isBoard) {
        rootEl.querySelector('#btnNewProject')?.addEventListener('click', () => onAction?.('new_project'));
        rootEl.querySelector('#btnManageColumns')?.addEventListener('click', () => onAction?.('manage_columns'));
        rootEl.querySelector('#btnFilter')?.addEventListener('click', () => onShowFilter?.());
        rootEl.querySelector('#btnSort')?.addEventListener('click', () => onAction?.('sort'));
        rootEl.querySelector('#btnAutomation')?.addEventListener('click', () => onAction?.('automation'));

        const searchInput = rootEl.querySelector('#headerSearchInput');
        if (searchInput) {
            let t;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(t);
                t = setTimeout(() => onAction?.('search', e.target.value), 300);
            });
        }
        return;
    }

    rootEl.querySelector('#btnNewClient')?.addEventListener('click', () => onAction?.('new_client'));
    rootEl.querySelector('#btnClientsColumns')?.addEventListener('click', () => onAction?.('clients_columns'));
    rootEl.querySelector('#btnExportClientsCsv')?.addEventListener('click', () => onAction?.('export_clients_csv'));

    const clientSearch = rootEl.querySelector('#headerClientSearchInput');
    if (clientSearch) {
        let t;
        clientSearch.addEventListener('input', (e) => {
            clearTimeout(t);
            t = setTimeout(() => onAction?.('clients_search', e.target.value), 300);
        });
    }

    rootEl.querySelector('#btnDashboardRefresh')?.addEventListener('click', () => onAction?.('dashboard_refresh'));

    rootEl.querySelector('#btnClientProjectsBack')?.addEventListener('click', () => onAction?.('client_projects_back'));
    rootEl.querySelector('#btnClientProjectsNewProject')?.addEventListener('click', () => onAction?.('client_projects_new_project'));
    const clientProjectsSearch = rootEl.querySelector('#headerClientProjectsSearchInput');
    if (clientProjectsSearch) {
        let t;
        clientProjectsSearch.addEventListener('input', (e) => {
            clearTimeout(t);
            t = setTimeout(() => onAction?.('client_projects_search', e.target.value), 300);
        });
    }

    rootEl.querySelector('#btnStatusProjectsBack')?.addEventListener('click', () => onAction?.('status_projects_back'));
    const statusProjectsSearch = rootEl.querySelector('#headerStatusProjectsSearchInput');
    if (statusProjectsSearch) {
        let t;
        statusProjectsSearch.addEventListener('input', (e) => {
            clearTimeout(t);
            t = setTimeout(() => onAction?.('status_projects_search', e.target.value), 300);
        });
    }
}


