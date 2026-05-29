/**
 * projectTypeChangeController
 * - Orchestrates "change project type" flow for Board table cells.
 *
 * Responsibilities:
 * - Fetch Project Type options (data access via service)
 * - Open UI modal (UI component)
 * - Return selected value (no write side-effects here)
 */
import { ProjectTypeService } from '../services/projectTypeService.js';
import { ProjectTypeChangeModal } from '../components/BoardView/ProjectTypeChangeModal.js';
import { getAllowedProjectTypes, getExcludedProjectTypes } from '../utils/moduleConfig.js';

/**
 * Open modal and let caller decide what to do with the chosen value.
 * Returns the modal instance so callers can close it on teardown (e.g. inline editor cancel).
 */
export async function openProjectTypeChangeFlow({ project, onSelected, onClosed } = {}) {
  const p = project || null;
  if (!p) return null;

  const options = await ProjectTypeService.fetchProjectTypes();

  // Keep "change board" choices within the current module's boards only.
  // e.g. inside Smart Grants the user should only move a project between grants boards,
  // never into an accounting Project Type (and vice versa).
  const allowed = getAllowedProjectTypes();
  const excluded = getExcludedProjectTypes();
  let scoped = Array.isArray(options) ? options.slice() : [];
  if (allowed.length) {
    const allowSet = new Set(allowed.map((s) => String(s || '').trim()));
    scoped = scoped.filter((t) => allowSet.has(String(t || '').trim()));
  } else if (excluded.length) {
    const exclSet = new Set(excluded.map((s) => String(s || '').trim()));
    scoped = scoped.filter((t) => !exclSet.has(String(t || '').trim()));
  }

  const modal = new ProjectTypeChangeModal({
    project: p,
    projectTypes: scoped,
    onConfirm: async ({ next }) => {
      try {
        await onSelected?.(String(next || '').trim() || '');
      } catch (e) {}
    },
    onClose: () => {
      try { onClosed?.(); } catch (e) {}
    },
  });
  await modal.open();
  return modal;
}


