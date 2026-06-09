/**
 * doctypeMetaService (Website-safe)
 * - Fetches DocType meta via frappe.desk.form.load.getdoctype (used elsewhere in Smart Board)
 * - Caches in-memory + localStorage TTL to avoid repeated network calls
 */
const TTL_MS = 10 * 60 * 1000; // 10 minutes
const STORAGE_PREFIX = 'sb_doctype_meta_v1:';

function storageKey(doctype) {
  return `${STORAGE_PREFIX}${String(doctype || '')}`;
}

function parseOptions(str) {
  return String(str || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export class DoctypeMetaService {
  static _cache = new Map(); // doctype -> { expiresAt, meta }
  static _loading = new Map(); // doctype -> Promise<meta|null>

  static async getMeta(doctype, { force = false } = {}) {
    const dt = String(doctype || '').trim();
    if (!dt) return null;

    if (!force) {
      // in-memory cache
      const c = this._cache.get(dt);
      if (c && c.expiresAt && Date.now() < c.expiresAt && c.meta) return c.meta;

      // localStorage cache (best-effort)
      try {
        const raw = localStorage.getItem(storageKey(dt));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.expiresAt && Date.now() < parsed.expiresAt && parsed?.meta) {
            this._cache.set(dt, { expiresAt: parsed.expiresAt, meta: parsed.meta });
            return parsed.meta;
          }
        }
      } catch (e) {}
    }

    // de-dupe inflight
    if (!force && this._loading.has(dt)) return this._loading.get(dt);

    const p = (async () => {
      try {
        const r = await frappe.call({
          method: 'frappe.desk.form.load.getdoctype',
          type: 'GET',
          args: { doctype: dt }
        });
        const docs = r?.docs || [];
        const meta = docs.find((d) => d?.name === dt) || docs[0] || null;
        const expiresAt = Date.now() + TTL_MS;
        if (meta) {
          this._cache.set(dt, { expiresAt, meta });
          try {
            localStorage.setItem(storageKey(dt), JSON.stringify({ expiresAt, meta }));
          } catch (e2) {}
        }
        return meta;
      } catch (e) {
        return null;
      } finally {
        this._loading.delete(dt);
      }
    })();

    this._loading.set(dt, p);
    return p;
  }

  static async getSelectOptions(doctype, fieldname, { force = false } = {}) {
    const meta = await this.getMeta(doctype, { force });
    const fields = meta?.fields || [];
    const f = fields.find((x) => String(x?.fieldname || '') === String(fieldname || '')) || null;
    return parseOptions(f?.options);
  }
}


