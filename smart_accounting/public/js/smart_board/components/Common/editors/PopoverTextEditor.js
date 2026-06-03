/**
 * PopoverTextEditor (Notes-like, not clipped by column width)
 * - Click a cell -> opens a roomy floating textarea anchored to the cell.
 * - Rendered to document.body via a portal so it is never clipped by the table
 *   overflow and is NOT constrained to the (often narrow) column width.
 * - Commit/cancel are driven by EditingManager:
 *     - click outside (the portal is marked so clicks inside keep it open)
 *     - Enter commits, Shift+Enter inserts a newline, Esc cancels
 *   We disable blur-commit so moving focus inside the popover never saves early.
 */
import { computeOverlayPlacement } from '../../../utils/overlayPlacement.js';

export class PopoverTextEditor {
  constructor(mountEl, { initialValue = '', placeholder = '', minWidth = 360, rows = 4 } = {}) {
    this.mountEl = mountEl;
    this.initialValue = initialValue ?? '';
    this.placeholder = placeholder ?? '';
    this.minWidth = minWidth;
    this.rows = rows;
    this._anchor = null;
    this._portal = null;
    this._textarea = null;
    this._onDocScroll = null;
    this._onWinResize = null;
    // EditingManager: rely on explicit Enter/Esc + outside-click, never blur.
    this.disableBlurCommit = true;
    this.render();
  }

  _cleanupPortal() {
    if (this._onDocScroll) {
      document.removeEventListener('scroll', this._onDocScroll, true);
      this._onDocScroll = null;
    }
    if (this._onWinResize) {
      window.removeEventListener('resize', this._onWinResize);
      this._onWinResize = null;
    }
    if (this._portal?.parentNode) {
      try { this._portal.parentNode.removeChild(this._portal); } catch (e) {}
    }
    this._portal = null;
    this._textarea = null;
  }

  render() {
    if (!this.mountEl) return;
    this._cleanupPortal();

    // Tiny in-cell anchor used only for positioning the floating editor.
    this.mountEl.innerHTML = `
      <div class="sb-inline-editor sb-pop-anchor" tabindex="0"></div>
    `;
    this._anchor = this.mountEl.querySelector('.sb-pop-anchor');

    this._portal = document.createElement('div');
    this._portal.className = 'sb-pop-editor';
    // Marker so EditingManager's outside-click handler ignores clicks inside.
    this._portal.dataset.sbEditorPortal = '1';
    this._portal.innerHTML = `
      <textarea class="form-control sb-inline-editor sb-pop-editor__ta" rows="${this.rows}"></textarea>
      <div class="sb-pop-editor__hint">Enter 保存 · Shift+Enter 换行 · Esc 取消</div>
    `;
    document.body.appendChild(this._portal);

    this._textarea = this._portal.querySelector('textarea.sb-pop-editor__ta');
    if (this._textarea) {
      this._textarea.value = String(this.initialValue ?? '');
      this._textarea.placeholder = String(this.placeholder ?? '');
      const swallowScroll = (e) => { e.stopPropagation(); };
      this._textarea.addEventListener('wheel', swallowScroll, { passive: true });
      this._textarea.addEventListener('touchmove', swallowScroll, { passive: true });
    }

    // Keep clicks inside the portal from bubbling out and triggering commit.
    this._portal.addEventListener('mousedown', (e) => { e.stopPropagation(); }, true);

    this._reposition();
    this._onDocScroll = () => this._reposition();
    document.addEventListener('scroll', this._onDocScroll, true);
    this._onWinResize = () => this._reposition();
    window.addEventListener('resize', this._onWinResize);
  }

  _reposition() {
    if (!this._portal || !this._anchor) return;
    const rect = this._anchor.getBoundingClientRect();
    const placement = computeOverlayPlacement(rect, {
      preferredWidth: Math.max(this.minWidth, rect.width),
      minHeight: 140,
      maxHeight: 360,
      gap: 6,
      viewportPadding: 8,
      menuScrollHeight: Number(this._portal.scrollHeight || 180),
    });
    this._portal.style.position = 'fixed';
    this._portal.style.left = `${placement.left}px`;
    this._portal.style.top = `${placement.top}px`;
    this._portal.style.width = `${placement.width}px`;
    this._portal.style.zIndex = '30000';
  }

  focus() {
    if (!this._textarea) return;
    try {
      this._textarea.focus();
      const len = this._textarea.value.length;
      this._textarea.setSelectionRange(len, len);
    } catch (e) {}
  }

  getValue() {
    return this._textarea ? this._textarea.value : this.initialValue;
  }

  setValue(v) {
    if (this._textarea) this._textarea.value = String(v ?? '');
  }

  getInputEl() {
    return this._textarea;
  }

  destroy() {
    if (this.mountEl) this.mountEl.innerHTML = '';
    this._cleanupPortal();
    this._anchor = null;
    this.mountEl = null;
  }
}
