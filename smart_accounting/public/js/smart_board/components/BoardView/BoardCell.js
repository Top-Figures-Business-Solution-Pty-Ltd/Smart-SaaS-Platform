/**
 * Smart Board - Board Cell Component
 * 表格单元格组件
 */

import { formatDate, getStatusColor } from '../../utils/helpers.js';
import { columnRegistry } from '../../columns/registry.js';
import { getUserInitials } from '../../utils/userInitials.js';

export class BoardCell {
    constructor(project, column) {
        this.project = project;
        this.column = column;
    }
    
    getHTML() {
        // Virtual/computed columns (non-doctype fields)
        if (this.column?.__msKind === 'project_completion') {
            const mi = Number(this.column.__monthIndex || 0);
            const months = this.project?.__sb_monthly_completion || {};
            const m = months?.[mi] || months?.[String(mi)];
            const done = Number(m?.done || 0);
            const workingOnIt = Number(m?.working_on_it || 0);
            const stuck = Number(m?.stuck || 0);
            const total = Number(m?.total || 0);
            const percent = Number.isFinite(Number(m?.percent)) ? Number(m.percent) : (total ? (done / total * 100) : 0);
            const pct = Math.max(0, Math.min(100, Number(percent) || 0));
            const donePct = total ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
            const workingPct = total ? Math.max(0, Math.min(100, (workingOnIt / total) * 100)) : 0;
            const stuckPct = total ? Math.max(0, Math.min(100, (stuck / total) * 100)) : 0;
            const accountedPct = Math.max(0, Math.min(100, donePct + workingPct + stuckPct));
            const emptyPct = Math.max(0, Math.min(100, 100 - accountedPct));
            const text = total ? `${done}/${total}` : '—';
            const tip = total
                ? `Done ${done}/${total}, Working On It ${workingOnIt}, Stuck ${stuck}, Done ${pct.toFixed(1)}%`
                : 'No tasks';
            const left = (this.column.frozen && this.column._stickyLeft != null) ? ` left: ${this.column._stickyLeft}px;` : '';
            const extraClass = columnRegistry.getCellClass({ project: this.project, column: this.column });
            const staticClass = this.column.__cellClass || '';
            return `
                <td
                    class="board-table-cell ${this.column.frozen ? 'frozen' : ''} ${staticClass} ${extraClass} sb-ms-sum"
                    data-field="${this.column.field}"
                    title="${tip}"
                    style="${left}"
                >
                    <div class="cell-content sb-ms-sum__cell" data-done="${done}" data-total="${total}" data-percent="${pct.toFixed(1)}">
                      <span class="sb-ms-sum__bar" data-progress="${this.escapeHtml(text)}">
                        <span class="sb-ms-sum__seg sb-ms-sum__seg--done" style="width:${donePct.toFixed(1)}%"></span>
                        <span class="sb-ms-sum__seg sb-ms-sum__seg--working" style="width:${workingPct.toFixed(1)}%"></span>
                        <span class="sb-ms-sum__seg sb-ms-sum__seg--stuck" style="width:${stuckPct.toFixed(1)}%"></span>
                        <span class="sb-ms-sum__seg sb-ms-sum__seg--empty" style="width:${emptyPct.toFixed(1)}%"></span>
                      </span>
                    </div>
                </td>
            `;
        }

        const value = this.project[this.column.field];
        // Column Registry override (non-invasive): if no override, fall back to legacy formatter.
        const override = columnRegistry.renderCell({ project: this.project, column: this.column });
        const formattedValue = override != null ? override : this.formatValue(value);
        const isEditable = this.isEditableField();
        const extraClass = columnRegistry.getCellClass({ project: this.project, column: this.column });
        const staticClass = this.column.__cellClass || '';
        const left = (this.column.frozen && this.column._stickyLeft != null) ? ` left: ${this.column._stickyLeft}px;` : '';

        // Task expander lives in the primary (first) user-selected column, NOT in the checkbox column
        let cellInnerHTML = `
                <div class="cell-content">
                    ${formattedValue}
                </div>
        `;
        if (this.column.__isPrimary) {
            const taskCount = Number(this.project?.__sb_task_count || 0);
            const expanded = !!this.project?.__sb_expanded;
            const pn = this.escapeHtml(this.project?.name || '');
            const isArchivedView = !!this.project?.__sb_readonly;
            const isEmpty = taskCount <= 0;
            const expandTitle = expanded ? 'Collapse tasks' : (isEmpty ? 'Show tasks (no tasks yet)' : 'Expand tasks');
            const updCount = Number(this.project?.__sb_update_count || 0);
            const isHot = !!this.project?.__sb_update_hot;
            const expander = `
                <button
                    type="button"
                    class="sb-expand-btn ${isEmpty ? 'sb-expand-btn--empty' : ''} ${expanded ? 'sb-expand-btn--open' : ''}"
                    data-project-name="${pn}"
                    aria-label="${expandTitle}"
                    title="${expandTitle}"
                >▸</button>
            `;
            const updatesBtn = `
                <button type="button" class="sb-update-btn" data-project-name="${pn}" aria-label="Open updates" title="Updates">
                    💬
                    ${updCount > 0 ? `<span class="sb-update-badge ${isHot ? 'sb-update-badge--hot' : 'sb-update-badge--quiet'}">${updCount > 99 ? '99+' : updCount}</span>` : ''}
                </button>
            `;
            const restoreBtn = isArchivedView
                ? `<button type="button" class="sb-restore-btn btn btn-default btn-xs" data-project-name="${pn}" title="Restore project">Restore</button>`
                : '';
            cellInnerHTML = `
                <div class="cell-content sb-primary-cell">
                    <div class="sb-primary-left">
                        ${expander}
                        ${formattedValue}
                        ${updatesBtn}
                        ${restoreBtn}
                    </div>
                </div>
            `;
        }
        
        return `
            <td 
                class="board-table-cell ${this.column.frozen ? 'frozen' : ''} ${isEditable ? 'editable' : ''} ${staticClass} ${extraClass}"
                data-field="${this.column.field}"
                style="${left}"
            >
                ${cellInnerHTML}
            </td>
        `;
    }
    
