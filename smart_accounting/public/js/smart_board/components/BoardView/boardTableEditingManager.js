/**
 * EditingManager (Step 2)
 * - Centralizes inline editing lifecycle:
 *   - click -> edit
 *   - Enter -> commit
 *   - blur / click outside -> commit
 *   - Esc -> cancel
 *
 * Notes:
 * - Works with current table implementation (tbody innerHTML replaces).
 * - BoardTable should avoid re-rendering rows while editing; on scroll it can force commit+close.
 */
import { columnRegistry } from '../../columns/registry.js';
import { ProjectService } from '../../services/projectService.js';
import { notify } from '../../services/uiAdapter.js';

export class EditingManager {
  constructor({ rootEl, store, getProjectByName, getSelectedProjectNames, bulkEditableFields } = {}) {
    this.rootEl = rootEl;
    this.store = store;
    this.getProjectByName = getProjectByName || (() => null);
    this.getSelectedProjectNames = typeof getSelectedProjectNames === 'function' ? getSelectedProjectNames : (() => []);
    this.bulkEditableFields = Array.isArray(bulkEditableFields) ? bulkEditableFields : [];

    this._active = null; // { cellEl, projectName, field, originalHTML, originalValue }
    this._committing = false;
    this._pendingCommit = false;
    this._onDocMouseDown = null;
    this._editorInstance = null;
    this._pendingStartCell = null;
  }

  isEditing() {
    return !!this._active;
  }

