/**
 * Smart Board - View Types
 * Keep view classification in one place to avoid "if (view === ...)" spreading everywhere.
 */

// Product shell views (non-board).
// NOTE: Some product views are rendered as real apps (e.g. Clients), not placeholders.
export const ARCHIVED_PROJECTS_VIEW = 'archived-projects';
export const REPORT_VIEW = 'report';
export const AUTOMATION_LOGS_VIEW = 'automation-logs';
export const USERS_VIEW = 'users';
export const QUALITY_VIEW = 'quality';
export const PRODUCT_VIEWS = ['dashboard', 'clients', USERS_VIEW, 'client-projects', 'status-projects', 'archived-clients', 'activity', 'settings', REPORT_VIEW, AUTOMATION_LOGS_VIEW, QUALITY_VIEW];

export function isProductView(view) {
    return PRODUCT_VIEWS.includes(view);
}

export function isArchivedView(view) {
    return String(view || '').trim() === ARCHIVED_PROJECTS_VIEW;
}

/**
 * Board view = a Project Type board (e.g. External/Internal/Other) that exists in system Project Type list.
 */
export function isBoardView(view, projectTypes = []) {
    if (isArchivedView(view)) return true;
    if (isProductView(view)) return false;
    const values = new Set((projectTypes || []).map(t => t?.value).filter(Boolean));
    return values.has(view);
}