    formatValue(value) {
        const field = this.column.field;

        // Derived column: team:<Role>
        if (typeof field === 'string' && field.startsWith('team:')) {
            const role = field.slice('team:'.length);
            return this.formatTeamByRole(role);
        }
        
        // 空值处理
        if (value === null || value === undefined || value === '') {
            return '<span class="text-muted">—</span>';
        }
        
        // 根据字段类型格式化
        switch (field) {
            case 'status':
                return this.formatStatus(value);
            
            case 'custom_team_members':
                return this.formatTeam(value);
            
            case 'custom_lodgement_due_date':
            case 'custom_reset_date':
            case 'custom_portal_access_expiry_date':
            case 'expected_end_date':
            case 'expected_start_date':
                return this.formatDate(value);
            
            case 'custom_softwares':
                return this.formatSoftwares(value);
            
            case 'priority':
                return this.formatPriority(value);

            case 'is_active':
                return this.formatActive(value);

            case 'modified':
                return this.formatDate(value);


            case 'company':
                return this.formatCompany(value);
            
            case 'custom_entity_type':
                return this.formatEntity(value);

            case 'custom_fiscal_year':
                return this.formatFiscalYear(value);
            
            case 'estimated_costing':
                return this.formatCurrency(value);
            
            case 'notes':
                return this.formatNotes(value);
            
            default:
                return this.escapeHtml(value);
        }
    }
    
    formatStatus(status) {
        const color = getStatusColor(status);
        return `
            <span class="status-badge" style="background-color: ${color};">
                ${this.escapeHtml(status)}
            </span>
        `;
    }
    
    formatTeam(teamMembers) {
        if (!teamMembers || !teamMembers.length) {
            return '<span class="text-muted">—</span>';
        }
        
        // 显示头像和名字
        const avatars = teamMembers.slice(0, 3).map(member => {
            const fullName = String(member?.user_full_name || '').trim();
            const fallbackName = this.extractName(member?.user);
            const title = fullName || fallbackName || String(member?.user || '');
            const initial = getUserInitials({ fullName, user: fallbackName }) || (fallbackName || 'U').charAt(0).toUpperCase();
            const img = member?.user_image || '';
            if (img) {
                return `<img class="user-avatar user-avatar--img" src="${this.escapeHtml(img)}" title="${this.escapeHtml(title)}" alt="" />`;
            }
            return `<span class="user-avatar" title="${this.escapeHtml(title)}">${this.escapeHtml(initial)}</span>`;
        }).join('');
        
        const moreCount = teamMembers.length - 3;
        const moreText = moreCount > 0 ? `<span class="more-count">+${moreCount}</span>` : '';
        
        return `<div class="team-avatars">${avatars}${moreText}</div>`;
    }

    formatTeamByRole(role) {
        const all = this.project?.custom_team_members || [];
        // Prefer pre-aggregated cache from BoardTable (performance)
        const byRole = this.project?.__sb_team_by_role;
        const members = (byRole && byRole[role]) ? byRole[role] : all.filter((m) => (m?.role || '') === role);
        return this.formatTeam(members);
    }
    
    formatDate(date) {
        return formatDate(date);
    }
    
    formatSoftwares(softwares) {
        if (!softwares || !softwares.length) {
            return '<span class="text-muted">—</span>';
        }
        
        if (Array.isArray(softwares)) {
            return softwares.map(s => s?.software_name || s?.software || s).join(', ');
        }
        
        return this.escapeHtml(softwares);
    }

