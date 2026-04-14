/**
 * Smart Board - Board Table Component
 * 类Monday.com的表格视图组件
 */

import { DEFAULT_COLUMNS, PROJECT_COLUMN_CATALOG, isSortableProjectField } from '../../utils/constants.js';
import { renderColGroup, renderHeaderCells, renderRows } from './boardTableRender.js';
import { initResizable } from './boardTableResize.js';
import { loadColumnWidths, saveColumnWidths } from './boardTableStorage.js';
import { shouldVirtualize, computeWindow, spacerRow } from './boardTableVirtualization.js';
import { ViewService } from '../../services/viewService.js';
import { ColumnsManagerModal } from './ColumnsManagerModal.js';
import { TeamRoleService } from '../../services/teamRoleService.js';
import { EditingManager } from './boardTableEditingManager.js';
import { TaskEditingManager } from './boardTableTaskEditingManager.js';
import { installBoardTableTaskFeatures } from './boardTableTaskFeatures.js';
import { installBoardTableUpdatesFeatures } from './boardTableUpdatesFeatures.js';
import { installBoardTableMonthlyStatusFeatures } from './boardTableMonthlyStatusFeatures.js';
import { columnRegistry } from '../../columns/registry.js';
import { UpdatesModal } from './UpdatesModal.js';
import { buildRowModel } from './rowModel.js';
import { ProjectService } from '../../services/projectService.js';
import { TaskService } from '../../services/taskService.js';
import { confirmDialog, notify } from '../../services/uiAdapter.js';
import { escapeHtml } from '../../utils/dom.js';
import { sanitizeProjectColumnsConfig } from '../../utils/deprecatedColumns.js';
import { ProjectActivityModal } from './ProjectActivityModal.js';
import * as ViewTypes from '../../utils/viewTypes.js';
import { SortModal } from './SortModal.js';
import { getProjectColumnCatalogForModule, filterProjectColumnsForModule } from '../../utils/moduleConfig.js';

export class BoardTable {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.viewType = options.viewType || 'ITR';
        this.moduleKey = options.moduleKey || 'accounting';
        this.store = options.store;
        this.isBoardView = options.isBoardView || (() => false);
        this.onRowClick = options.onRowClick || (() => {});
        this.onSortChange = options.onSortChange || (async () => {});
        this._unsubscribe = null;
        
        this.projects = [];
        this.columns = this.getColumnsForView();
        this.rows = [];
        this._savedView = null; // Saved View doc (team shared default)
        this._colMgr = null;
        this._teamRoles = null;
        this._openingColMgr = false;
        this._editing = null;
        this._taskEditing = null;
        this._bulkWorking = false;
        this._onBulkBarClick = null;

        // Bulk selection (system column)
        this._selected = new Set(); // project.name
        this._projectByName = new Map();
        this._rowModel = buildRowModel([]);
        this._groupBy = null; // reserved for future group-by

        // Task bulk selection (inside expanded task table)
        this._taskSelected = new Map(); // project.name -> Set(task.name)

        // Expand -> Tasks
        this._expanded = new Set(); // project.name
        this._taskCounts = new Map(); // project.name -> count
        this._taskCountsLoading = new Set(); // project.name (in-flight get_task_counts)
        this._updateCounts = new Map(); // project.name -> updates count
        this._updateCountsLoading = new Set();
        this._tasksByProject = new Map(); // project.name -> tasks[]
        this._tasksLoading = new Set(); // project.name
        // Monthly Status (matrix + summary) caches
        this._msStartMonth = null; // 1-12 (board-level)
        this._msStartMonthCounts = {};
        this._msStartMonthByProject = {};
        this._msSummaryByProject = new Map(); // project.name -> { month_index: {done,total,percent} }
        this._msMatrixByTask = new Map(); // task.name -> { month_index: status }
        // Monthly Status loading caches:
        // - summary can be prefetched for many rows (cheap)
        // - matrix (task x 12 months) is heavier and only needed when tasks are expanded
        this._msLoadedProjects = new Set(); // summary loaded
        this._msLoadingProjects = new Set(); // summary loading
        this._msLoadedProjectsMatrix = new Set(); // matrix loaded
        this._msLoadingProjectsMatrix = new Set(); // matrix loading
        this._msLastFetchAt = 0;
        this._taskCols = [
            { field: 'subject', label: 'Task', width: 320 },
            { field: 'status', label: 'Status', width: 140 },
            { field: 'exp_end_date', label: 'Due', width: 140 },
            { field: 'priority', label: 'Priority', width: 120 },
        ];

        // Editing finished hook: while editing we freeze row rerenders; once done we schedule a safe refresh.
        this._onEditFinished = () => this.scheduleRowsUpdate();
        this.container?.addEventListener?.('sb:edit-finished', this._onEditFinished);

        // Virtualization / performance
        this._raf = null;
        this._onScroll = null;
        this._onBodyHScroll = null;
        this._syncingHScroll = false;
        this._onBottomHScroll = null;
        this._onWheelHScroll = null;
        // Prevent feedback loops between body <-> bottom scrollbar.
        this._syncingFromBottom = false;
        this._syncingFromBody = false;
        this._lastLoadMoreAt = 0;
        this._rowHeight = 48; // fallback, will be refined after first render
        this._virtualThreshold = options.virtualThreshold || 200;
        this._overscan = options.overscan || 6;
        
        this.render();
        this.subscribeToStore();

