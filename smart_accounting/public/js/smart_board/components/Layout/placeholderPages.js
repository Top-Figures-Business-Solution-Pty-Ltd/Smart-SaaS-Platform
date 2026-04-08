// Placeholder pages are the "static HTML" pages inside the product shell.
// Clients/Settings are real apps now (not placeholders).
const PLACEHOLDER_VIEWS = ['dashboard'];

function _escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function isPlaceholderView(view) {
    return PLACEHOLDER_VIEWS.includes(String(view || ''));
}

export function renderPlaceholderHTML(view, store) {
    const state = store?.getState?.() || {};
    const dashboard = state.dashboard || {};
    const myProjects = dashboard?.myProjects || [];
    const projects = view === 'dashboard' ? myProjects : (state.projects?.items || []);

    const total = Number(view === 'dashboard' ? dashboard?.totalCount : projects.length) || 0;
    const byStatus = view === 'dashboard'
        ? (dashboard?.statusCounts || {})
        : projects.reduce((acc, p) => {
            const s = p.status || 'Unknown';
            acc[s] = (acc[s] || 0) + 1;
            return acc;
        }, {});

    if (view === 'dashboard') {
        const loading = !!dashboard?.loading;
        const err = dashboard?.error;
        const hasMore = myProjects.length > 0 && myProjects.length < total;
        const activeStatuses = Object.entries(byStatus)
            .filter(([, v]) => Number(v) > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `
              <button type="button" class="sb-card sb-dash-status-card" data-status="${_escapeHtml(k)}">
                <div class="sb-card__label">${_escapeHtml(k)}</div>
                <div class="sb-card__value">${v}</div>
              </button>
            `)
            .join('');

        const list = (() => {
            if (loading) return `<div class="sb-dash__loading">Loading your projects…</div>`;
            if (err) return `<div class="sb-dash__error">Failed to load: ${String(err)}</div>`;
            if (!myProjects.length) return `<div class="sb-dash__empty">No related projects yet.</div>`;
            const rows = myProjects.map((p) => `
              <tr>
                <td class="sb-dash__proj">${_escapeHtml(p.project_name || p.name)}</td>
                <td class="sb-dash__type">${_escapeHtml(p.project_type || '—')}</td>
                <td class="sb-dash__role">${_escapeHtml(p.role_text || '—')}</td>
                <td class="sb-dash__open">
                  <button class="btn btn-default sb-dash-open-board" data-project-name="${_escapeHtml(p.name)}">Open Board</button>
                </td>
              </tr>
            `).join('');
            return `
              <div class="sb-dash__list">
                <div class="sb-dash__list-title">My Projects</div>
                <div class="text-muted" style="font-size:12px;padding:10px 14px 0 14px;">Showing ${myProjects.length} of ${total}</div>
                <table class="sb-dash__table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Type</th>
                      <th>My Role</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows}
                  </tbody>
                </table>
                <div style="display:flex;justify-content:center;padding:12px 14px 14px 14px;">
                  <button class="btn btn-default btn-sm sb-dash-load-more" type="button" ${loading || !hasMore ? 'disabled' : ''} style="${hasMore ? '' : 'display:none;'}">${loading && hasMore ? 'Loading...' : 'Load more'}</button>
                </div>
              </div>
            `;
        })();

        return `
            <div class="sb-page">
                <div class="sb-page__subtitle">Quick overview of your work</div>
                <div class="sb-cards">
                    <div class="sb-card">
                        <div class="sb-card__label">My Projects</div>
                        <div class="sb-card__value">${total}</div>
                    </div>
                    ${activeStatuses || '<div class="text-muted" style="padding:12px;">No projects loaded yet. Open a board to load data.</div>'}
                </div>
                ${list}
                <div class="sb-page__hint">Tip: choose a Board on the left to view projects.</div>
            </div>
        `;
    }

    return `<div class="sb-page"><div class="sb-page__title">${view}</div></div>`;
}


