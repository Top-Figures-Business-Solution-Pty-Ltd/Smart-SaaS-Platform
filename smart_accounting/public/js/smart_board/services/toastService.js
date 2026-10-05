/**
 * ToastService (website-safe)
 * - Non-blocking notifications for /smart.
 * - Used by uiAdapter as the website fallback instead of alert().
 */
import { escapeHtml } from '../utils/dom.js';

const ROOT_ID = 'sbToastRoot';
const MAX_TOASTS = 4;
const DEFAULT_DURATION_MS = 2600;

function _now() {
  return Date.now();
}

function _normalizeIndicator(indicator) {
  const v = String(indicator || '').trim().toLowerCase();
  if (!v) return 'blue';
  // normalize common frappe indicators
  if (v === 'orange') return 'yellow';
  if (v === 'danger') return 'red';
  return v;
}

function _ensureRoot() {
  let root = document.getElementById(ROOT_ID);
  if (root) return root;

  root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'sb-toast-root';
  document.body.appendChild(root);
  return root;
}

function _makeToastEl({ message, indicator, sticky, actionLabel }) {
  const ind = _normalizeIndicator(indicator);
  const safe = escapeHtml(String(message ?? ''));
  const safeAction = escapeHtml(String(actionLabel || ''));
  const el = document.createElement('div');
  el.className = `sb-toast sb-toast--${ind}${safeAction ? ' sb-toast--actionable' : ''}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('data-created-at', String(_now()));
  el.innerHTML = `
    <div class="sb-toast__body">
      <div class="sb-toast__message">${safe}</div>
      ${safeAction ? `<button type="button" class="sb-toast__action">${safeAction}</button>` : ''}
      <button type="button" class="sb-toast__close" aria-label="Close">×</button>
    </div>
    ${sticky ? '' : '<div class="sb-toast__bar"></div>'}
  `;
  return el;
}

function _trimRoot(root) {
  try {
    const items = Array.from(root.querySelectorAll('.sb-toast'));
    if (items.length <= MAX_TOASTS) return;
    // remove oldest (bottom)
    const extra = items.slice(MAX_TOASTS);
    for (const el of extra) el.remove();
  } catch (e) {}
}

function _removeToast(el) {
  if (!el) return;
  try {
    el.classList.add('sb-toast--leave');
    setTimeout(() => el.remove(), 180);
  } catch (e) {
    try { el.remove(); } catch (e2) {}
  }
}

export class ToastService {
  /**
   * Show a toast.
   * @param {{ message: string, indicator?: string, durationMs?: number, sticky?: boolean }} args
   */
  static show({ message, indicator = 'blue', durationMs = DEFAULT_DURATION_MS, sticky = false, actionLabel = '', onAction = null } = {}) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;

    const msg = String(message ?? '').trim();
    if (!msg) return null;

    const root = _ensureRoot();
    const toast = _makeToastEl({ message: msg, indicator, sticky: !!sticky, actionLabel });
    let timerId = null;
    let closed = false;
    const closeToast = () => {
      if (closed) return;
      closed = true;
      if (timerId) clearTimeout(timerId);
      _removeToast(toast);
    };

    // Newest on top
    root.prepend(toast);
    _trimRoot(root);

    // Close button
    toast.querySelector('.sb-toast__close')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeToast();
    });

    toast.querySelector('.sb-toast__action')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (closed) return;
      const btn = e.currentTarget;
      try {
        btn.disabled = true;
        if (timerId) clearTimeout(timerId);
        if (typeof onAction === 'function') await onAction();
      } catch (err) {
        console.error('Toast action failed', err);
      } finally {
        closeToast();
      }
    });

    // Auto-dismiss
    const dur = Number(durationMs);
    if (!sticky && Number.isFinite(dur) && dur > 0) {
      timerId = setTimeout(closeToast, dur);
    }

    return toast;
  }

  static notify(message, indicator = 'blue') {
    return this.show({ message, indicator, durationMs: DEFAULT_DURATION_MS, sticky: false });
  }

  static msgprint(message, indicator = 'blue') {
    // msgprint is used for important info; keep it sticky but non-blocking.
    return this.show({ message, indicator, sticky: true });
  }
}


