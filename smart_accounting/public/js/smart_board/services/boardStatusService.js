/**
 * BoardStatusService
 * - Board-level status subset config per Project Type (global setting).
 */
import { Perf } from '../utils/perf.js';

const TTL_MS = 5 * 60 * 1000; // 5 minutes

let _poolCache = { expiresAt: 0, pool: null };
const _cfgCache = new Map(); // projectType -> { expiresAt, configured, allowed }

function _now() { return Date.now(); }

export class BoardStatusService {
  static async fetchConfig(projectType) {
    const pt = String(projectType || '').trim();
    return await Perf.timeAsync('board_status.get_config', async () => {
      const r = await frappe.call({
        method: 'smart_accounting.api.board_settings.get_project_type_status_config',
        args: { project_type: pt }
      });
      return r?.message || {};
    }, () => ({ projectType: pt }));
  }

  static async getPool() {
    const c = _poolCache;
    if (c.pool && _now() < (c.expiresAt || 0)) return c.pool;
    // Use any projectType (empty) to get pool
    const r = await this.fetchConfig('');
    const pool = Array.isArray(r?.pool) ? r.pool : [];
    _poolCache = { pool, expiresAt: _now() + TTL_MS };
    return pool;
  }

  static async getConfig(projectType, { force = false } = {}) {
    const pt = String(projectType || '').trim();
    if (!pt) return { configured: false, allowed: [], pool: await this.getPool() };
    const c = _cfgCache.get(pt);
    if (!force && c && _now() < (c.expiresAt || 0)) {
      // IMPORTANT: pool is per-project-type (backend may scope some statuses).
      // Always return the pool that came with this board, not the global one.
      const cachedPool = Array.isArray(c.pool) ? c.pool : null;
      return {
        configured: !!c.configured,
        allowed: c.allowed || [],
        pool: cachedPool || await this.getPool(),
      };
    }
    const r = await this.fetchConfig(pt);
    const allowed = Array.isArray(r?.allowed) ? r.allowed : [];
    const configured = !!r?.configured && allowed.length > 0;
    const pool = Array.isArray(r?.pool) ? r.pool : [];
    _cfgCache.set(pt, { expiresAt: _now() + TTL_MS, configured, allowed, pool });
    return { configured, allowed, pool: pool.length ? pool : await this.getPool() };
  }

  static async saveConfig(projectType, statuses = []) {
    const pt = String(projectType || '').trim();
    const list = Array.isArray(statuses) ? statuses.map((s) => String(s || '').trim()).filter(Boolean) : [];
    return await Perf.timeAsync('board_status.save_config', async () => {
      const r = await frappe.call({
        method: 'smart_accounting.api.board_settings.set_project_type_status_config',
        type: 'POST',
        args: { project_type: pt, statuses: list }
      });
      // Bust cache for this board
      _cfgCache.delete(pt);
      return r?.message || {};
    }, () => ({ projectType: pt, count: list.length }));
  }

  static async getEffectiveOptions({ projectType, currentValue } = {}) {
    const pt = String(projectType || '').trim();
    const cur = String(currentValue || '').trim();
    const cfg = await this.getConfig(pt);
    const pool = Array.isArray(cfg.pool) ? cfg.pool : [];
    const allowed = cfg.configured ? (cfg.allowed || []) : pool;
    const allowedSet = new Set(allowed);
    // Keep order from allowed; ensure values exist in pool when possible
    const poolSet = new Set(pool);
    let out = allowed.filter((x) => poolSet.size ? poolSet.has(x) : true);
    if (cur && !out.includes(cur)) out = [cur].concat(out);
    // Safety: if empty for any reason, fall back to pool/current
    if (!out.length) out = cur ? [cur].concat(pool) : pool;
    // Remove dups while preserving order
    const seen = new Set();
    const uniq = [];
    for (const s of out) {
      const v = String(s || '').trim();
      if (!v || seen.has(v)) continue;
      uniq.push(v);
      seen.add(v);
    }
    // If config is present but resulted in no options (e.g. pool changed), show pool.
    if (cfg.configured && uniq.length === (cur ? 1 : 0) && pool.length) return cur ? [cur].concat(pool) : pool;
    return uniq;
  }
}


