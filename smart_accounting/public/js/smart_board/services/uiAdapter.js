/**
 * UI Adapter
 * - One place to show alerts/notifications/confirm/dialog across Desk and Website.
 */

import { isDesk, hasDialog } from '../utils/env.js';
import { ToastService } from './toastService.js';

export function notify(message, indicator = 'blue') {
  if (isDesk() && typeof frappe?.show_alert === 'function') {
    frappe.show_alert({ message, indicator });
    return;
  }
  // Website fallback
  ToastService.notify(message, indicator);
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    if (isDesk() && typeof frappe?.confirm === 'function') {
      frappe.confirm(message, () => resolve(true), () => resolve(false));
      return;
    }
    resolve(window.confirm(message));
  });
}

export function msgprint(message) {
  if (isDesk() && typeof frappe?.msgprint === 'function') {
    frappe.msgprint(message);
    return;
  }
  ToastService.msgprint(message, 'blue');
}

/**
 * Friendly, blocking-style notice that overlays ON TOP of any open modal.
 * Use this for user-facing prompts (e.g. "name already exists") so users never
 * see raw Frappe/browser error dialogs.
 *
 * @param {string} message
 * @param {{ title?: string, indicator?: string, okLabel?: string }} [opts]
 * @returns {Promise<void>} resolves when dismissed
 */
export function alertDialog(message, opts = {}) {
  const title = String(opts.title || 'Notice');
  const indicator = String(opts.indicator || 'orange').toLowerCase();
  const okLabel = String(opts.okLabel || 'OK');
  const text = String(message == null ? '' : message);

  // Desk: keep native behavior.
  if (isDesk() && typeof frappe?.msgprint === 'function') {
    frappe.msgprint({ title, message: text, indicator });
    return Promise.resolve();
  }

  if (typeof document === 'undefined') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const accent = indicator === 'red' || indicator === 'danger'
      ? '#dc2626'
      : (indicator === 'green' ? '#16a34a' : '#d97706');

    const overlay = document.createElement('div');
    overlay.className = 'sb-alert-overlay';
    // Above sb-modal-overlay (20000) and portal menus (30000).
    overlay.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:40000',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(15,23,42,0.32)', 'padding:16px',
    ].join(';'));

    const box = document.createElement('div');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('style', [
      'background:#fff', 'border-radius:12px', 'max-width:420px', 'width:100%',
      'box-shadow:0 20px 50px rgba(15,23,42,0.25)', 'overflow:hidden',
      'font-family:inherit',
    ].join(';'));

    const safeTitle = escapeForHtml(title);
    const safeText = escapeForHtml(text);
    box.innerHTML = `
      <div style="display:flex;gap:12px;padding:20px 20px 8px 20px;align-items:flex-start;">
        <span style="flex:0 0 auto;width:10px;height:10px;border-radius:50%;margin-top:7px;background:${accent};"></span>
        <div style="flex:1 1 auto;min-width:0;">
          <div style="font-size:15px;font-weight:600;color:#0f172a;margin-bottom:6px;">${safeTitle}</div>
          <div style="font-size:13.5px;line-height:1.5;color:#334155;white-space:pre-wrap;word-break:break-word;">${safeText}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;padding:12px 20px 18px 20px;">
        <button type="button" class="sb-alert-ok" style="appearance:none;border:0;cursor:pointer;background:#0f172a;color:#fff;font-size:13px;font-weight:600;padding:8px 18px;border-radius:8px;">${escapeForHtml(okLabel)}</button>
      </div>
    `;

    const cleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      try { overlay.remove(); } catch (e) {}
      resolve();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
      }
    };

    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) cleanup();
    });
    box.querySelector('.sb-alert-ok')?.addEventListener('click', cleanup);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    setTimeout(() => box.querySelector('.sb-alert-ok')?.focus(), 0);
  });
}

function escapeForHtml(input) {
  const div = document.createElement('div');
  div.textContent = String(input == null ? '' : input);
  return div.innerHTML;
}

export function openDialog(DialogClassArgs) {
  if (!hasDialog()) {
    msgprint('This dialog is not available in this view yet.');
    return null;
  }
  const d = new frappe.ui.Dialog(DialogClassArgs);
  d.show();
  return d;
}