        // Load shared default columns (Saved View) after first paint to keep UI responsive
        this.refreshColumnsFromSavedView();
    }

    _defaultTaskColumnsConfig() {
        // Task columns default (website shell): include the 4 personnel role columns
        return [
            { field: 'subject', label: 'Task', width: 320 },
            { field: 'status', label: 'Status', width: 140 },
            { field: 'exp_end_date', label: 'Due', width: 140 },
            { field: 'priority', label: 'Priority', width: 120 },
            { field: 'team:Assigned Person', label: 'Assigned Person', width: 180 },
            { field: 'team:Preparer', label: 'Preparer', width: 160 },
            { field: 'team:Manager', label: 'Manager', width: 160 },
            { field: 'team:Partner', label: 'Partner', width: 160 },
            { field: 'modified', label: 'Updated', width: 160 },
        ];
    }

    _migrateTaskColumns(taskCfg) {
        const list = Array.isArray(taskCfg) ? taskCfg : [];
        if (!list.length) return this._defaultTaskColumnsConfig();
        const normalized = list.map((c) => {
            const field = String(c?.field || '').trim();
            if (field === 'team:Reviewer') {
                return { ...c, field: 'team:Manager', label: c?.label || 'Manager' };
            }
            return c;
        });
        const fields = normalized.map((c) => String(c?.field || '').trim()).filter(Boolean);
        const hasRoleCols = fields.some((f) => f.startsWith('team:'));
        const hasLegacyOwner = fields.includes('owner') || fields.includes('custom_task_members') || fields.includes('custom_team_members');
        // Legacy schema: only owner/custom_* members => upgrade to role columns
        if (!hasRoleCols && hasLegacyOwner) return this._defaultTaskColumnsConfig();
        return normalized.map((c) => ({ field: c.field, label: c.label || c.field, width: c.width || 140 }));
    }
    
    getColumnsForView() {
        const base = (DEFAULT_COLUMNS[this.viewType] || DEFAULT_COLUMNS['DEFAULT']).map(c => ({ ...c }));
        const widths = loadColumnWidths(this.viewType) || {};
        base.forEach(col => {
            if (widths[col.field]) col.width = widths[col.field];
        });
        return base;
    }

    isArchivedBoard() {
        const fn = typeof ViewTypes?.isArchivedView === 'function'
            ? ViewTypes.isArchivedView
            : ((view) => String(view || '').trim() === 'archived-projects');
        return !!fn(this.viewType);
    }

    getAvailableColumnDefs(includeHidden = true) {
        const base = getProjectColumnCatalogForModule(PROJECT_COLUMN_CATALOG || [], this.moduleKey, { includeHidden });

        // Derived role-based team columns: team:<Role>
        const roles = this._teamRoles || TeamRoleService.peekRoles() || [];
        const derived = roles.map((role) => ({
            field: `team:${role}`,
            // UI label: show role name directly (no "team" prefix)
            label: `${role}`,
            width: 180
        }));

        return base.concat(derived);
    }

    _monthName(i) {
        const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const idx = Number(i) - 1;
        return names[idx] || '';
    }

    _getBoardMonthLabels() {
        // Board-level month order (scheme 1): derived from primary year_end (mode across projects)
        const start = Number(this._msStartMonth || 7); // fallback July
        const out = [];
        for (let k = 0; k < 12; k++) {
            const m = ((start - 1 + k) % 12) + 1;
            out.push(this._monthName(m));
        }
        return out;
    }

    _hasProjectMonthlyCompletion() {
        return !!(this.columns || []).find((c) => c?.field === '__sb_project_monthly_completion');
    }

    _hasTaskMonthlyStatus() {
        return !!(this._taskCols || []).find((c) => c?.field === '__sb_task_monthly_status');
    }

    _needsTaskTeam() {
        return !!(this._taskCols || []).find((c) => {
            const f = String(c?.field || '');
            return f === 'owner' || f === 'custom_task_members' || f === 'custom_team_members' || f.startsWith('team:');
        });
    }

    _expandProjectColumnsForRender(columns) {
        const cols = Array.isArray(columns) ? columns : [];
        const labels = this._getBoardMonthLabels();
        const expanded = [];
        for (const c of cols) {
            if (c?.field === '__sb_project_monthly_completion') {
                for (let mi = 1; mi <= 12; mi++) {
                    expanded.push({
                        field: `__sb_pc_m${String(mi).padStart(2, '0')}`,
                        label: labels[mi - 1] || `M${mi}`,
                        width: 110,
                        sortable: false,
                        __msKind: 'project_completion',
                        __monthIndex: mi
                    });
                }
                continue;
            }
            expanded.push(c);
        }
        return expanded;
    }

    _expandTaskColumnsForRender(columns) {
        const cols = Array.isArray(columns) ? columns : [];
        const labels = this._getBoardMonthLabels();
        const expanded = [];
        for (const c of cols) {
            if (c?.field === '__sb_task_monthly_status') {
                for (let mi = 1; mi <= 12; mi++) {
                    expanded.push({
                        field: `__sb_ts_m${String(mi).padStart(2, '0')}`,
                        label: labels[mi - 1] || `M${mi}`,
                        width: 110,
                        __msKind: 'task_status',
                        __monthIndex: mi
                    });
                }
                continue;
            }
            expanded.push(c);
        }
        return expanded;
    }
    // Monthly Status features are installed via `boardTableMonthlyStatusFeatures.js`

    getDefaultColumnConfigForView() {
        // Default columns for initial Saved View creation (keep existing behavior)
        return (DEFAULT_COLUMNS[this.viewType] || DEFAULT_COLUMNS['DEFAULT'] || []).map(c => ({ ...c }));
    }

    _normalizeSavedColumns(raw) {
        // Saved View.columns could be a JSON string or an array.
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    _normalizeSavedViewColumns(raw) {
        // Backward compat:
        // - legacy: columns = array (project columns)
        // - new: columns = { project: [...], tasks: [...] }
        if (!raw) return { project: [], tasks: [] };
        let v = raw;
        if (typeof v === 'string') {
            try { v = JSON.parse(v); } catch (e) { v = null; }
        }
        if (Array.isArray(v)) return { project: v, tasks: [] };
        if (v && typeof v === 'object') {
            const project = Array.isArray(v.project) ? v.project : (Array.isArray(v.projectColumns) ? v.projectColumns : []);
            const tasks = Array.isArray(v.tasks) ? v.tasks : (Array.isArray(v.taskColumns) ? v.taskColumns : []);
            return { project, tasks };
        }
        return { project: [], tasks: [] };
    }

    _setSavedViewColumnsInMemory(next) {
        if (!this._savedView) return;
        this._savedView = { ...this._savedView, columns: next };
    }

    _resolveSavedColumnLabel({ field, savedLabel, defaultLabel }) {
        const rawField = String(field || '').trim();
        const rawSaved = String(savedLabel || '').trim();
        const rawDefault = String(defaultLabel || '').trim();

        // Older Saved Views sometimes persisted the raw fieldname as the label
        // (e.g. "custom_year_end"). Prefer the catalog label in that case.
        if (!rawSaved) return rawDefault || rawField;
        if (rawSaved === rawField && rawDefault) return rawDefault;
        return rawSaved;
    }

    _normalizeSavedProjectColumnsConfig(columnsConfig) {
        const widths = loadColumnWidths(this.viewType) || {};
        const defs = this.getAvailableColumnDefs(true);
        const map = new Map(defs.map((d) => [d.field, d]));

        return (Array.isArray(columnsConfig) ? columnsConfig : [])
            .map((c) => {
                const field = String(c?.field || '').trim();
                if (!field) return null;
                const def = map.get(field);
                const base = def ? { ...def } : { field, label: field, width: 150 };
                const label = this._resolveSavedColumnLabel({
                    field,
                    savedLabel: c?.label,
                    defaultLabel: base.label,
                });
                const next = { ...base, field, label };
                if (widths[next.field]) next.width = widths[next.field];
                return next;
            })
            .filter(Boolean);
    }

    buildColumnsFromConfig(columnsConfig) {
        const sanitized = filterProjectColumnsForModule(
            sanitizeProjectColumnsConfig(columnsConfig),
            this.moduleKey,
            { viewType: this.viewType }
        );
        const cols = this._normalizeSavedProjectColumnsConfig(sanitized);

        // Ensure at least one column exists
        if (cols.length === 0) return this.getColumnsForView();
        return cols;
    }

    async refreshColumnsFromSavedView() {
        if (!this.viewType) return;
        // Only operate on real board views (system Project Type values)
        if (!this.isBoardView(this.viewType)) return;

        // Warm roles cache (cached) so derived columns have correct labels
        try {
            this._teamRoles = await TeamRoleService.getRoles();
        } catch (e) {}

        const fallbackCols = this.getDefaultColumnConfigForView().map(c => ({ field: c.field, label: c.label }));
        const fallbackTaskCols = this._defaultTaskColumnsConfig().map((c) => ({ field: c.field, label: c.label, width: c.width || 140 }));
        const view = await ViewService.getOrCreateDefaultView(this.viewType, {
            fallbackTitle: `${this.viewType} Board`,
            fallbackColumns: fallbackCols,
            fallbackTaskColumns: fallbackTaskCols,
        });

        if (!view) return;
        this._savedView = view;

        const both = this._normalizeSavedViewColumns(view.columns);
        const cfgRaw = both.project || [];
        const cfg = filterProjectColumnsForModule(
            sanitizeProjectColumnsConfig(cfgRaw),
            this.moduleKey,
            { viewType: this.viewType }
        );
        const normalizedProjectCfg = this._normalizeSavedProjectColumnsConfig(cfg).map((c) => ({ field: c.field, label: c.label }));
        const taskCfg = both.tasks || [];
        const nextTaskCols = this._migrateTaskColumns(taskCfg);
        this._taskCols = nextTaskCols;

        // If Saved View is legacy schema (no tasks), persist upgraded schema (best-effort)
        try {
            const raw = view?.columns;
            const isLegacyArray = Array.isArray(raw);
            const tasksEmpty = !(Array.isArray(taskCfg) && taskCfg.length);
            const droppedDeprecated = Array.isArray(cfgRaw) && cfgRaw.length !== cfg.length;
            const filteredByModule = Array.isArray(cfgRaw) && cfgRaw.length !== cfg.length;
            const staleProjectLabels = Array.isArray(cfg)
                && cfg.some((c, idx) => String(c?.label || '').trim() !== String(normalizedProjectCfg[idx]?.label || '').trim());
            const missingRequiredModuleCols = String(this.moduleKey || '') === 'grants'
                && [
                    'custom_grants_deliverer',
                    'custom_grants_state',
                    'custom_grants_industry_category',
                    'custom_grants_address_snapshot',
                ].some((field) => !(cfg || []).some((c) => String(c?.field || '').trim() === field));
            if (view?.name && (isLegacyArray || tasksEmpty || droppedDeprecated || filteredByModule || staleProjectLabels || missingRequiredModuleCols)) {
                await ViewService.updateView(view.name, { columns: { project: normalizedProjectCfg || [], tasks: nextTaskCols } });
                this._setSavedViewColumnsInMemory({ project: normalizedProjectCfg || [], tasks: nextTaskCols });
            }
        } catch (e) {}
        if (!normalizedProjectCfg || normalizedProjectCfg.length === 0) return;

        this.columns = this.buildColumnsFromConfig(normalizedProjectCfg);
        this.render();
    }
    
    render() {
        // Build render columns (inject system columns, compute sticky offsets, apply header classes)
        this._renderColumns = this.buildRenderColumns();
        const colWidth = (c) => {
            const n = Number(c?.width || 0);
            if (Number.isFinite(n) && n > 0) return n;
            if (c?.field === '__sb_select') return 52;
            return 140;
        };
        const tableWidth = (this._renderColumns || []).reduce((sum, c) => sum + colWidth(c), 0);
        this._tableWidthPx = tableWidth;

        const archived = this.isArchivedBoard();
        if (this.container) this.container.dataset.sbReadonly = archived ? '1' : '0';
        const bulkActionButtons = archived
            ? `
                  <button type="button" class="btn btn-default btn-sm" data-action="bulk-restore">Restore</button>
                  <button type="button" class="btn btn-light btn-sm" data-action="bulk-clear">Clear</button>
              `
            : `
                  <button type="button" class="btn btn-default btn-sm" data-action="bulk-add-task">Add Task</button>
                  <button type="button" class="btn btn-default btn-sm" data-action="bulk-archive">Archive</button>
                  <button type="button" class="btn btn-danger btn-sm" data-action="bulk-delete">Delete</button>
                  <button type="button" class="btn btn-light btn-sm" data-action="bulk-clear">Clear</button>
              `;
        this.container.innerHTML = `
            <div class="board-table-wrapper">
                <!-- Table Header -->
                <div class="board-table-header">
                    <table class="board-table" style="width:${tableWidth}px">
                        ${renderColGroup(this._renderColumns)}
                        <thead>
                            <tr>
                                ${renderHeaderCells(this._renderColumns, this._getSortState())}
                            </tr>
                        </thead>
                    </table>
                </div>
                
                <!-- Table Body (Scrollable) -->
                <div class="board-table-body" id="boardTableBody">
                    <table class="board-table" style="width:${tableWidth}px">
                        ${renderColGroup(this._renderColumns)}
                        <tbody id="tableBody">
                            ${this.renderRows()}
                        </tbody>
                    </table>
                </div>

                <!-- Bottom horizontal scrollbar (page-level feel) -->
                <div class="sb-bottom-hscroll" id="sbBottomHScroll" style="display:none;">
                    <div class="sb-bottom-hscroll__inner" style="width:${tableWidth}px;"></div>
                </div>
            </div>
            <div class="sb-bulkbar" id="sbBulkBar" style="display:none;">
              <div class="sb-bulkbar__inner">
                <div class="sb-bulkbar__left">
                  <span class="sb-bulkbar__count"><span id="sbBulkCount">0</span> selected</span>
                </div>
                <div class="sb-bulkbar__actions">
                  ${bulkActionButtons}
                </div>
              </div>
            </div>
            <div class="sb-bulkbar" id="sbTaskBulkBar" style="display:none;">
              <div class="sb-bulkbar__inner">
                <div class="sb-bulkbar__left">
                  <span class="sb-bulkbar__count"><span id="sbTaskBulkCount">0</span> tasks selected</span>
                </div>
                <div class="sb-bulkbar__actions">
                  <button type="button" class="btn btn-default btn-sm" data-action="task-bulk-update">Update</button>
                  <button type="button" class="btn btn-danger btn-sm" data-action="task-bulk-delete">Delete</button>
                  <button type="button" class="btn btn-light btn-sm" data-action="task-bulk-clear">Clear</button>
                </div>
              </div>
            </div>
        `;
        
        this.bindEvents();
    }
    
    renderRows() {
        return renderRows(
            this._rowModel?.all?.() || this.projects,
            this._renderColumns || this.columns,
            (p) => this.handleRowClick(p),
            this.rows,
            {
                isSelected: (p) => this._selected?.has?.(p?.name),
                isExpanded: (p) => this._expanded?.has?.(p?.name),
                expandedRowHTML: (p, cols) => this._renderExpandedTasksRow(p, cols),
            }
        );
    }
    
    bindEvents() {
        // Header排序
        const headers = this.container.querySelectorAll('th[data-field]');
        headers.forEach(header => {
            header.addEventListener('click', (e) => {
                // Status settings (gear) should not trigger sort
                const gear = e.target?.closest?.('.sb-status-settings-btn');
                if (gear) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openStatusSettings?.();
                    return;
                }
                if (!e.target.closest('.resize-handle')) {
                    this.handleSort(header.dataset.field);
                }
            });
        });
        
        // 列宽调整
        this.initResizable();
        
        // 行点击
        const tbody = this.container.querySelector('#tableBody');
        if (tbody) {
            tbody.addEventListener('click', (e) => {
                const msCell = e.target?.closest?.('.sb-ms-cell');
                if (msCell) {
                    e.preventDefault();
                    e.stopPropagation();
                    this._openTaskMonthlyStatusMenu(msCell);
                    return;
                }
                // Task delete / bulk delete actions inside expanded task table
                // (task bulk bar moved to fixed bottom bar; handled elsewhere)
                const taskDelBtn = e.target?.closest?.('.sb-task-delete-btn');
                if (taskDelBtn) {
                    if (this.isArchivedBoard()) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const projectName = taskDelBtn.getAttribute('data-project') || '';
                    const taskName = taskDelBtn.getAttribute('data-task') || '';
                    if (projectName && taskName) this._handleDeleteTask?.(projectName, taskName);
                    return;
                }
                const addTaskBtn = e.target?.closest?.('.sb-add-task-btn');
                if (addTaskBtn) {
                    if (this.isArchivedBoard()) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const projectName = addTaskBtn.dataset.projectName;
                    if (projectName) this._handleAddTask(projectName);
                    return;
                }
                const taskColsBtn = e.target?.closest?.('button[data-action="task-columns"]');
                if (taskColsBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openTaskColumnManager();
                    return;
                }
                const expBtn = e.target?.closest?.('.sb-expand-btn');
                if (expBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const projectName = expBtn.dataset.projectName;
                    if (projectName) this.toggleExpand(projectName);
                    return;
                }
                // Updates entrypoint (primary column)
                const updBtn = e.target?.closest?.('.sb-update-btn');
                if (updBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const projectName = updBtn.dataset.projectName;
                    const project = this.projects.find(p => p.name === projectName);
                    if (project) {
                        this.openUpdates(project);
                    }
                    return;
                }
                const restoreBtn = e.target?.closest?.('.sb-restore-btn');
                if (restoreBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const projectName = restoreBtn.dataset.projectName;
                    if (projectName) this._restoreProjects([projectName]);
                    return;
                }
                const actBtn = e.target?.closest?.('.sb-activity-open-btn');
                if (actBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const projectName = actBtn.dataset.projectName;
                    const project = this.projects.find(p => p.name === projectName);
                    if (project) this.openProjectActivity(project);
                    return;
                }
                const row = e.target.closest('tr');
                if (row && row.dataset.projectName) {
                    // If user is clicking inside an editor, ignore row click.
                    if (e.target?.closest?.('.sb-inline-editor')) return;
                    // If user is clicking an editable cell, it should enter edit, not open details.
                    if (e.target?.closest?.('td.editable')) return;
                    // Clicking selection checkbox should not trigger row open.
                    if (e.target?.closest?.('.sb-row-select') || e.target?.closest?.('.sb-select-col')) return;
                    const project = this.projects.find(p => p.name === row.dataset.projectName);
                    if (project) {
                        this.handleRowClick(project);
                    }
                }
            });

            // Task sub-table bulk select (checkboxes)
            tbody.addEventListener('change', (e) => {
                const target = e.target;
                if (!(target instanceof HTMLInputElement)) return;
                if (this.isArchivedBoard() && (target.classList.contains('sb-task-select-all') || target.classList.contains('sb-task-select'))) {
                    target.checked = false;
                    return;
                }

                // Select all tasks within one expanded project
                if (target.classList.contains('sb-task-select-all')) {
                    const projectName = target.getAttribute('data-project') || '';
                    if (!projectName) return;

                    if (!this._taskSelected.has(projectName)) this._taskSelected.set(projectName, new Set());
                    const set = this._taskSelected.get(projectName);

                    const grid = target.closest('.sb-task-grid');
                    if (!grid) return;
                    const boxes = Array.from(grid.querySelectorAll('input.sb-task-select'));

                    if (target.checked) {
                        for (const cb of boxes) {
                            cb.checked = true;
                            const tn = cb.getAttribute('data-task') || '';
                            if (tn) set.add(tn);
                            cb.closest('tr')?.classList.add('sb-task-selected');
                        }
                    } else {
                        for (const cb of boxes) {
                            cb.checked = false;
                            const tn = cb.getAttribute('data-task') || '';
                            if (tn) set.delete(tn);
                            cb.closest('tr')?.classList.remove('sb-task-selected');
                        }
                    }
                    // Update task bulk bar (global)
                    this._updateTaskBulkBar?.();
                    return;
                }

                // Single task checkbox
                if (target.classList.contains('sb-task-select')) {
                    const projectName = target.getAttribute('data-project') || '';
                    const taskName = target.getAttribute('data-task') || '';
                    if (!projectName || !taskName) return;

                    if (!this._taskSelected.has(projectName)) this._taskSelected.set(projectName, new Set());
                    const set = this._taskSelected.get(projectName);
                    if (target.checked) set.add(taskName);
                    else set.delete(taskName);

                    target.closest('tr')?.classList.toggle('sb-task-selected', target.checked);

                    // Keep "select all" checkbox in sync
                    const grid = target.closest('.sb-task-grid');
                    const all = grid?.querySelector?.('input.sb-task-select-all');
                    if (all) {
                        const boxes = Array.from(grid.querySelectorAll('input.sb-task-select'));
                        all.checked = boxes.length > 0 && boxes.every((b) => b.checked);
                    }
                    this._updateTaskBulkBar?.();
                }
            });
        }
        
        // 单元格编辑
        this.initCellEditing();
        this.initTaskEditing();

        // Bulk select events
        this.bindBulkSelect();
        this.bindBulkBar();
        this.bindTaskBulkBar?.();

        // Virtual scroll
        this.bindScroll();

        // Horizontal scroll sync (body drives, header follows)
        this.bindHorizontalScrollSync();
        this.bindBottomScrollbarSync();
        this._syncHeaderPaddingForScrollbar();
        this._updateBottomScrollbarVisibility();
        this._bindTrackpadHorizontalScroll();
        this._positionBottomScrollbar();
    }

    async openStatusSettings() {
        try {
            const { openBoardStatusSettings } = await import('../../controllers/boardStatusController.js');
            await openBoardStatusSettings({
                projectType: this.viewType,
                onSaved: () => {
                    // No need to re-fetch projects; only editor options change.
                }
            });
        } catch (e) {
            notify(`Open status settings failed: ${e?.message || String(e)}`, 'red');
        }
    }

    bindHorizontalScrollSync() {
        const header = this.container.querySelector('.board-table-header');
        const body = this.container.querySelector('#boardTableBody');
        const bottom = this.container.querySelector('#sbBottomHScroll');
        if (!header || !body) return;

        // Remove existing listener to avoid leaks on re-render
        if (this._onBodyHScroll) {
            body.removeEventListener('scroll', this._onBodyHScroll);
            this._onBodyHScroll = null;
        }

        this._onBodyHScroll = () => {
            // If scroll originated from bottom scrollbar sync, ignore to avoid jitter/blur.
            if (this._syncingFromBottom) return;
            if (this._syncingHScroll) return;
            // If no horizontal overflow, do nothing
            const left = body.scrollLeft || 0;
            // Schedule in rAF to avoid layout thrash on fast scroll
            requestAnimationFrame(() => {
                this._syncingHScroll = true;
                // Avoid redundant writes (can trigger extra style/layout work)
                if ((header.scrollLeft || 0) !== left) header.scrollLeft = left;
                if (bottom) {
                    // Mark as programmatic update to avoid bottom->body feedback loops.
                    this._syncingFromBody = true;
                    if ((bottom.scrollLeft || 0) !== left) bottom.scrollLeft = left;
                    requestAnimationFrame(() => { this._syncingFromBody = false; });
                }
                this._syncingHScroll = false;
            });
        };

        // Passive for perf
        body.addEventListener('scroll', this._onBodyHScroll, { passive: true });
        // Initial sync
        header.scrollLeft = body.scrollLeft || 0;
        if (bottom) {
            this._syncingFromBody = true;
            bottom.scrollLeft = body.scrollLeft || 0;
            requestAnimationFrame(() => { this._syncingFromBody = false; });
        }
    }

    bindBottomScrollbarSync() {
        const bottom = this.container.querySelector('#sbBottomHScroll');
        const header = this.container.querySelector('.board-table-header');
        const body = this.container.querySelector('#boardTableBody');
        if (!bottom || !header || !body) return;

        if (this._onBottomHScroll) {
            bottom.removeEventListener('scroll', this._onBottomHScroll);
            this._onBottomHScroll = null;
        }

        this._onBottomHScroll = () => {
            // If bottom scroll was set programmatically from body, ignore.
            if (this._syncingFromBody) return;
            const left = bottom.scrollLeft || 0;
            requestAnimationFrame(() => {
                this._syncingFromBottom = true;
                if ((body.scrollLeft || 0) !== left) body.scrollLeft = left;
                if ((header.scrollLeft || 0) !== left) header.scrollLeft = left;
                requestAnimationFrame(() => { this._syncingFromBottom = false; });
            });
        };
        bottom.addEventListener('scroll', this._onBottomHScroll, { passive: true });
    }

    _bindTrackpadHorizontalScroll() {
        const body = this.container.querySelector('#boardTableBody');
        const container = this.container?.closest?.('.board-table-container') || this.container;
        if (!container || !body) return;

        if (this._onWheelHScroll) {
            container.removeEventListener('wheel', this._onWheelHScroll);
            this._onWheelHScroll = null;
        }

        this._onWheelHScroll = (e) => {
            // Allow normal vertical scroll; only handle horizontal intent.
            const dx = Number(e?.deltaX || 0);
            const dy = Number(e?.deltaY || 0);
            let delta = 0;
            if (Math.abs(dx) > 0) delta = dx;
            else if (e?.shiftKey && Math.abs(dy) > 0) delta = dy;
            else return;

            const current = body.scrollLeft || 0;
            const next = current + delta;
            if (next === current) return;
            body.scrollLeft = next;
            // Prevent page from horizontally/vertically scrolling while we handle h-scroll
            e.preventDefault();
        };

        container.addEventListener('wheel', this._onWheelHScroll, { passive: false });
    }

    _positionBottomScrollbar() {
        const bottom = this.container.querySelector('#sbBottomHScroll');
        const wrapper = this.container.querySelector('.board-table-wrapper');
        if (!bottom || !wrapper) return;
        const rect = wrapper.getBoundingClientRect();
        const left = Math.max(0, rect.left || 0);
        const rightGap = Math.max(0, (window.innerWidth || 0) - (rect.right || 0));
        bottom.style.left = `${left}px`;
        bottom.style.right = `${rightGap}px`;
    }

    _syncHeaderPaddingForScrollbar() {
        const header = this.container.querySelector('.board-table-header');
        const body = this.container.querySelector('#boardTableBody');
        if (!header || !body) return;
        // Align header with body when body has a vertical scrollbar.
        const sbw = Math.max(0, (body.offsetWidth || 0) - (body.clientWidth || 0));
        header.style.paddingRight = sbw ? `${sbw}px` : '';
    }

    _updateBottomScrollbarVisibility() {
        const bottom = this.container.querySelector('#sbBottomHScroll');
        const body = this.container.querySelector('#boardTableBody');
        if (!bottom || !body) return;
        requestAnimationFrame(() => {
            const hasH = (body.scrollWidth || 0) > (body.clientWidth || 0) + 2;
            bottom.style.display = hasH ? 'block' : 'none';
        });
    }
    
    bindScroll() {
        // Vertical scrolling is handled by the outer container (this.container = .board-table-container)
        const scrollEl = this.container;
        if (!scrollEl) return;

        if (this._onScroll) {
            scrollEl.removeEventListener('scroll', this._onScroll);
            this._onScroll = null;
        }

        this._onScroll = () => {
            // Requirement: click elsewhere saves; scrolling is a "leave cell" action too.
            if (this._editing?.isEditing?.()) {
                if (this._editing?.shouldCommitOnScroll?.() !== false) {
                    this._editing.commitAndClose?.('scroll');
                }
            }

            // Infinite scroll (pagination): when near bottom, fetch next page.
            this._maybeLoadMore?.(scrollEl);

            // Virtual mode only: update visible window.
            if (this.isVirtual()) {
                this.scheduleRowsUpdate();
            }
        };
        scrollEl.addEventListener('scroll', this._onScroll, { passive: true });
    }

    _maybeLoadMore(bodyEl) {
        const scrollEl = bodyEl || this.container;
        if (!scrollEl || !this.store) return;

        // Expanded rows disable virtualization; still allow loading more.
        const st = this.store.getState?.()?.projects;
        if (!st) return;
        if (st.loading || st.loadingMore) return;
        if (!st.hasMore) return;

        // Avoid auto-loading more on initial render (when scrollTop is 0 but content is short).
        // Only load more after the user actually scrolls a bit.
        if ((scrollEl.scrollTop || 0) < 8) return;

        // Throttle to avoid hammering on fast scroll
        const now = Date.now();
        if (now - (this._lastLoadMoreAt || 0) < 350) return;

        const nearBottom = (scrollEl.scrollTop + scrollEl.clientHeight) >= (scrollEl.scrollHeight - 320);
        if (!nearBottom) return;

        this._lastLoadMoreAt = now;
        // Use stored lastFilters inside the projects module, so we don't need to reconstruct filters here.
        this.store.dispatch?.('projects/fetchMoreProjects', null);
    }

    initResizable() {
        initResizable(this.container, {
            onWidthChange: (field, width) => {
                // Keep in-memory columns config in sync so future renders keep the new width.
                const w = Number(width) || 0;
                if (!field || !w) return;

                const updateList = (list) => {
                    if (!Array.isArray(list)) return;
                    const col = list.find((c) => c?.field === field);
                    if (col) col.width = w;
                };

                updateList(this.columns);
                updateList(this._renderColumns);
            },
            onWidthChangeDone: () => this.saveColumnWidths()
        });
    }
    
    initCellEditing() {
        if (this.isArchivedBoard()) return;
        // 实现单元格行内编辑（click -> edit）
        const tbody = this.container.querySelector('#tableBody');
        if (!tbody) return;

        if (!this._editing) {
            this._editing = new EditingManager({
                rootEl: this.container,
                store: this.store,
                getProjectByName: (name) => this._projectByName.get(name) || null,
                // Inline bulk sync: default apply to ALL editable fields unless explicitly opted-out by spec.bulkSync === false
                getSelectedProjectNames: () => Array.from(this._selected || []),
                bulkEditableFields: [],
            });
        }
        this._editing.bindToTbody(tbody);
    }

    initTaskEditing() {
        if (this.isArchivedBoard()) return;
        const tbody = this.container.querySelector('#tableBody');
        if (!tbody) return;
        if (!this._taskEditing) {
            this._taskEditing = new TaskEditingManager({
                rootEl: this.container,
                getTaskByName: (projectName, taskName) => this._getTaskByName(projectName, taskName),
                updateTask: (taskName, data) => ProjectService.updateTask(taskName, data),
                onTaskUpdated: ({ projectName, taskName, field, value }) => {
                    this._updateTaskLocal(projectName, taskName, field, value);
                }
            });
        }
        this._taskEditing.bindToTbody(tbody);
    }
    // Task features (expand / render / helpers) are installed via `boardTableTaskFeatures.js`

    buildRenderColumns() {
        // Inject system select column at the very left (not persisted in Saved View)
        const selectCol = {
            field: '__sb_select',
            label: '',
            width: 52,
            frozen: true,
            sortable: false
        };

        // Clone columns to avoid mutating Saved View config objects
        const base = (this.columns || []).map((c) => ({ ...c }));
        const expandedProjectCols = this._expandProjectColumnsForRender(base);
        const cols = [selectCol].concat(expandedProjectCols);

        // Primary column = first user-selected project column (like Monday's "Name" column)
        const primaryField = cols.find((c) => c?.field && c.field !== '__sb_select' && !String(c.field).startsWith('__sb_pc_m'))?.field || null;

        // Apply header class hooks + compute sticky left offsets for frozen columns
        let left = 0;
        for (const col of cols) {
            col.__isPrimary = !!(primaryField && col.field === primaryField);
            const baseHeaderClass = columnRegistry.getHeaderClass({ column: col }) || '';
            col.__headerClass = `${baseHeaderClass} ${col.__isPrimary ? 'sb-primary-col' : ''}`.trim();
            col.__cellClass = col.__isPrimary ? 'sb-primary-col' : '';
            col.__helpText = this._getHeaderHelpText(col);
            // Keep the primary (first user) column sticky so right-side content doesn't slide behind it.
            col.frozen = !!(col.frozen || col.__isPrimary);
            if (col.frozen) {
                col._stickyLeft = left;
                left += Number(col.width || 0);
            } else {
                col._stickyLeft = null;
            }
        }
        return cols;
    }

    _getHeaderHelpText(col) {
        const field = String(col?.field || '').trim();
        const viewType = String(this.viewType || '').trim();
        if (field !== 'custom_lodgement_due_date') return '';
        if (!['BAS', 'IAS'].includes(viewType)) return '';
        return [
            'Quarterly BAS/IAS rollover rule:',
            '- before 26 May 2026 -> rolls to 26 May 2026',
            '- from 26 May 2026 to before 25 August 2026 -> rolls to 25 August 2026',
            '- on or after 25 August 2026 -> rollover stops and a warning is shown',
            '',
            'Future yearly quarterly rules will be managed in Settings > Quarterly Due Date Rules (in development).',
        ].join('\n');
    }

    bindBulkSelect() {
        const headerCb = this.container.querySelector('.sb-select-all');
        const tbody = this.container.querySelector('#tableBody');

        if (headerCb) {
            headerCb.addEventListener('change', (e) => {
                const checked = !!e.target.checked;
                this._setAllSelected(checked);
                this.updateSelectAllCheckbox();
                this.updateBulkBar();
                this.scheduleRowsUpdate();
            });
        }

        if (tbody) {
            tbody.addEventListener('change', (e) => {
                const cb = e.target?.closest?.('.sb-row-select');
                if (!cb) return;
                const name = cb.dataset.projectName;
                if (!name) return;
                if (cb.checked) this._selected.add(name);
                else this._selected.delete(name);
                this.updateSelectAllCheckbox();
                this.updateBulkBar();
                // Update row highlight without full rerender
                const row = cb.closest('tr');
                if (row) row.classList.toggle('selected', cb.checked);
            });
        }

        // Initial state
        this.updateSelectAllCheckbox();
        this.updateBulkBar();
    }

    _setAllSelected(checked) {
        if (!checked) {
            this._selected.clear();
            return;
        }
        (this.projects || []).forEach((p) => {
            if (p?.name) this._selected.add(p.name);
        });
    }

    updateSelectAllCheckbox() {
        const headerCb = this.container.querySelector('.sb-select-all');
        if (!headerCb) return;
        const total = (this.projects || []).length;
        const selectedCount = (this.projects || []).reduce((acc, p) => acc + (this._selected.has(p?.name) ? 1 : 0), 0);
        headerCb.indeterminate = selectedCount > 0 && selectedCount < total;
        headerCb.checked = total > 0 && selectedCount === total;
    }

    updateBulkBar() {
        const bar = this.container.querySelector('#sbBulkBar');
        const countEl = this.container.querySelector('#sbBulkCount');
        if (!bar || !countEl) return;
        const n = this._getSelectedNames?.().length || 0;
        countEl.textContent = String(n);
        bar.style.display = n > 0 ? 'block' : 'none';

        // Disable buttons while a bulk action is running
        bar.querySelectorAll('button[data-action]')?.forEach?.((btn) => {
            btn.disabled = !!this._bulkWorking;
        });

        // If task bulk bar is visible, it may need to reposition to avoid overlap.
        try { this._updateTaskBulkBar?.(); } catch (e) {}
    }

    bindBulkBar() {
        const bar = this.container.querySelector('#sbBulkBar');
        if (!bar) return;

        if (this._onBulkBarClick) {
            bar.removeEventListener('click', this._onBulkBarClick);
            this._onBulkBarClick = null;
        }

        this._onBulkBarClick = (e) => {
            const btn = e.target?.closest?.('button[data-action]');
            const action = btn?.dataset?.action;
            if (!action) return;
            e.preventDefault();
            e.stopPropagation();
            this._handleBulkAction(action);
        };
        bar.addEventListener('click', this._onBulkBarClick);
        this.updateBulkBar();
    }

    bindTaskBulkBar() {
        if (this.isArchivedBoard()) return;
        const bar = this.container.querySelector('#sbTaskBulkBar');
        if (!bar) return;

        if (this._onTaskBulkBarClick) {
            bar.removeEventListener('click', this._onTaskBulkBarClick);
            this._onTaskBulkBarClick = null;
        }

        this._onTaskBulkBarClick = (e) => {
            const btn = e.target?.closest?.('button[data-action]');
            const action = btn?.dataset?.action;
            if (!action) return;
            e.preventDefault();
            e.stopPropagation();
            if (action === 'task-bulk-clear') {
                this._clearAllTaskSelections?.();
                return;
            }
            if (action === 'task-bulk-update') {
                this._handleTaskBulkUpdate?.();
                return;
            }
            if (action === 'task-bulk-delete') {
                this._handleBulkDeleteTasks?.();
                return;
            }
        };
        bar.addEventListener('click', this._onTaskBulkBarClick);
        this._updateTaskBulkBar?.();
    }

    _getSelectedNames() {
        // Only keep selections that still exist in the current dataset.
        // This prevents ghost selections after rows are removed from the list (archive/delete/move board).
        const existing = this._projectByName instanceof Map ? this._projectByName : new Map();
        return Array.from(this._selected || []).filter((n) => {
            const name = String(n || '').trim();
            return !!name && existing.has(name);
        });
    }

    _clearSelection() {
        this._selected.clear();
        this.updateSelectAllCheckbox();
        this.updateBulkBar();
        this.scheduleRowsUpdate();
    }

    async _handleBulkAction(action) {
        if (this._bulkWorking) return;
        const names = this._getSelectedNames();
        if (!names.length) return;

        if (action === 'bulk-clear') {
            this._clearSelection();
            return;
        }

        if (this.isArchivedBoard()) {
            if (action === 'bulk-restore') {
                const ok = await confirmDialog(`Restore ${names.length} projects? (Set is_active = Yes)`);
                if (!ok) return;
                await this._restoreProjects(names);
            }
            return;
        }

        if (action === 'bulk-add-task') {
            await this._bulkAddTaskToProjects();
            return;
        }

        if (action === 'bulk-archive') {
            const ok = await confirmDialog(`Archive ${names.length} projects? (Set is_active = No)`);
            if (!ok) return;
            await this._bulkUpdateField({ field: 'is_active', value: 'No', removeFromListIfFiltered: true });
            return;
        }

        if (action === 'bulk-delete') {
            const ok = await confirmDialog(`Delete ${names.length} projects? This will also delete linked tasks. This cannot be undone.`);
            if (!ok) return;
            await this._bulkDelete();
            return;
        }
    }

    async _bulkUpdateField({ field, value, removeFromListIfFiltered } = {}) {
        const names = this._getSelectedNames();
        if (!names.length) return;
        this._bulkWorking = true;
        this.updateBulkBar();
        try {
            // Update backend
            for (const name of names) {
                await ProjectService.updateProject(name, { [field]: value });
            }

            // Update store/UI immediately
            const isActiveFiltered = this.store?.getState?.()?.filters?.is_active !== false;
            for (const name of names) {
                if (field === 'is_active' && removeFromListIfFiltered && isActiveFiltered && String(value) !== 'Yes') {
                    this.store?.commit?.('projects/removeProject', name);
                } else {
                    this.store?.commit?.('projects/updateProject', { name, [field]: value });
                }
            }

            // Keep selection for now (user may want more actions). If rows were removed, clear selection.
            if (field === 'is_active' && removeFromListIfFiltered && this.store?.getState?.()?.filters?.is_active !== false && String(value) !== 'Yes') {
                this._clearSelection();
            } else {
                this.scheduleRowsUpdate();
            }
        } catch (e) {
            console.error(e);
            notify('Bulk update failed', 'red');
        } finally {
            this._bulkWorking = false;
            this.updateBulkBar();
        }
    }

    async _bulkDelete() {
        const names = this._getSelectedNames();
        if (!names.length) return;
        this._bulkWorking = true;
        this.updateBulkBar();
        try {
            for (const name of names) {
                await ProjectService.deleteProject(name);
                this.store?.commit?.('projects/removeProject', name);
            }
            this._clearSelection();
        } catch (e) {
            console.error(e);
            const { getErrorMessage } = await import('../../utils/errorMessage.js');
            notify(getErrorMessage(e) || 'Bulk delete failed', 'red');
        } finally {
            this._bulkWorking = false;
            this.updateBulkBar();
        }
    }

    async _restoreProjects(names = []) {
        const list = Array.isArray(names) ? names.map((x) => String(x || '').trim()).filter(Boolean) : [];
        if (!list.length) return;
        this._bulkWorking = true;
        this.updateBulkBar();
        try {
            for (const name of list) {
                await ProjectService.updateProject(name, { is_active: 'Yes' });
                this.store?.commit?.('projects/removeProject', name);
            }
            this._clearSelection();
            notify(`Restored ${list.length} projects`, 'green');
        } catch (e) {
            console.error(e);
            notify('Restore failed', 'red');
        } finally {
            this._bulkWorking = false;
            this.updateBulkBar();
        }
    }

    async _bulkAddTaskToProjects() {
        const names = this._getSelectedNames();
        if (!names.length) return;
        const subject = String(window.prompt('Task name for selected projects:', 'New Task') || '').trim();
        if (!subject) return;
        this._bulkWorking = true;
        this.updateBulkBar();
        try {
            const r = await TaskService.bulkCreateForProjects(names, { subject });
            const created = Array.isArray(r?.created) ? r.created : [];
            const failed = Array.isArray(r?.failed) ? r.failed : [];
            if (created.length) {
                const byProject = {};
                for (const row of created) {
                    const p = String(row?.project || '').trim();
                    if (!p) continue;
                    byProject[p] = (Number(byProject[p] || 0) || 0) + 1;
                }
                for (const p of Object.keys(byProject)) {
                    const prev = Number(this._taskCounts.get(p) || 0);
                    const next = Math.max(0, prev + Number(byProject[p] || 0));
                    this._taskCounts.set(p, next);
                    const proj = this._projectByName.get(p);
                    if (proj) proj.__sb_task_count = next;
                    this._tasksByProject.delete(p);
                    if (this._expanded.has(p)) await this.ensureTasksLoaded(p);
                }
                notify(`Created ${created.length} tasks`, 'green');
            }
            if (failed.length) {
                notify(`Failed on ${failed.length} projects`, 'orange');
            }
            this.scheduleRowsUpdate();
        } catch (e) {
            console.error(e);
            notify('Bulk add task failed', 'red');
        } finally {
            this._bulkWorking = false;
            this.updateBulkBar();
        }
    }
    
    editCell(cell) {
        const field = cell.dataset.field;
        const projectName = cell.closest('tr').dataset.projectName;
        const project = this.projects.find(p => p.name === projectName);
        
        if (!project) return;
        
        // 根据字段类型显示不同的编辑器
        // TODO: 实现各种字段类型的编辑器
        console.log('Edit cell:', field, project);
    }
    
    handleSort(field) {
        const f = String(field || '').trim();
        if (!f || f.startsWith('__sb_') || f.startsWith('team:')) return;
        const current = this._getSortState();
        const nextOrder = (String(current.field || '') === f && String(current.order || 'asc') === 'asc') ? 'desc' : 'asc';
        this.onSortChange?.({ field: f, order: nextOrder });
    }
    
    handleRowClick(project) {
        console.log('Row clicked:', project);
        this.onRowClick(project);
    }

    openUpdates(project) {
        // Step 7: website-safe modal placeholder (no persistence yet)
        this._updatesModal?.close?.();
        const name = project?.name || '';
        if (name) {
            this._markUpdatesSeen?.(name);
            this.scheduleRowsUpdate();
        }
        this._updatesModal = new UpdatesModal({
            project,
            onPosted: () => {
                if (name) this._bumpUpdateCount?.(name, 1);
            },
            onClose: () => { this._updatesModal = null; }
        });
        this._updatesModal.open();
    }

    openProjectActivity(project) {
        this._projectActivityModal?.close?.();
        this._projectActivityModal = new ProjectActivityModal({
            project,
            onChanged: async () => {
                try {
                    const filters = this.store?.state?.projects?.lastFilters || {};
                    await this.store?.dispatch?.('projects/fetchProjects', filters);
                } catch (e) {}
            },
            onClose: () => { this._projectActivityModal = null; }
        });
        this._projectActivityModal.open();
    }

    openSortDialog() {
        if (!this.isBoardView(this.viewType)) {
            notify('Sort is only available in boards.', 'orange');
            return;
        }
        const state = this._getSortState();
        const options = this._getSortableProjectColumns();
        const modal = new SortModal({
            options,
            initialField: state.field || '',
            initialOrder: state.order || 'asc',
            onApply: async ({ field, order }) => {
                await this.onSortChange?.({ field, order });
            },
            onClear: async () => {
                await this.onSortChange?.({ field: '', order: '' });
            },
        });
        modal.open();
    }

    _getSortableProjectColumns() {
        const visible = Array.isArray(this.columns) ? this.columns : [];
        const items = visible
            .filter((c) => c && c.sortable !== false)
            .filter((c) => {
                const f = String(c?.field || '').trim();
                return f && !f.startsWith('__sb_') && !f.startsWith('team:') && isSortableProjectField(f);
            })
            .map((c) => ({ value: String(c.field || '').trim(), label: String(c.label || c.field || '').trim() }));
        const creationOpt = { value: 'creation', label: 'Created Time' };
        const seen = new Set(items.map((x) => x.value));
        return seen.has('creation') ? items : [creationOpt, ...items];
    }

    _getSortState() {
        const filters = this.store?.getState?.()?.filters || {};
        return {
            field: String(filters?.sort_field || '').trim(),
            order: String(filters?.sort_order || 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc',
        };
    }

    subscribeToStore() {
        if (!this.store) return;
        
        // 订阅store的projects变化
        // 先确保不会重复订阅
        if (this._unsubscribe) {
            try { this._unsubscribe(); } catch (e) {}
            this._unsubscribe = null;
        }

        this._unsubscribe = this.store.subscribe((state) => {
            this.projects = state.projects.items || [];
            // Fast lookup map for editors & actions
            this._projectByName = new Map((this.projects || []).map((p) => [p?.name, p]));
            // Rehydrate computed caches onto freshly loaded project objects.
            // Store updates often replace objects, so without this the project monthly completion may flash as '—'
            // until a later action recomputes it.
            if (this._msSummaryByProject && this._msSummaryByProject.size) {
                for (const p of (this.projects || [])) {
                    const name = p?.name;
                    if (!name) continue;
                    const months = this._msSummaryByProject.get(name);
                    if (months) p.__sb_monthly_completion = months;
                }
            }
            // Row model (future group-by extension point)
            this._rowModel = buildRowModel(this.projects || [], { groupBy: this._groupBy });
            // Task counts are used to render expand toggles (async best-effort).
            this._prefetchTaskCounts?.();
            // Update counts for badge (async best-effort).
            this._prefetchUpdateCounts?.();
            // Monthly completion needs summary data; load in the background (batched).
            if (this._hasProjectMonthlyCompletion?.() && (this.projects || []).length) {
                const names = (this._rowModel?.all?.() || this.projects || []).map((p) => p?.name).filter(Boolean).slice(0, 300);
                this._ensureMonthlyBundle?.(names, { includeTasks: false });
            }
            this.scheduleRowsUpdate();
        });
    }
    
    scheduleRowsUpdate() {
        // Do not rerender rows while editing; it would destroy the editor DOM.
        // EditingManager will commit+close on scroll/outside click.
        if (this._editing?.isEditing?.()) return;
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = null;
            this.updateRows();
        });
    }

    isVirtual() {
        const total = this._rowModel?.count?.() ?? (this.projects || []).length;
        return shouldVirtualize(total, this._virtualThreshold);
    }

    updateRows() {
        const tbody = this.container.querySelector('#tableBody');
        if (!tbody) return;

        // Clear row instances (only for visible rows in virtual mode)
        this.rows = [];

        if (!this.isVirtual()) {
            // If project monthly completion is enabled, prefetch summary for all rows (small table => acceptable)
            if (this._hasProjectMonthlyCompletion?.()) {
                const names = (this._rowModel?.all?.() || this.projects || []).map((p) => p?.name).filter(Boolean);
                this._ensureMonthlyBundle(names, { includeTasks: false });
            }
            // Precompute team role map once per row for derived columns
            (this._rowModel?.all?.() || this.projects || []).forEach((p) => this._prepareProjectDerivedCaches(p));
            tbody.innerHTML = this.renderRows();
            this.updateSelectAllCheckbox();
            this.updateBulkBar();
            this._maybeUpdateRowHeight();
            return;
        }

        // Virtualization viewport = outer scroll container
        const scrollEl = this.container;
        const viewportHeight = scrollEl?.clientHeight || 600;
        const rawScrollTop = scrollEl?.scrollTop || 0;
        // Convert outer scrollTop into a row-area scrollTop (exclude header + wrapper offsets)
        const bodyEl = this.container.querySelector('#boardTableBody');
        const bodyTop = Number(bodyEl?.offsetTop || 0) || 0;
        const scrollTop = Math.max(0, rawScrollTop - bodyTop);
        const total = this._rowModel?.count?.() ?? (this.projects || []).length;

        // Keep virtualization stable even when many rows are expanded:
        // treat each expanded row as adding a fixed extra height (the task subtable is now internally scrollable).
        const expandedHeight = 260; // must match CSS max-height of .sb-task-grid (+ paddings are within the same row)
        const ordered = this._rowModel?.all?.() || this.projects || [];
        const expanded = this._expanded || new Set();
        const expandedIdx = [];
        for (let i = 0; i < ordered.length; i++) {
            const p = ordered[i];
            const name = p?.name;
            if (name && expanded.has(name)) expandedIdx.push(i);
        }
        const countExpandedBefore = (idx) => {
            if (!expandedIdx.length) return 0;
            // expandedIdx is sorted
            let lo = 0, hi = expandedIdx.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (expandedIdx[mid] < idx) lo = mid + 1;
                else hi = mid;
            }
            return lo;
        };
        // Approximate mapping from scrollTop->row index by subtracting expanded heights above.
        let startGuess = Math.floor(scrollTop / Math.max(1, this._rowHeight));
        startGuess = Math.max(0, Math.min(total - 1, startGuess));
        for (let k = 0; k < 3; k++) {
            const above = countExpandedBefore(startGuess);
            const adjusted = scrollTop - above * expandedHeight;
            const nextGuess = Math.floor(adjusted / Math.max(1, this._rowHeight));
            if (nextGuess === startGuess) break;
            startGuess = Math.max(0, Math.min(total - 1, nextGuess));
        }
        const adjustedScrollTop = Math.max(0, scrollTop - countExpandedBefore(startGuess) * expandedHeight);
        const win = computeWindow({
            scrollTop: adjustedScrollTop,
            viewportHeight,
            rowHeight: this._rowHeight,
            total,
            overscan: this._overscan
        });
        const start = win.start;
        const end = win.end;
        const topPad = (start * this._rowHeight) + (countExpandedBefore(start) * expandedHeight);
        const bottomPad = ((total - end) * this._rowHeight) + ((expandedIdx.length - countExpandedBefore(end)) * expandedHeight);

        const slice = this._rowModel?.slice?.(start, end) || this.projects.slice(start, end);
        // In virtual mode, prefetch monthly completion only for visible rows (perf)
        if (this._hasProjectMonthlyCompletion?.()) {
            const names = (slice || []).map((p) => p?.name).filter(Boolean);
            this._ensureMonthlyBundle(names, { includeTasks: false });
        }
        slice.forEach((p) => this._prepareProjectDerivedCaches(p));
        const rowsHtml = renderRows(
            slice,
            this._renderColumns || this.columns,
            (p) => this.handleRowClick(p),
            this.rows,
            {
                isSelected: (p) => this._selected?.has?.(p?.name),
                isExpanded: (p) => this._expanded?.has?.(p?.name),
                expandedRowHTML: (p, cols) => this._renderExpandedTasksRow(p, cols),
            }
        );
        tbody.innerHTML = spacerRow(topPad) + rowsHtml + spacerRow(bottomPad);
        this.updateSelectAllCheckbox();
        this.updateBulkBar();
        this._maybeUpdateRowHeight();
    }

    _prepareProjectDerivedCaches(project) {
        if (!project) return;
        project.__sb_readonly = this.isArchivedBoard();
        const team = project.custom_team_members;

        // Use reference equality as a cheap invalidation
        if (project.__sb_team_ref === team && project.__sb_team_by_role) return;

        const byRole = {};
        if (Array.isArray(team)) {
            for (const m of team) {
                const role = (m?.role || 'Preparer');
                if (!byRole[role]) byRole[role] = [];
                byRole[role].push(m);
            }
        }
        project.__sb_team_ref = team;
        project.__sb_team_by_role = byRole;
    }
    // Task expand / counts / subtable rendering are installed via `boardTableTaskFeatures.js`

    _maybeUpdateRowHeight() {
        // Try to refine row height for virtualization accuracy
        try {
            const tbody = this.container.querySelector('#tableBody');
            const firstRow = tbody?.querySelector('tr.board-table-row');
            if (firstRow) {
                const h = firstRow.getBoundingClientRect().height;
                if (h && h > 10 && h < 200) this._rowHeight = h;
            }
        } catch (e) {}
    }
    
    updateView(viewType) {
        this.viewType = viewType;
        this.columns = this.getColumnsForView(); // immediate fallback
        this.render();
        this.refreshColumnsFromSavedView();
    }

    openColumnManager() {
        if (!this.isBoardView(this.viewType)) {
            notify('Columns 只在 Boards（Project Type）里可用。', 'orange');
            return;
        }
        if (this._openingColMgr) return;
        this._openingColMgr = true;

        TeamRoleService.getRoles()
            .then((roles) => {
                this._teamRoles = roles || [];
                this._openingColMgr = false;
                this._openColumnManagerImpl();
            })
            .catch(() => {
                this._openingColMgr = false;
                this._openColumnManagerImpl();
            });
    }

    _openColumnManagerImpl() {
        // Exclude hidden defs from Columns Manager UI
        const defs = this.getAvailableColumnDefs(false);
        const currentOrder = (this._normalizeSavedColumns(this._savedView?.columns) || [])
            .map(c => c?.field)
            .filter(Boolean);

        const currentSet = new Set((currentOrder.length ? currentOrder : this.columns.map(c => c.field)));

        const baseOrder = currentOrder.length ? currentOrder : this.columns.map(c => c.field);
        const rest = defs.map(d => d.field).filter(f => !baseOrder.includes(f));
        const allOrder = baseOrder.concat(rest);

        const byField = new Map(defs.map(d => [d.field, d]));
        const list = allOrder.map((field) => {
            const def = byField.get(field) || { field, label: field };
            return {
                field,
                label: def.label || field,
                enabled: currentSet.has(field),
            };
        });

        const taskData = this._buildTaskColumnManagerData();
        this._openUnifiedColumnsManager({
            initialTab: 'project',
            projectDefs: defs,
            projectList: list,
            projectByField: byField,
            taskDefs: taskData.defs,
            taskList: taskData.list,
            taskByField: taskData.byField,
        });
    }

    openTaskColumnManager() {
        if (!this.isBoardView(this.viewType)) return;

        const taskData = this._buildTaskColumnManagerData();
        this._openUnifiedColumnsManager({
            initialTab: 'tasks',
            taskDefs: taskData.defs,
            taskList: taskData.list,
            taskByField: taskData.byField,
        });
    }

    _buildTaskColumnManagerData() {
        const defs = [
            { field: 'subject', label: 'Task', width: 320 },
            { field: 'status', label: 'Status', width: 140 },
            { field: 'exp_end_date', label: 'Due', width: 140 },
            { field: 'priority', label: 'Priority', width: 120 },
            // Task team roles (stored in Project Team Member child table on Task)
            { field: 'team:Assigned Person', label: 'Assigned Person', width: 180 },
            { field: 'team:Preparer', label: 'Preparer', width: 160 },
            { field: 'team:Manager', label: 'Manager', width: 160 },
            { field: 'team:Partner', label: 'Partner', width: 160 },
            { field: 'modified', label: 'Updated', width: 160 },
            // Component: expands to 12 months (board fiscal order)
            { field: '__sb_task_monthly_status', label: 'Monthly Task Status (12M)', width: 110 },
        ];

        const currentSet = new Set((this._taskCols || []).map((c) => c.field));
        const baseOrder = (this._taskCols || []).map((c) => c.field);
        const rest = defs.map((d) => d.field).filter((f) => !baseOrder.includes(f));
        const allOrder = baseOrder.concat(rest);
        const byField = new Map(defs.map((d) => [d.field, d]));
        const list = allOrder.map((field) => {
            const def = byField.get(field) || { field, label: field, width: 140 };
            return { field, label: def.label || field, enabled: currentSet.has(field) };
        });
        return { defs, byField, list };
    }

    _openUnifiedColumnsManager({ initialTab = 'project', projectList, projectByField, taskList, taskByField } = {}) {
        const projList = Array.isArray(projectList) ? projectList : [];
        const tList = Array.isArray(taskList) ? taskList : [];
        const byT = taskByField instanceof Map ? taskByField : new Map();

        this._colMgr?.close?.();
        this._colMgr = new ColumnsManagerModal({
            title: `Columns · ${this.viewType}`,
            activeKey: initialTab,
            sections: [
                {
                    key: 'project',
                    label: 'Project Columns',
                    hint: '默认在 Project Columns。勾选显示列，拖拽改变顺序（团队共享默认列）。',
                    columns: projList,
                },
                {
                    key: 'tasks',
                    label: 'Task Columns',
                    hint: 'Task Columns 仅影响展开后的 Tasks 子表。',
                    columns: tList,
                },
            ],
            onSave: async (out) => {
                const enabledProject = (out?.project || []);
                const enabledTasks = (out?.tasks || []);

                const config = enabledProject.map((c) => ({ field: c.field, label: c.label }));
                const nextTask = enabledTasks.map((c) => {
                    const d = byT.get(c.field) || { width: 140 };
                    return { field: c.field, label: c.label, width: d.width || 140 };
                });
                this._taskCols = nextTask;

                const fallbackCols = this.getDefaultColumnConfigForView().map((c) => ({ field: c.field, label: c.label }));
                const view = await ViewService.getOrCreateDefaultView(this.viewType, {
                    fallbackTitle: `${this.viewType} Board`,
                    fallbackColumns: fallbackCols
                });

                if (view?.name) {
                    const next = { project: config, tasks: nextTask };
                    await ViewService.updateView(view.name, { columns: next });
                    this._setSavedViewColumnsInMemory(next);
                }

                this.columns = this.buildColumnsFromConfig(config);
                this.render();

                // Keep sorting in sync with the newly selected first visible project column
                // without requiring a full page refresh.
                const firstProjectColumn = (() => {
                    for (const c of (config || [])) {
                        const f = String(c?.field || '').trim();
                        if (!f) continue;
                        if (f.startsWith('__sb_')) continue;
                        return f;
                    }
                    return 'project_name';
                })();
                try {
                    this.store?.commit?.('projects/setFirstColumnAndResort', firstProjectColumn);
                    this.scheduleRowsUpdate();
                } catch (e) {}
            },
            onClose: () => {}
        });
        this._colMgr.open();
    }

    // Monthly Status menu is installed via `boardTableMonthlyStatusFeatures.js`
    
    saveColumnWidths() {
        const widths = {};
        const headers = this.container.querySelectorAll('th[data-field]');
        
        headers.forEach(th => {
            widths[th.dataset.field] = th.offsetWidth;
        });

        saveColumnWidths(this.viewType, widths);
    }
    
    handleResize() {
        // 处理窗口大小变化
        this._syncHeaderPaddingForScrollbar();
        this._updateBottomScrollbarVisibility();
        this._positionBottomScrollbar();
    }
    
    destroy() {
        if (this._raf) {
            cancelAnimationFrame(this._raf);
            this._raf = null;
        }

        const body = this.container.querySelector('#boardTableBody');
        if (body && this._onScroll) {
            body.removeEventListener('scroll', this._onScroll);
            this._onScroll = null;
        }
        if (body && this._onBodyHScroll) {
            body.removeEventListener('scroll', this._onBodyHScroll);
            this._onBodyHScroll = null;
        }
        const bottom = this.container.querySelector('#sbBottomHScroll');
        if (bottom && this._onBottomHScroll) {
            bottom.removeEventListener('scroll', this._onBottomHScroll);
            this._onBottomHScroll = null;
        }
        const container = this.container?.closest?.('.board-table-container') || this.container;
        if (container && this._onWheelHScroll) {
            container.removeEventListener('wheel', this._onWheelHScroll);
            this._onWheelHScroll = null;
        }

        if (this._unsubscribe) {
            try { this._unsubscribe(); } catch (e) {}
            this._unsubscribe = null;
        }
        this._editing?.destroy?.();
        this._editing = null;
        if (this._onEditFinished) {
            try { this.container?.removeEventListener?.('sb:edit-finished', this._onEditFinished); } catch (e) {}
            this._onEditFinished = null;
        }
        this._updatesModal?.close?.();
        this._updatesModal = null;
        this._projectActivityModal?.close?.();
        this._projectActivityModal = null;
        this._colMgr?.close?.();
        this._colMgr = null;
        this.rows.forEach(row => row.destroy && row.destroy());
        this.rows = [];
        this.container.innerHTML = '';
    }
}

// Install prototype-based task features (keeps this file smaller / more modular).
installBoardTableTaskFeatures(BoardTable);
// Install prototype-based monthly status features.
installBoardTableMonthlyStatusFeatures(BoardTable);
// Install updates badge features.
installBoardTableUpdatesFeatures(BoardTable);

