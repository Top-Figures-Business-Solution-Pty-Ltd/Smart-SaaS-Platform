/**
 * MultiLinkPicker (Website-safe)
 * - Multi-select Link style picker using frappe.desk.search.search_link
 * - Optional default list via frappe.client.get_list (when focus with empty txt)
 *
 * Intended usage:
 *   const picker = new MultiLinkPicker(el, { doctype: 'Software', initialValues: ['Xero'] })
 *   picker.getValue() => ['Xero', ...]
 */
import { escapeHtml } from '../../utils/dom.js';
import { debounce } from '../../utils/helpers.js';
import { computeOverlayPlacement } from '../../utils/overlayPlacement.js';
 
export class MultiLinkPicker {
  constructor(
    mountEl,
    {
      doctype,
      placeholder = 'Search...',
      initialValues = [],
      defaultList = null, // async () => string[]
      resolveMeta = null, // async (values: string[]) => Record<string, { label?: string, image?: string }>
      searchProvider = null, // async (txt: string) => string[]  (optional override for search_link)
      onChange,
      max = null,
    } = {}
  ) {
    this.mountEl = mountEl;
    this.doctype = doctype;
    this.placeholder = placeholder;
    this.values = Array.isArray(initialValues) ? initialValues.filter(Boolean) : [];
    this.defaultList = typeof defaultList === 'function' ? defaultList : null;
    this.resolveMeta = typeof resolveMeta === 'function' ? resolveMeta : null;
    this.searchProvider = typeof searchProvider === 'function' ? searchProvider : null;
    this.onChange = onChange || (() => {});
    this.max = (max == null) ? null : Number(max);
 
    this._cache = new Map(); // key: txt -> string[]
    this._seq = 0;
    this._open = false;
    this._onDocClick = null;
    this._onDocScroll = null;
    this._onWinResize = null;
    this._defaultLoaded = false;
    this._defaultItems = [];
    this._menuPortal = null;
    this._meta = new Map(); // value -> {label,image}
    this._metaLoading = null;
    this._lastMenuKey = '';
    this._renderingMenu = false;
 
    this._render();
    this._createPortalMenu();
    this._bind();
    this._renderChips();
  }
 
  _render() {
    this.mountEl.innerHTML = `
      <div class="sb-multilink">
        <div class="sb-multilink__chips"></div>
        <input class="form-control sb-multilink__input" type="text" placeholder="${escapeHtml(this.placeholder)}" />
      </div>
    `;
    this._root = this.mountEl.querySelector('.sb-multilink');
    this._chips = this.mountEl.querySelector('.sb-multilink__chips');
    this._input = this.mountEl.querySelector('.sb-multilink__input');
    this._menu = null; // portal
  }
 
  _createPortalMenu() {
    // Portal menu prevents clipping under table overflow/virtualization.
    const el = document.createElement('div');
    el.className = 'sb-multilink__menu sb-multilink__menu--portal';
    el.style.display = 'none';
    // Mark as editor portal so EditingManager click-outside logic can ignore it.
    el.dataset.sbEditorPortal = '1';
    document.body.appendChild(el);
    this._menu = el;
    this._menuPortal = el;
  }

