/**
 * Smart Board - Board Row Component
 * 表格行组件
 */

import { BoardCell } from './BoardCell.js';

export class BoardRow {
    constructor(project, options = {}) {
        this.project = project;
        this.options = options;
        this.columns = options.columns || [];
        this.index = options.index || 0;
        this.onClick = options.onClick || (() => {});
        this.isSelected = options.isSelected || null;
    }
    
    getHTML() {
        const cells = this.columns.map(col => {
            return this.renderCell(col);
        }).join('');

        const selected = this.isSelected ? !!this.isSelected(this.project) : false;

        const rawHighlight = String(this.project.custom_board_row_highlight || '').trim();
        const highlight = /^#[0-9a-fA-F]{3,8}$/.test(rawHighlight) ? rawHighlight : '';
        const highlightClass = highlight ? ' board-table-row--highlight' : '';
        const highlightStyle = highlight ? ` style="--sb-row-hl:${highlight};"` : '';

        return `
            <tr 
                class="board-table-row ${selected ? 'selected' : ''}${highlightClass}" 
                data-project-name="${this.project.name}"
                data-index="${this.index}"
                ${highlightStyle}
            >
                ${cells}
            </tr>
        `;
    }
    
    renderCell(column) {
        // System column: bulk select checkbox
        if (column?.field === '__sb_select') {
            const checked = this.isSelected ? !!this.isSelected(this.project) : false;
            const left = (column.frozen && column._stickyLeft != null) ? ` left:${column._stickyLeft}px;` : '';
            return `
                <td
                    class="board-table-cell ${column.frozen ? 'frozen' : ''} sb-select-col"
                    data-field="__sb_select"
                    style="${left}"
                >
                    <div class="cell-content sb-select-row-wrap">
                        <input type="checkbox" class="sb-row-select" data-project-name="${this.project.name}" ${checked ? 'checked' : ''} aria-label="Select row" />
                    </div>
                </td>
            `;
        }
        const cell = new BoardCell(this.project, column);
        return cell.getHTML();
    }
    
    destroy() {
        // 清理资源
    }
}