    formatPriority(priority) {
        // Keep it simple for now; later we can map to colors.
        return this.escapeHtml(priority);
    }

    formatActive(isActive) {
        const v = (typeof isActive === 'string') ? isActive : String(isActive);
        const yes = v === 'Yes' || v === '1' || v.toLowerCase?.() === 'yes' || v.toLowerCase?.() === 'true';
        const text = yes ? 'Yes' : 'No';
        const cls = yes ? 'company-badge company-tg' : 'company-badge company-tf';
        return `<span class="${cls}">${text}</span>`;
    }
    
    formatCompany(company) {
        const text = String(company || '').trim();
        const companyBadges = [
            { abbr: 'TF', className: 'company-tf', aliases: ['TF', 'Top Figures'] },
            { abbr: 'TG', className: 'company-tg', aliases: ['TG', 'Top Grants'] },
            { abbr: 'VT', className: 'company-vt', aliases: ['VT', 'VERITAX PARTNERS', 'Veritax Partners'] },
        ];

        const match = companyBadges.find(({ aliases }) => aliases.some((alias) => text.includes(alias)));
        if (match) {
            return `<span class="company-badge ${match.className}" title="${this.escapeHtml(text)}">${match.abbr}</span>`;
        }
        return this.escapeHtml(text);
    }
    
    formatEntity(entity) {
        if (!entity) return '<span class="text-muted">—</span>';
        
        // 提取简短标识
        // 例如："Client A Pty Ltd" -> "Pty Ltd"
        const parts = entity.split(' ');
        if (parts.length > 2) {
            return this.escapeHtml(parts.slice(-2).join(' '));
        }
        return this.escapeHtml(entity);
    }

    formatFiscalYear(fiscalYear) {
        if (!fiscalYear) return '<span class="text-muted">—</span>';
        const palettes = [
            { bg: '#eef2ff', bd: '#c7d2fe', fg: '#3730a3' },
            { bg: '#ecfeff', bd: '#a5f3fc', fg: '#155e75' },
            { bg: '#ecfdf5', bd: '#a7f3d0', fg: '#065f46' },
            { bg: '#fffbeb', bd: '#fde68a', fg: '#92400e' },
            { bg: '#fff1f2', bd: '#fecdd3', fg: '#9f1239' },
            { bg: '#f5f3ff', bd: '#ddd6fe', fg: '#5b21b6' },
            { bg: '#eff6ff', bd: '#bfdbfe', fg: '#1e40af' },
            { bg: '#f0fdf4', bd: '#bbf7d0', fg: '#166534' },
        ];
        const text = String(fiscalYear || '');
        // Prefer year-based deterministic mapping so adjacent fiscal years render in distinct colors.
        // Example: 2024-2025 / 2025-2026 should not collapse to the same color.
        const m = text.match(/(\d{4})/);
        let idx = -1;
        if (m && m[1]) {
            const y = Number(m[1]);
            if (Number.isFinite(y)) idx = Math.abs(y) % palettes.length;
        }
        if (idx < 0) {
            let hash = 0;
            for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
            idx = Math.abs(hash) % palettes.length;
        }
        const c = palettes[idx];
        return `<span class="sb-fy-badge" style="background:${c.bg};border-color:${c.bd};color:${c.fg};">${this.escapeHtml(fiscalYear)}</span>`;
    }
    
    formatCurrency(amount) {
        if (!amount) return '<span class="text-muted">—</span>';
        return `$${Number(amount).toLocaleString('en-AU')}`;
    }
    
    formatNotes(notes) {
        if (!notes) return '<span class="text-muted">—</span>';
        
        // 截断长文本
        const maxLength = 100;
        if (notes.length > maxLength) {
            return `<span title="${this.escapeHtml(notes)}">${this.escapeHtml(notes.substring(0, maxLength))}...</span>`;
        }
        return this.escapeHtml(notes);
    }
    
    extractName(email) {
        if (!email) return '';
        const name = email.split('@')[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
    }
    
    escapeHtml(text) {
        if (typeof text !== 'string') {
            text = String(text);
        }
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    isEditableField() {
        const field = this.column?.field;
        const spec = columnRegistry.getSpec(field);

        // Spec-driven editable flag (preferred)
        if (spec && spec.isEditable !== undefined) {
            if (typeof spec.isEditable === 'function') {
                try { return !!spec.isEditable({ project: this.project, column: this.column }); } catch (e) { return false; }
            }
            return !!spec.isEditable;
        }

        // Legacy fallback (keep current behavior unless spec overrides)
        if (this.project?.__sb_readonly) return false;
        const nonEditableFields = ['customer', 'project_name', 'company'];
        return !nonEditableFields.includes(field);
    }
}