  _bind() {
    if (!this._input) return;
 
    const onInput = debounce(() => {
      const txt = (this._input.value || '').trim();
      this._search(txt);
    }, 250);
 
    this._input.addEventListener('input', onInput);
    this._input.addEventListener('focus', () => {
      const txt = (this._input.value || '').trim();
      if (txt) this._search(txt);
      else this._showDefault();
    });
 
    // Prevent blur commit when clicking inside menu / chips
    this._menu?.addEventListener(
      'mousedown',
      (e) => {
        // Always prevent focus loss when interacting with portal menu
        e.preventDefault();
      },
      true
    );
 
    this._menu?.addEventListener('click', (e) => {
      const item = e.target?.closest?.('.sb-multilink__item');
      if (!item) return;
      e.preventDefault();
      const val = item.dataset.value || '';
      this.toggleValue(val);
      // keep menu open for multi-select; refocus
      setTimeout(() => {
        try {
          this._input?.focus?.();
        } catch (e2) {}
      }, 0);
    });
 
    this._chips?.addEventListener(
      'mousedown',
      (e) => {
        const btn = e.target?.closest?.('.sb-multilink__chipx');
        if (!btn) return;
        e.preventDefault();
      },
      true
    );
 
    this._chips?.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.sb-multilink__chipx');
      if (!btn) return;
      e.preventDefault();
      const v = btn.dataset.value || '';
      this.removeValue(v);
      setTimeout(() => {
        try {
          this._input?.focus?.();
        } catch (e2) {}
      }, 0);
    });
 
    this._onDocClick = (e) => {
      if (!this._root) return;
      const inRoot = this._root.contains(e.target);
      const inMenu = this._menu?.contains?.(e.target);
      if (!inRoot && !inMenu) this.closeMenu();
    };
    document.addEventListener('click', this._onDocClick);

    // Reposition menu on any scroll (capture to catch nested scroll containers like table body)
    this._onDocScroll = () => {
      if (this._open) this._repositionMenu();
    };
    document.addEventListener('scroll', this._onDocScroll, true);

    this._onWinResize = () => {
      if (this._open) this._repositionMenu();
    };
    window.addEventListener('resize', this._onWinResize);
  }
 
  async _showDefault() {
    if (!this._menu) return;
 
    // Already have loaded defaults; just show them
    if (this._defaultLoaded) {
      this._renderMenu(this._defaultItems, { emptyLabel: 'No items' });
      return;
    }
 
    // No default list provider
    if (!this.defaultList) {
      this.closeMenu();
      return;
    }
 
    try {
      const items = await this.defaultList();
      this._defaultItems = Array.isArray(items) ? items.filter(Boolean) : [];
      this._defaultLoaded = true;
      this._renderMenu(this._defaultItems, { emptyLabel: 'No items' });
    } catch (e) {
      this._defaultLoaded = true;
      this._defaultItems = [];
      this._renderMenu([], { emptyLabel: 'No items' });
    }
  }
 
  async _search(txt) {
    if (!this._menu) return;
    if (!txt) {
      await this._showDefault();
      return;
    }
 
    const key = txt.toLowerCase();
    if (this._cache.has(key)) {
      this._renderMenu(this._cache.get(key));
      return;
    }
 
    const seq = ++this._seq;
    try {
      let results = [];
      if (this.searchProvider) {
        const list = await this.searchProvider(txt);
        results = Array.isArray(list) ? list.filter(Boolean) : [];
      } else {
        const r = await frappe.call({
          method: 'frappe.desk.search.search_link',
          args: {
            doctype: this.doctype,
            txt,
            page_length: 12,
          },
        });
        results = (r.message || []).map((row) => row.value).filter(Boolean);
      }
  
      if (seq !== this._seq) return; // stale
      this._cache.set(key, results);
      this._renderMenu(results);
    } catch (e) {
      if (seq !== this._seq) return;
      this._renderMenu([]);
    }
  }
 
  _renderChips() {
    if (!this._chips) return;
    const list = this.getValue();
    // Warm meta for display (best-effort, async)
    this._ensureMeta(list);
    this._chips.innerHTML = list.length
      ? list
          .map((v) => {
            const m = this._meta.get(v) || {};
            const display = escapeHtml(m.label || v);
            const initial = escapeHtml((String(m.label || v || '').trim()[0] || '').toUpperCase());
            const img = (m.image || '').trim();
            return `
              <span class="sb-multilink__chip" title="${display}">
                ${img ? `<img class="sb-multilink__chipimg" src="${escapeHtml(img)}" alt="" />` : `<span class="sb-multilink__chipav">${initial}</span>`}
                <span class="sb-multilink__chiptext">${display}</span>
                <button type="button" class="sb-multilink__chipx" data-value="${escapeHtml(v)}" aria-label="Remove">×</button>
              </span>
            `;
          })
          .join('')
      : '';
  }
 
  _renderMenu(items, { emptyLabel = 'No results' } = {}) {
    if (!this._menu) return;
    const list = Array.isArray(items) ? items : [];
    const key = list.join('\n');
    this._lastMenuKey = key;
    // Warm meta for menu display (best-effort) WITHOUT causing render loops:
    // Only trigger a single rerender if we actually have missing meta.
    if (this.resolveMeta) {
      const missing = list.filter((v) => v && !this._meta.has(v));
      if (missing.length) {
        Promise.resolve(this._ensureMeta(missing))
          .then(() => {
            if (!this._open) return;
            if (this._lastMenuKey !== key) return;
            // Now meta should be present, rerender once to show names/images.
            this._renderMenu(list, { emptyLabel });
          })
          .catch(() => {});
      }
    }

    const selected = new Set(this.values);
    this._menu.innerHTML = list.length
      ? list
          .map((v) => {
            const on = selected.has(v);
            const m = this._meta.get(v) || {};
            const display = escapeHtml(m.label || v);
            const initial = escapeHtml((String(m.label || v || '').trim()[0] || '').toUpperCase());
            const img = (m.image || '').trim();
            return `
              <div class="sb-multilink__item ${on ? 'is-selected' : ''}" data-value="${escapeHtml(v)}">
                ${img ? `<img class="sb-multilink__img" src="${escapeHtml(img)}" alt="" />` : `<span class="sb-multilink__av">${initial}</span>`}
                <span class="sb-multilink__label">${display}</span>
                <span class="sb-multilink__check">${on ? '✓' : ''}</span>
              </div>
            `;
          })
          .join('')
      : `<div class="sb-multilink__empty text-muted">${escapeHtml(emptyLabel)}</div>`;
    this.openMenu();
  }

  async _ensureMeta(values) {
    if (!this.resolveMeta) return;
    const arr = Array.isArray(values) ? values.filter(Boolean) : [];
    const missing = arr.filter((v) => !this._meta.has(v));
    if (!missing.length) return;
    if (this._metaLoading) return this._metaLoading;

    this._metaLoading = (async () => {
      try {
        const r = await this.resolveMeta(missing);
        const obj = (r && typeof r === 'object') ? r : {};
        for (const v of missing) {
          const m = obj[v] || {};
          // store at least label so we don't refetch forever
          this._meta.set(v, { label: m.label || v, image: m.image || '' });
        }
      } catch (e) {
        // fail silent
        for (const v of missing) {
          if (!this._meta.has(v)) this._meta.set(v, { label: v, image: '' });
        }
      } finally {
        this._metaLoading = null;
      }
    })();

    return this._metaLoading;
  }
 
  _repositionMenu() {
    if (!this._menu || !this._input) return;
    const rect = this._input.getBoundingClientRect();
    const placement = computeOverlayPlacement(rect, {
      preferredWidth: Math.max(240, rect.width),
      minHeight: 160,
      maxHeight: 320,
      gap: 6,
      viewportPadding: 8,
      menuScrollHeight: Number(this._menu.scrollHeight || 260),
    });

    // Fixed overlay
    this._menu.style.position = 'fixed';
    this._menu.style.left = `${placement.left}px`;
    this._menu.style.top = `${placement.top}px`;
    this._menu.style.width = `${placement.width}px`;
    this._menu.style.zIndex = '30000';
    this._menu.style.maxHeight = `${placement.maxHeight}px`;
  }

  openMenu() {
    if (!this._menu) return;
    this._repositionMenu();
    this._menu.style.display = 'block';
    this._open = true;
  }
 
  closeMenu() {
    if (!this._menu) return;
    this._menu.style.display = 'none';
    this._open = false;
  }
 
  getValue() {
    return Array.isArray(this.values) ? this.values.slice() : [];
  }
 
  setValue(values) {
    const arr = Array.isArray(values) ? values.filter(Boolean) : [];
    this.values = this._uniq(arr);
    this._renderChips();
    // Rerender menu if open so selection marks update
    if (this._open) {
      const txt = (this._input?.value || '').trim();
      if (txt) this._search(txt);
      else this._showDefault();
    }
  }
 
  toggleValue(value) {
    const v = (value || '').trim();
    if (!v) return;
    const set = new Set(this.values);
    if (set.has(v)) set.delete(v);
    else {
      if (this.max != null && Number.isFinite(this.max) && this.values.length >= this.max) {
        if (Number(this.max) === 1) {
          this.values = [v];
          this._renderChips();
          const txt = (this._input?.value || '').trim();
          if (txt) this._search(txt);
          else this._showDefault();
          this.onChange(this.getValue());
          return;
        }
        return;
      }
      set.add(v);
    }
    this.values = this._uniq(Array.from(set));
    this._renderChips();
    // Update menu selection markers in-place (cheap: rerender current menu list)
    const txt = (this._input?.value || '').trim();
    if (txt) this._search(txt);
    else this._showDefault();
    this.onChange(this.getValue());
  }
 
  removeValue(value) {
    const v = (value || '').trim();
    if (!v) return;
    this.values = this.values.filter((x) => x !== v);
    this._renderChips();
    const txt = (this._input?.value || '').trim();
    if (txt) this._search(txt);
    else this._showDefault();
    this.onChange(this.getValue());
  }
 
  _uniq(list) {
    const out = [];
    const seen = new Set();
    for (const x of list) {
      const v = String(x || '').trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }
 
  getInputEl() {
    return this._input || null;
  }
 
  focus({ select = false } = {}) {
    try {
      this._input?.focus?.();
      if (select) this._input?.select?.();
    } catch (e) {}
  }
 
  destroy() {
    if (this._onDocClick) {
      document.removeEventListener('click', this._onDocClick);
      this._onDocClick = null;
    }
    if (this._onDocScroll) {
      document.removeEventListener('scroll', this._onDocScroll, true);
      this._onDocScroll = null;
    }
    if (this._onWinResize) {
      window.removeEventListener('resize', this._onWinResize);
      this._onWinResize = null;
    }
    if (this._menuPortal?.parentNode) {
      try { this._menuPortal.parentNode.removeChild(this._menuPortal); } catch (e) {}
    }
    this._menuPortal = null;
    this.mountEl.innerHTML = '';
  }
}


