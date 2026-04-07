import { BoardRow } from './BoardRow.js';
import { renderIcon } from '../../utils/iconUtils.js';

function escapeHtml(input) {
  const text = typeof input === 'string' ? input : String(input ?? '');
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function renderColGroup(columns) {
  const cols = Array.isArray(columns) ? columns : [];
  return `
    <colgroup>
      ${cols.map((c) => `<col data-field="${c.field}" style="width:${Number(c.width) || 0}px;" />`).join('')}
    </colgroup>
  `;
}

export function renderHeaderCells(columns, sortState = {}) {
  return columns.map(col => `
    <th 
      class="board-table-cell ${col.frozen ? 'frozen' : ''} ${col.__headerClass || ''} ${col.field === '__sb_select' ? 'sb-select-col' : ''} ${String(sortState?.field || '') === String(col.field || '') ? `is-sorted is-sorted--${escapeHtml(String(sortState?.order || 'asc'))}` : ''}"
      style="${col.frozen && col._stickyLeft != null ? ` left:${col._stickyLeft}px;` : ''}"
      data-field="${col.field}"
    >
      ${col.field === '__sb_select'
        ? `<div class="cell-content sb-select-all-wrap">
             <input type="checkbox" class="sb-select-all" aria-label="Select all rows" />
           </div>`
        : `<div class="cell-content">
            <span class="cell-label">${col.label}</span>
            ${col.field === 'status' ? `<button type="button" class="sb-status-settings-btn" title="Status settings" aria-label="Status settings">
              <span aria-hidden="true">${renderIcon('es-line-settings', 'sm', 'sb-header-icon')}</span>
            </button>` : ''}
            ${col.sortable !== false ? `<span class="sort-icon" aria-hidden="true">${
              String(sortState?.field || '') === String(col.field || '')
                ? renderIcon(String(sortState?.order || 'asc') === 'desc' ? 'es-line-down' : 'es-line-up', 'sm', 'sb-header-icon')
                : ''
            }</span>` : ''}
          </div>
          <div class="resize-handle"></div>`
      }
    </th>
  `).join('');
}

export function renderRows(projects, columns, onRowClick, rowsOut, { isSelected, isExpanded, expandedRowHTML } = {}) {
  if (!projects || projects.length === 0) {
    return '<tr><td colspan="100"><div class="no-data">No projects found</div></td></tr>';
  }
  return projects.map((project, index) => {
    const row = new BoardRow(project, {
      columns,
      index,
      onClick: () => onRowClick(project),
      isSelected: typeof isSelected === 'function' ? isSelected : null,
    });
    rowsOut?.push(row);
    const base = row.getHTML();
    const exp = (typeof isExpanded === 'function' && isExpanded(project)) ? true : false;
    if (exp && typeof expandedRowHTML === 'function') {
      return base + expandedRowHTML(project, columns);
    }
    return base;
  }).join('');
}