  /**
   * Keep textarea-based note editing stable while user scrolls.
   * If we commit on every container scroll, bottom-row notes close immediately.
   */
  shouldCommitOnScroll() {
    if (!this._active) return true;
    try {
      const input = this._editorInstance?.getInputEl?.() || this._active?.cellEl?.querySelector?.('.sb-inline-editor');
      if (!input) return true;
      const tag = String(input.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA') return false;
    } catch (e) {}
    return true;
  }

  /**
   * Bind event delegation on tbody for click-to-edit.
   * Caller should call this after each table render (since tbody is re-created).
   */
  bindToTbody(tbodyEl) {
    if (!tbodyEl) return;
    if (String(this.rootEl?.dataset?.sbReadonly || '') === '1') return;

    // Click to edit (per requirement)
    tbodyEl.addEventListener('click', (e) => {
      const cell = e.target?.closest?.('td[data-field]');
      if (!cell) return;
      if (!cell.classList.contains('editable')) return;
      // avoid entering edit when clicking inside an existing editor
      if (cell.querySelector('.sb-inline-editor')) return;
      // IMPORTANT: editable click should not also trigger row click (open details mock).
      e.preventDefault();
      e.stopPropagation();
      this.startEdit(cell);
    });
  }

  /**
   * Force commit+close when table is about to change DOM (e.g. scroll virtualization).
   * This keeps the system stable and avoids "editor disappears without saving".
   */
  async commitAndClose(reason = 'unknown') {
    if (!this._active) return;
    try {
      await this.commit(reason);
    } finally {
      this.closeEditor({ restore: false });
      // Notify host that editing finished so it can safely rerender.
      try {
        this.rootEl?.dispatchEvent?.(new CustomEvent('sb:edit-finished', { detail: { reason } }));
      } catch (e) {}
      const nextCell = this._pendingStartCell;
      this._pendingStartCell = null;
      if (nextCell && nextCell.isConnected) {
        this.startEdit(nextCell);
      }
    }
  }

  startEdit(cellEl) {
    if (!cellEl) return;

    // If editing another cell, commit first (requirement: click elsewhere saves)
    if (this._active && this._active.cellEl !== cellEl) {
      this._pendingStartCell = cellEl;
      this.commitAndClose('switch-cell');
      return;
    }
    if (this._active && this._active.cellEl === cellEl) {
      return;
    }

    const row = cellEl.closest('tr');
    const field = cellEl.dataset.field;
    const projectName = row?.dataset?.projectName;
    if (!field || !projectName) return;

    const project = this.getProjectByName(projectName);
    if (!project) return;

    // Save original cell HTML so Esc can revert without needing full rerender.
    const content = cellEl.querySelector('.cell-content') || cellEl;
    const originalHTML = content.innerHTML;
    const originalValue = project[field];

    this._active = { cellEl, projectName, field, originalHTML, originalValue };
    this._editorInstance = null;
    cellEl.classList.add('sb-cell-editing');

    // Install doc listener to detect click-outside -> commit
    this._installDocOutsideHandler();

    // Try registry-provided editor; else use default editor.
    const spec = columnRegistry.getSpec(field);
    const editor = spec?.renderEditor;
    if (typeof editor === 'function') {
      // editor should mount itself and call manager.commit/cancel accordingly in future steps.
      // For now, if a custom editor exists, we still mount it but provide minimal ctx.
      try {
        const out = editor({ cellEl, project, column: { field }, manager: this, field });
        // If the editor did not call bindActiveEditor, bind by searching a standard input.
        if (!this._editorInstance) {
          const contentEl2 = cellEl.querySelector('.cell-content') || cellEl;
          const input2 = contentEl2.querySelector('.sb-inline-editor');
          if (input2) this.bindActiveEditor(input2, null);
        }
        return out;
      } catch (e) {
        // fall back to default editor
      }
    }

    this._mountDefaultEditor({ cellEl, field, project });
  }

  /**
   * Allow custom editors to register their primary input element so manager can bind lifecycle.
   * @param {HTMLElement|null} inputEl
   * @param {any|null} editorInstance
   */
  bindActiveEditor(inputEl, editorInstance = null) {
    if (!this._active) return;
    this._editorInstance = editorInstance || null;
    if (!inputEl) return;

    // Prevent duplicate binding on the same element.
    if (inputEl.__sbBound) return;
    inputEl.__sbBound = true;

    // Keydown
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        // For textarea, allow Shift+Enter to insert newline.
        if (inputEl.tagName === 'TEXTAREA' && e.shiftKey) return;
        e.preventDefault();
        this.commitAndClose('enter');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      }
    });

    // blur saves (per requirement), except menu-like editors that handle close explicitly.
    if (!editorInstance?.disableBlurCommit) {
      inputEl.addEventListener('blur', () => {
        if (!this._active) return;
        this.commitAndClose('blur');
      });
    }
  }

  _mountDefaultEditor({ cellEl, field, project }) {
    const content = cellEl.querySelector('.cell-content') || cellEl;
    const val = project?.[field];

    // Replace content with a simple text input (generic skeleton).
    content.innerHTML = `
      <input class="form-control sb-inline-editor" type="text" />
    `;
    const input = content.querySelector('input.sb-inline-editor');
    if (!input) return;

    input.value = (val == null) ? '' : String(val);
    // Focus next tick to ensure it's in DOM.
    setTimeout(() => {
      try { input.focus(); input.select?.(); } catch (e) {}
    }, 0);

    this.bindActiveEditor(input, null);
  }

  async commit(reason = 'unknown') {
    if (!this._active) return;
    if (this._committing) {
      this._pendingCommit = true;
      return;
    }
    this._committing = true;

    try {
      const { cellEl, projectName, field } = this._active;
      const project = this.getProjectByName(projectName);
      if (!project) return;

      const content = cellEl.querySelector('.cell-content') || cellEl;
      const input = content.querySelector('.sb-inline-editor');

      // Resolve value:
      // - Prefer editorInstance.getValue() for complex editors (LinkInput, multi-select, etc.)
      // - Fallback to native input/select/textarea `.value`
      let value = null;
      if (this._editorInstance && typeof this._editorInstance.getValue === 'function') {
        value = this._editorInstance.getValue();
      } else if (input && 'value' in input) {
        value = input.value;
      } else {
        // If no value can be extracted, do nothing (custom editor not wired yet).
        return;
      }

      const spec = columnRegistry.getSpec(field);
      // Store for closeEditor optimistic paint
      this._active._committedValue = value;
      // No-op: if unchanged, just restore (avoid extra store churn)
      // IMPORTANT: for custom commit columns (e.g., team:role), project[field] may be undefined.
      if (!(spec && typeof spec.commit === 'function')) {
        const oldVal = project?.[field];
        if ((oldVal == null ? '' : String(oldVal)) === (value == null ? '' : String(value))) {
          return;
        }
      }

      // Default commit path: projects/updateProjectField (uses frappe.client.set_value)
      // Optional confirm hook for some columns (e.g. Lodgement Due)
      const selected = (this.getSelectedProjectNames?.() || []).filter(Boolean);
      const allowAll = !Array.isArray(this.bulkEditableFields) || this.bulkEditableFields.length === 0;
      const isBulkField = allowAll ? true : this.bulkEditableFields.includes(field);
      const doBulk = isBulkField && selected.length > 1 && selected.includes(projectName);

      try {
        const confirmFn = spec?.confirmCommit;
        if (typeof confirmFn === 'function') {
          // Confirm once for bulk operations (avoid N dialogs).
          const ok = await confirmFn({ project, field, value, reason, isBulk: doBulk, bulkCount: selected.length });
          if (!ok) return;
        }
      } catch (e) {}

      // Bulk inline sync (Monday-like): apply same value to all selected rows.
      // Safety gates:
      // - if bulkEditableFields is empty => treat as "all fields"
      // - only when the edited row is itself selected
      // - skip explicitly opted-out fields (spec.bulkSync === false)
      if (doBulk) {
        if (spec?.bulkSync === false) {
          // Explicitly opted out (e.g. attachments / unique per-row fields)
        } else {
          // If the column defines a custom commit (child tables / derived fields),
          // run it once per selected project so semantics stay correct.
          if (spec && typeof spec.commit === 'function') {
            // Fast-path: if spec provides commitBulk, use ONE request.
            if (typeof spec.commitBulk === 'function') {
              await spec.commitBulk({ projects: selected, projectName, project, field, value, reason, store: this.store });
              notify(`Updated ${selected.length} projects`, 'green');
              return;
            }
            // Fallback: call commit once per project
            for (const name of selected) {
              const p2 = this.getProjectByName(name);
              if (!p2) continue;
              await spec.commit({ project: p2, projectName: name, field, value, reason, store: this.store });
            }
            notify(`Updated ${selected.length} projects`, 'green');
            return;
          }

          // Simple field: one request bulk update
          await ProjectService.bulkSetProjectField(selected, field, value);
          for (const name of selected) {
            this.store?.commit?.('projects/updateProject', { name, [field]: value });
          }
          notify(`Updated ${selected.length} projects`, 'green');
          return;
        }
      }

      // Allow per-column custom commit (complex fields / derived columns).
      // If not provided, fall back to store action (frappe.client.set_value).
      if (spec && typeof spec.commit === 'function') {
        await spec.commit({ project, projectName, field, value, reason, store: this.store, editor: this._editorInstance });
        return;
      }

      // Dedup guard: prevent the exact same save from firing twice in quick succession.
      // This protects against menu-select + blur/menu-close race conditions that can
      // produce two identical API calls within the same user interaction.
      const dedupKey = `${projectName}:${field}:${value}`;
      if (this._lastCommitKey === dedupKey && Date.now() - (this._lastCommitTime || 0) < 2000) {
        return;
      }
      this._lastCommitKey = dedupKey;
      this._lastCommitTime = Date.now();

      if (this.store?.dispatch) {
        await this.store.dispatch('projects/updateProjectField', { name: projectName, field, value });
      }
    } finally {
      this._committing = false;
      if (this._pendingCommit) {
        this._pendingCommit = false;
        setTimeout(() => this.commit('pending'), 0);
      }
    }
  }

  cancel() {
    if (!this._active) return;
    const { cellEl, originalHTML } = this._active;
    const content = cellEl.querySelector('.cell-content') || cellEl;
    content.innerHTML = originalHTML;
    cellEl.classList.remove('sb-cell-editing');
    // Destroy any active editor instance (portal/listeners cleanup)
    try { this._editorInstance?.destroy?.(); } catch (e) {}
    this._active = null;
    this._editorInstance = null;
    this._removeDocOutsideHandler();
    try {
      this.rootEl?.dispatchEvent?.(new CustomEvent('sb:edit-finished', { detail: { reason: 'cancel' } }));
    } catch (e) {}
  }

  closeEditor({ restore = true } = {}) {
    // After commit we rely on store update + renderRows to refresh UI.
    if (!this._active) return;
    const { cellEl, originalHTML } = this._active;
    const content = cellEl.querySelector('.cell-content') || cellEl;
    if (content.querySelector('.sb-inline-editor')) {
      if (restore) {
        content.innerHTML = originalHTML;
      } else {
        // Optimistic paint: show committed value quickly (real formatted UI will appear on rerender)
        const v = this._active?._committedValue;
        content.textContent = v == null ? '' : String(v);
      }
    }
    // Always destroy editor instance (portal/listeners cleanup)
    try { this._editorInstance?.destroy?.(); } catch (e) {}
    cellEl.classList.remove('sb-cell-editing');
    this._active = null;
    this._editorInstance = null;
    this._removeDocOutsideHandler();
  }

  _installDocOutsideHandler() {
    if (this._onDocMouseDown) return;
    this._onDocMouseDown = (e) => {
      if (!this._active) return;
      const cell = this._active.cellEl;
      // Click inside editor portal (dropdowns rendered to body) should NOT trigger outside-click commit.
      if (e?.target?.closest?.('[data-sb-editor-portal=\"1\"]')) return;
      // Click inside current cell/editor: ignore
      if (cell && cell.contains(e.target)) return;
      // Otherwise commit+close
      this.commitAndClose('outside-click');
    };
    document.addEventListener('mousedown', this._onDocMouseDown, true);
  }

  _removeDocOutsideHandler() {
    if (!this._onDocMouseDown) return;
    document.removeEventListener('mousedown', this._onDocMouseDown, true);
    this._onDocMouseDown = null;
  }

  destroy() {
    try {
      this.cancel();
    } catch (e) {}
    this._removeDocOutsideHandler();
    this.rootEl = null;
    this.store = null;
    this.getProjectByName = null;
    this._editorInstance = null;
  }
}


