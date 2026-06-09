/**
 * InlineMenuSelectEditor
 * - Click once to open a menu immediately (Monday-like affordance)
 * - Website-safe; no native <select> quirks (no "needs second click")
 *
 * options:
 * - string[] OR { value: string, label?: string, color?: string }[]
 */
import { escapeHtml } from '../../../utils/dom.js';
import { computeOverlayPlacement } from '../../../utils/overlayPlacement.js';

export class InlineMenuSelectEditor {
  constructor(mountEl, { options = [], initialValue = '', placeholder = null } = {}) {
    this.mountEl = mountEl;
    this.options = Array.isArray(options) ? options : [];
    this.initialValue = initialValue ?? '';
    this.placeholder = placeholder;
    this._root = null;
    this._portal = null;
    this._onDocScroll = null;
    this._onWinResize = null;
    this._onDocClick = null;
    this._value = null; // selected value during edit; null means unchanged
    // Menu editors use explicit close/select events; blur-commit causes flicker on async option refresh.
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
    if (this._onDocClick) {
      document.removeEventListener('mousedown', this._onDocClick, true);
      this._onDocClick = null;
    }
    if (this._portal?.parentNode) {
      try { this._portal.parentNode.removeChild(this._portal); } catch (e) {}
    }
    this._portal = null;
  }

  render() {
    if (!this.mountEl) return;
    // IMPORTANT: render() may be called multiple times (e.g. async options load).
    // Ensure we don't leak portals or global listeners.
    this._cleanupPortal();

    const items = this._normalizeOptions(this.options);

    this.mountEl.innerHTML = `
      <div class="sb-inline-editor sb-inline-editor--menu sb-inline-editor--menu-anchor" tabindex="0"></div>
    `;
    this._root = this.mountEl.querySelector('.sb-inline-editor--menu-anchor');

    // Build portal menu to avoid being clipped by table overflow.
    this._portal = document.createElement('div');
    this._portal.className = 'sb-menu sb-menu--portal';
    this._portal.dataset.sbEditorPortal = '1';
    this._portal.style.display = 'block';
    this._portal.innerHTML = items.map((it) => this._itemHTML(it)).join('');
    document.body.appendChild(this._portal);
    this._reposition();

    // Click to choose
    this._portal?.addEventListener('mousedown', (e) => {
      // prevent blur/selection issues while clicking menu
      e.preventDefault();
    }, true);

    this._portal?.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('button[data-value]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const v = btn.dataset.value ?? '';
      this._value = v;
      // host manager decides commit timing; we just store value
      // IMPORTANT: dispatch on mountEl so Board's listener (on cell-content) can catch it.
      this.mountEl?.dispatchEvent?.(new CustomEvent('sb:menu-select', { bubbles: true, detail: { value: v } }));
    });

    // Keep portal aligned on scroll/resize
    this._onDocScroll = () => this._reposition();
    document.addEventListener('scroll', this._onDocScroll, true);
    this._onWinResize = () => this._reposition();
    window.addEventListener('resize', this._onWinResize);

    // Close on outside click (so blur/close behavior is consistent for portal menus)
    this._onDocClick = (e) => {
      const inAnchor = this._root?.contains?.(e.target);
      const inMenu = this._portal?.contains?.(e.target);
      if (inAnchor || inMenu) return;
      // Let EditingManager do commit+close; we just request close.
      this.mountEl?.dispatchEvent?.(new CustomEvent('sb:menu-close', { bubbles: true }));
    };
    document.addEventListener('mousedown', this._onDocClick, true);
  }

  _reposition() {
    if (!this._portal || !this._root) return;
    const rect = this._root.getBoundingClientRect();
    // Count options to decide a comfortable width: single column for a few
    // options, a roomy two/three-column grid for long status lists. This is what
    // makes the menu feel like an ordered "card grid" instead of a long strip.
    const optionCount = this._portal?.querySelectorAll?.('button[data-value]')?.length || 0;
    const preferredWidth = optionCount > 8
      ? Math.max(380, rect.width)
      : (optionCount > 3 ? Math.max(300, rect.width) : Math.max(220, rect.width));
    const placement = computeOverlayPlacement(rect, {
      preferredWidth,
      minHeight: 180,
      maxHeight: 520,
      gap: 6,
      viewportPadding: 8,
      menuScrollHeight: Number(this._portal.scrollHeight || 260),
    });

    this._portal.style.position = 'fixed';
    this._portal.style.left = `${placement.left}px`;
    this._portal.style.top = `${placement.top}px`;
    this._portal.style.width = `${placement.width}px`;
    this._portal.style.zIndex = '30000';
    this._portal.style.maxHeight = `${placement.maxHeight}px`;
    this._portal.style.overflow = 'auto';
  }

  focus() {
    try { this._root?.focus?.(); } catch (e) {}
  }

  getValue() {
    // If user didn't pick, return initial value to avoid accidental "empty save"
    return this._value == null ? this.initialValue : this._value;
  }

  setValue(v) {
    this._value = v;
  }

  getInputEl() {
    return this._root;
  }

  destroy() {
    if (this.mountEl) this.mountEl.innerHTML = '';
    this._cleanupPortal();
    this._root = null;
    this.mountEl = null;
  }

  _normalizeOptions(options) {
    return (options || []).map((o) => {
      if (o && typeof o === 'object') {
        const value = String(o.value ?? o.label ?? '');
        const label = String(o.label ?? o.value ?? '');
        const color = o.color ? String(o.color) : '';
        return { value, label, color };
      }
      const v = String(o ?? '');
      return { value: v, label: v, color: '' };
    // Keep an explicit "clear" choice (empty value but a visible label like "—");
    // only drop entries that are blank in BOTH value and label.
    }).filter((it) => it.value !== '' || it.label !== '');
  }

  _itemHTML(it) {
    const style = it.color ? ` style="background:${escapeHtml(it.color)};color:#fff;border-color:transparent;"` : '';
    return `<button type="button" class="sb-menu__item"${style} data-value="${escapeHtml(it.value)}">${escapeHtml(it.label)}</button>`;
  }
}


