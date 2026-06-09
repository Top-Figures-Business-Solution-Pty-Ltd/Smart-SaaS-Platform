/**
 * RollOverModal (Website-safe)
 * - Bulk "Roll Over / Duplicate" of selected projects.
 * - User picks the target board (this board or another), optionally types a new
 *   FY/CY, and ticks which column values to carry over. Project-level progress is
 *   off by default; status resets to the board default.
 * - Resolves a selection object via onConfirm:
 *     { targetBoard, carryFields: string[], overrides: {}, nameSuffix }
 */
import { Modal } from '../Common/Modal.js';
import { escapeHtml } from '../../utils/dom.js';

export class RollOverModal {
  constructor({
    count = 0,
    config = {},
    currentBoard = '',
    defaultTargetBoard = '',
    onConfirm,
    onClose,
  } = {}) {
    this.count = Number(count) || 0;
    this.config = config || {};
    this.currentBoard = String(currentBoard || '').trim();
    this.defaultTargetBoard = String(defaultTargetBoard || '').trim();
    this.onConfirm = typeof onConfirm === 'function' ? onConfirm : (async () => {});
    this.onClose = typeof onClose === 'function' ? onClose : (() => {});

    this._modal = null;
    this._root = null;
    this._submitting = false;
  }

  async open() {
    this.close();

    const cfg = this.config || {};
    const boards = Array.isArray(cfg.yearBoards) ? cfg.yearBoards : [];
    const allowSame = cfg.allowSameBoard !== false;
    const defaultMode = cfg.defaultTargetMode === 'same' ? 'same' : 'other';
    const locked = Array.isArray(cfg.lockedCarry) ? cfg.lockedCarry : [];
    const options = Array.isArray(cfg.carryOptions) ? cfg.carryOptions : [];

    const boardOptions = boards.map((b) => {
      const sel = b === this.defaultTargetBoard ? ' selected' : '';
      return `<option value="${escapeHtml(b)}"${sel}>${escapeHtml(b)}</option>`;
    }).join('');

    const lockedHtml = locked.map((o) => `
      <div class="sb-ro__row sb-ro__row--locked">
        <span class="sb-ro__name">${escapeHtml(o.label || o.field)}</span>
        <span class="text-muted" style="font-size:12px;">${escapeHtml(o.note || 'Carry (always)')}</span>
      </div>`).join('');

    const canSetOf = (o) => o.changeable !== false && String(o.type || 'data') !== 'none';

    // Build the "set" value editor for a field based on its real DocType fieldtype.
    const setInput = (o) => {
      const f = escapeHtml(o.field);
      const t = String(o.type || 'data');
      if (!canSetOf(o)) {
        // Non-editable (child table / read-only / computed): no value box.
        return '<span class="text-muted sb-ro__noset">—</span>';
      }
      if (t === 'date') {
        return `<input type="date" class="form-control input-sm sb-ro__val" data-field="${f}" disabled />`;
      }
      if (t === 'number') {
        return `<input type="number" step="any" class="form-control input-sm sb-ro__val" data-field="${f}" placeholder="New value" disabled />`;
      }
      if (t === 'check') {
        return `<select class="form-control input-sm sb-ro__val" data-field="${f}" disabled>
          <option value="1">Yes</option>
          <option value="0">No</option>
        </select>`;
      }
      if (t === 'select') {
        const opts = (Array.isArray(o.options) ? o.options : [])
          .map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
        return `<select class="form-control input-sm sb-ro__val" data-field="${f}" disabled>
          <option value="">—</option>${opts}</select>`;
      }
      return `<input type="text" class="form-control input-sm sb-ro__val" data-field="${f}" placeholder="New value" disabled />`;
    };

    const modeRadios = (o) => {
      const f = escapeHtml(o.field);
      const m = String(o.mode || 'carry');
      const canSet = canSetOf(o);
      const advanceRadio = o.advance
        ? `<label class="sb-ro__mode"><input type="radio" name="sbRoMode_${f}" class="sb-ro__modesel" data-field="${f}" value="advance" ${m === 'advance' ? 'checked' : ''}/><span>Next year (+1)</span></label>`
        : '';
      return `
        ${advanceRadio}
        <label class="sb-ro__mode"><input type="radio" name="sbRoMode_${f}" class="sb-ro__modesel" data-field="${f}" value="carry" ${m === 'carry' ? 'checked' : ''}/><span>Carry</span></label>
        <label class="sb-ro__mode"><input type="radio" name="sbRoMode_${f}" class="sb-ro__modesel" data-field="${f}" value="clear" ${m === 'clear' ? 'checked' : ''}/><span>Clear</span></label>
        <label class="sb-ro__mode${canSet ? '' : ' sb-ro__mode--disabled'}" title="${canSet ? '' : 'This field can\\'t be set to a new value here'}"><input type="radio" name="sbRoMode_${f}" class="sb-ro__modesel" data-field="${f}" value="set" ${(m === 'set' && canSet) ? 'checked' : ''} ${canSet ? '' : 'disabled'}/><span>Set</span></label>
      `;
    };

    const rowsHtml = options.map((o) => `
      <div class="sb-ro__row">
        <span class="sb-ro__name">${escapeHtml(o.label || o.field)}</span>
        <span class="sb-ro__modes">${modeRadios(o)}</span>
        <span class="sb-ro__set">${setInput(o)}</span>
      </div>`).join('');

    const content = document.createElement('div');
    content.innerHTML = `
      <div class="sb-ro">
        <div class="text-muted" style="font-size:13px; margin-bottom:12px;">
          Create ${this.count} new project${this.count === 1 ? '' : 's'} from the selected one${this.count === 1 ? '' : 's'}.
          Status resets to <b>${escapeHtml(cfg.resetStatus || 'Not started')}</b>; the new name keeps the original plus an auto tag (board / fiscal year).
        </div>

        <div class="sb-ro__section">
          <div class="sb-ro__label">Target board</div>
          <div class="sb-ro__targets">
            <label class="sb-ro__radio">
              <input type="radio" name="sbRoTarget" value="other" ${defaultMode === 'other' ? 'checked' : ''} />
              <span>Another board</span>
            </label>
            ${allowSame ? `
            <label class="sb-ro__radio">
              <input type="radio" name="sbRoTarget" value="same" ${defaultMode === 'same' ? 'checked' : ''} />
              <span>Same board (${escapeHtml(this.currentBoard || '—')})</span>
            </label>` : ''}
          </div>
          <select class="form-control" id="sbRoBoard" style="margin-top:8px; max-width:260px; ${defaultMode === 'same' ? 'display:none;' : ''}">
            ${boardOptions}
          </select>
        </div>

        <div class="sb-ro__section">
          <div class="sb-ro__label" style="display:flex; align-items:center; justify-content:space-between;">
            <span>For each field — Carry / Clear / Set a new value</span>
            <span>
              <button type="button" class="btn btn-link btn-sm sb-ro__all" data-all="carry" style="padding:0 6px;">All carry</button>
              <button type="button" class="btn btn-link btn-sm sb-ro__all" data-all="clear" style="padding:0 6px;">All clear</button>
            </span>
          </div>
          <div class="sb-ro__rows">
            ${lockedHtml}
            ${rowsHtml}
          </div>
        </div>

        <div class="sb-newproj__error text-danger" id="sbRoErr" style="display:none; margin-top:10px;"></div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';
    footer.innerHTML = `
      <button class="btn btn-default" type="button" id="sbRoCancel">Cancel</button>
      <button class="btn btn-primary" type="button" id="sbRoConfirm">Roll Over</button>
    `;

    this._modal = new Modal({
      title: 'Roll Over / Duplicate',
      contentEl: content,
      footerEl: footer,
      onClose: () => this.onClose(),
    });
    this._modal.open();
    this._root = content;

    const boardSel = content.querySelector('#sbRoBoard');
    content.querySelectorAll('input[name="sbRoTarget"]').forEach((r) => {
      r.addEventListener('change', () => {
        const mode = content.querySelector('input[name="sbRoTarget"]:checked')?.value || 'other';
        if (boardSel) boardSel.style.display = mode === 'same' ? 'none' : '';
      });
    });

    // Enable/disable each field's "set" editor as its mode changes.
    const syncValInput = (field) => {
      const mode = content.querySelector(`.sb-ro__modesel[data-field="${field}"]:checked`)?.value || 'carry';
      const input = content.querySelector(`.sb-ro__val[data-field="${field}"]`);
      if (input) {
        input.disabled = mode !== 'set';
        if (mode === 'set') input.focus?.();
      }
    };
    content.querySelectorAll('.sb-ro__modesel').forEach((r) => {
      r.addEventListener('change', () => syncValInput(r.dataset.field));
    });
    // Initial sync (default modes).
    content.querySelectorAll('.sb-ro__val').forEach((inp) => syncValInput(inp.dataset.field));

    content.querySelectorAll('.sb-ro__all').forEach((btn) => {
      btn.addEventListener('click', () => {
        const want = btn.dataset.all; // 'carry' | 'clear'
        content.querySelectorAll(`.sb-ro__modesel[value="${want}"]`).forEach((r) => { r.checked = true; });
        content.querySelectorAll('.sb-ro__val').forEach((inp) => syncValInput(inp.dataset.field));
      });
    });

    footer.querySelector('#sbRoCancel')?.addEventListener('click', () => this.close());
    footer.querySelector('#sbRoConfirm')?.addEventListener('click', () => this._handleConfirm());
  }

  close() {
    this._modal?.close?.();
    this._modal = null;
    this._root = null;
  }

  _setError(msg) {
    const el = this._root?.querySelector?.('#sbRoErr');
    if (!el) return;
    const m = String(msg || '').trim();
    el.textContent = m;
    el.style.display = m ? 'block' : 'none';
  }

  async _handleConfirm() {
    this._setError('');
    if (this._submitting) return;

    const root = this._root;
    const mode = root?.querySelector?.('input[name="sbRoTarget"]:checked')?.value || 'other';
    let targetBoard = this.currentBoard;
    if (mode === 'other') {
      targetBoard = String(root?.querySelector?.('#sbRoBoard')?.value || '').trim();
      if (!targetBoard) { this._setError('Please choose a target board.'); return; }
    }

    // Read each field's chosen mode:
    //   carry -> carryFields, set -> overrides, advance -> fiscal-year +1, clear -> skip.
    const carryFields = [];
    const overrides = {};
    let advanceFiscalYear = false;
    const options = Array.isArray(this.config?.carryOptions) ? this.config.carryOptions : [];
    for (const o of options) {
      const f = String(o.field || '').trim();
      if (!f) continue;
      const mode = root?.querySelector?.(`.sb-ro__modesel[data-field="${f}"]:checked`)?.value || 'carry';
      if (mode === 'carry') {
        carryFields.push(f);
      } else if (mode === 'set') {
        const input = root?.querySelector?.(`.sb-ro__val[data-field="${f}"]`);
        const raw = input ? String(input.value ?? '').trim() : '';
        // For "set" we always send the value (empty is a deliberate blank).
        overrides[f] = raw;
      } else if (mode === 'advance') {
        // Only the fiscal-year field offers this; backend computes +1 per project.
        advanceFiscalYear = true;
      }
      // 'clear' -> leave out of both (field starts blank/default).
    }

    // Name suffix is auto-derived by the backend (board tag, or new fiscal year).
    const nameSuffix = '';

    this._submitting = true;
    const btnCancel = this._modal?._overlay?.querySelector?.('#sbRoCancel');
    const btnConfirm = this._modal?._overlay?.querySelector?.('#sbRoConfirm');
    const prev = btnConfirm?.textContent || '';
    if (btnCancel) btnCancel.disabled = true;
    if (btnConfirm) { btnConfirm.disabled = true; btnConfirm.textContent = 'Rolling over…'; }

    try {
      await this.onConfirm({ targetBoard, carryFields, overrides, nameSuffix, advanceFiscalYear });
      this.close();
    } catch (e) {
      this._setError(e?.message || String(e) || 'Roll over failed');
      this._submitting = false;
      if (btnCancel) btnCancel.disabled = false;
      if (btnConfirm) { btnConfirm.disabled = false; btnConfirm.textContent = prev || 'Roll Over'; }
    }
  }
}
