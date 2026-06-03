"""
Board Settings APIs (website-safe)
- Currently: manage Project Type order shown in Smart Board sidebar.

Design:
- Do NOT require DocType/field changes.
- Store ordering in global defaults as JSON array.
"""

from __future__ import annotations

from typing import Any

import frappe


DEFAULT_KEY_PROJECT_TYPE_ORDER = "smart_accounting_project_type_order"
DEFAULT_KEY_PROJECT_TYPE_STATUS_CONFIG = "smart_accounting_project_type_status_config"

# Special-rule toggle keys (global defaults). Unset value means "enabled" (default ON).
_SPECIAL_RULE_KEY_PREFIX = "smart_accounting_special_rule_"
_SPECIAL_RULE_ALLOWED_KEYS = {
	"monthly_ias_defer",
}


def _ensure_logged_in() -> None:
	if frappe.session.user in (None, "", "Guest"):
		frappe.throw("Not permitted", frappe.PermissionError)


def _ensure_can_manage_board_settings() -> None:
	# Board settings affect everyone; keep it admin/system-manager for now.
	user = frappe.session.user
	if user == "Administrator":
		return
	# Frappe has no stable top-level frappe.has_role API across versions.
	# Use get_roles(user) which is the supported role lookup path.
	try:
		roles = frappe.get_roles(user) or []
	except Exception:
		roles = []
	if "System Manager" not in {str(r or "").strip() for r in roles}:
		frappe.throw("Not permitted", frappe.PermissionError)


def _get_all_project_types() -> list[str]:
	rows = frappe.get_all("Project Type", fields=["name"], order_by="name asc", limit_page_length=5000)
	return [r.get("name") for r in rows if r.get("name")]


def _parse_options(raw: Any) -> list[str]:
	try:
		text = str(raw or "")
	except Exception:
		text = ""
	opts = [x.strip() for x in text.split("\n") if str(x).strip()]
	seen = set()
	out: list[str] = []
	for x in opts:
		if x in seen:
			continue
		out.append(x)
		seen.add(x)
	return out


def _get_project_status_pool() -> list[str]:
	"""Source of truth: Project.status options from DocType meta (includes Property Setter)."""
	try:
		meta = frappe.get_meta("Project")
		f = meta.get_field("status") if meta else None
		return _parse_options(getattr(f, "options", None))
	except Exception:
		return []


# Project-type-scoped statuses (code-level contract, not user-configurable via UI).
# Keys: exact status name. Values: set of Project Type names allowed to use that status.
# Statuses NOT listed here are globally allowed across all Project Types.
# Rationale: R&D workflow statuses only make sense on Smart Grants boards. Scoping
# them here prevents them from showing up in Status Settings / status dropdowns of
# unrelated boards (BAS, IAS, ASIC, TPAR, ...). To change scope, edit this map.
# All Smart Grants boards (the legacy aggregate board + the per-year boards).
# Statuses scoped to grants should be available on every grants board, not just the
# legacy "Smart Grants" one.
SMART_GRANTS_BOARDS: set[str] = {
	# Legacy aggregated "Smart Grants" board was removed (see
	# patches.drop_smart_grants_board); only the per-year boards remain.
	"Grants 2024",
	"Grants 2025",
	"Grants 2026",
	"Grants 2027",
}

_STATUS_PROJECT_TYPE_SCOPE: dict[str, set[str]] = {
	# R&D workflow statuses (2026-04) — Smart Grants boards only
	"Waiting for tech meeting": SMART_GRANTS_BOARDS,
	"Waiting for tech evidence": SMART_GRANTS_BOARDS,
	"Preparing R&D report": SMART_GRANTS_BOARDS,
	"Waiting for report review and signature": SMART_GRANTS_BOARDS,
	"Preparing application form": SMART_GRANTS_BOARDS,
	"Waiting for AP review": SMART_GRANTS_BOARDS,
	"Waiting for financial accounts": SMART_GRANTS_BOARDS,
	"Preparing R&D exp calculation": SMART_GRANTS_BOARDS,
	"Waiting for responses to fin queries": SMART_GRANTS_BOARDS,
	"Final pack prep": SMART_GRANTS_BOARDS,
	# Engagement decided not to proceed — Smart Grants boards only (2026-05)
	"Not to Proceed": SMART_GRANTS_BOARDS,
}


def _filter_pool_for_project_type(pool: list[str], project_type: str) -> list[str]:
	"""
	Return pool with project-type-scoped statuses removed when they don't match pt.
	- If pt is empty -> return pool unchanged (global / context-free query).
	- If pt is given -> drop statuses whose scope set doesn't include pt.
	"""
	pt = str(project_type or "").strip()
	if not pt or not pool:
		return list(pool or [])
	out: list[str] = []
	for s in pool:
		key = str(s or "").strip()
		scope = _STATUS_PROJECT_TYPE_SCOPE.get(key)
		if scope is None or pt in scope:
			out.append(s)
	return out


def _get_status_config_map() -> dict[str, list[str]]:
	try:
		raw = frappe.defaults.get_global_default(DEFAULT_KEY_PROJECT_TYPE_STATUS_CONFIG)
	except Exception:
		raw = None
	if not raw:
		return {}
	try:
		val = frappe.parse_json(raw)
		if isinstance(val, dict):
			out: dict[str, list[str]] = {}
			for k, v in val.items():
				pt = str(k or "").strip()
				if not pt:
					continue
				if isinstance(v, list):
					out[pt] = [str(x).strip() for x in v if str(x).strip()]
			return out
	except Exception:
		return {}
	return {}


def _set_status_config_map(cfg: dict[str, list[str]]) -> None:
	try:
		frappe.defaults.set_global_default(DEFAULT_KEY_PROJECT_TYPE_STATUS_CONFIG, frappe.as_json(cfg))
	except Exception:
		frappe.defaults.set_global_default(DEFAULT_KEY_PROJECT_TYPE_STATUS_CONFIG, str(cfg))


def _get_saved_order() -> list[str]:
	try:
		raw = frappe.defaults.get_global_default(DEFAULT_KEY_PROJECT_TYPE_ORDER)
	except Exception:
		raw = None
	if not raw:
		return []
	try:
		val = frappe.parse_json(raw)
		if isinstance(val, list):
			return [str(x).strip() for x in val if str(x).strip()]
	except Exception:
		return []
	return []


def _set_saved_order(order: list[str]) -> None:
	# Store as JSON string in global defaults
	try:
		frappe.defaults.set_global_default(DEFAULT_KEY_PROJECT_TYPE_ORDER, frappe.as_json(order))
	except Exception:
		# Fallback: set as plain JSON string
		frappe.defaults.set_global_default(DEFAULT_KEY_PROJECT_TYPE_ORDER, str(order))


def _merge_order(saved: list[str], all_types: list[str]) -> list[str]:
	seen = set()
	out: list[str] = []
	for n in saved or []:
		if n in seen:
			continue
		if n in all_types:
			out.append(n)
			seen.add(n)
	for n in all_types:
		if n in seen:
			continue
		out.append(n)
		seen.add(n)
	return out


@frappe.whitelist()
def get_project_types() -> dict:
	"""Return ordered Project Types for the Smart Board sidebar."""
	_ensure_logged_in()
	all_types = _get_all_project_types()
	saved = _get_saved_order()
	ordered = _merge_order(saved, all_types)
	return {"items": [{"name": n} for n in ordered]}


@frappe.whitelist()
def get_project_type_order() -> dict:
	"""Return current saved order (for the Board Settings UI)."""
	_ensure_logged_in()
	all_types = _get_all_project_types()
	saved = _get_saved_order()
	ordered = _merge_order(saved, all_types)
	return {
		"order": ordered,
		"all": all_types,
		"meta": {"key": DEFAULT_KEY_PROJECT_TYPE_ORDER},
	}


@frappe.whitelist()
def set_project_type_order(order: Any = None) -> dict:
	"""
	Set Project Type ordering.
	order: list[str] or JSON string list
	"""
	_ensure_logged_in()
	_ensure_can_manage_board_settings()

	val = order
	if isinstance(val, str):
		try:
			val = frappe.parse_json(val)
		except Exception:
			val = None
	if not isinstance(val, list):
		frappe.throw("order must be a list")

	all_types = _get_all_project_types()
	all_set = set(all_types)
	clean = []
	seen = set()
	for x in val:
		n = str(x).strip()
		if not n or n in seen:
			continue
		if n not in all_set:
			continue
		clean.append(n)
		seen.add(n)

	# Persist only explicit ordering; unlisted types will be appended automatically.
	_set_saved_order(clean)
	return {"ok": True, "saved_count": len(clean)}


@frappe.whitelist()
def get_project_type_status_config(project_type: str | None = None) -> dict:
	"""
	Get status pool + board-specific allowed statuses for a Project Type.
	- pool: all statuses from Project.status options
	- allowed: saved subset for this project_type (empty => not configured)
	"""
	_ensure_logged_in()
	pt = str(project_type or "").strip()
	pool = _filter_pool_for_project_type(_get_project_status_pool(), pt)
	cfg = _get_status_config_map()
	allowed = cfg.get(pt) if pt else None
	allowed_list = [str(x).strip() for x in (allowed or []) if str(x).strip()]
	# Drop any previously-saved entries that are now out of scope for this type
	# (e.g. admin switched scoping rules, or this board was pre-frozen with a
	# broader set). The saved config is the source of truth ONLY within scope.
	if allowed_list and pool:
		pool_set = set(pool)
		allowed_list = [s for s in allowed_list if s in pool_set]
	return {
		"project_type": pt,
		"pool": pool,
		"allowed": allowed_list,
		"configured": bool(allowed_list),
		"meta": {"key": DEFAULT_KEY_PROJECT_TYPE_STATUS_CONFIG},
	}


@frappe.whitelist()
def set_project_type_status_config(project_type: str | None = None, statuses: Any = None) -> dict:
	"""
	Set board status subset for a Project Type.
	statuses: list[str] or JSON string list
	Behavior:
	- If statuses is empty OR equals pool => clear config (board uses full pool)
	"""
	_ensure_logged_in()
	_ensure_can_manage_board_settings()

	pt = str(project_type or "").strip()
	if not pt:
		frappe.throw("project_type is required")

	val = statuses
	if isinstance(val, str):
		try:
			val = frappe.parse_json(val)
		except Exception:
			val = None
	if not isinstance(val, list):
		frappe.throw("statuses must be a list")

	pool = _filter_pool_for_project_type(_get_project_status_pool(), pt)
	pool_set = set(pool)
	clean: list[str] = []
	seen = set()
	for x in val:
		s = str(x or "").strip()
		if not s or s in seen:
			continue
		# keep only statuses that are in scope for this Project Type
		# (also blocks typos automatically)
		if pool_set and s not in pool_set:
			continue
		clean.append(s)
		seen.add(s)

	# Must keep at least 1 if user is explicitly configuring
	if not clean:
		# Clearing config => board falls back to full pool
		cfg = _get_status_config_map()
		if pt in cfg:
			cfg.pop(pt, None)
			_set_status_config_map(cfg)
		return {"ok": True, "cleared": True, "saved_count": 0}

	# If identical to pool, treat as "no custom config"
	# NOTE: treat "all selected" as "no custom config", regardless of order.
	# Order can differ between UI selection and DocType meta pool order.
	if pool and set(clean) == pool_set:
		cfg = _get_status_config_map()
		if pt in cfg:
			cfg.pop(pt, None)
			_set_status_config_map(cfg)
		return {"ok": True, "cleared": True, "saved_count": 0}

	cfg = _get_status_config_map()
	cfg[pt] = clean
	_set_status_config_map(cfg)
	return {"ok": True, "cleared": False, "saved_count": len(clean)}


# ============================================================
# Special-rule toggles
# ============================================================

def _normalize_special_rule_key(key: Any) -> str:
	k = str(key or "").strip().lower().replace("-", "_")
	if k not in _SPECIAL_RULE_ALLOWED_KEYS:
		frappe.throw(f"Unknown special rule: {key}")
	return k


def _storage_key_for_special_rule(key: str) -> str:
	return f"{_SPECIAL_RULE_KEY_PREFIX}{key}"


def _coerce_bool_flag(raw: Any, default: bool = True) -> bool:
	"""Parse a stored flag value. Unset/None -> default (True)."""
	if raw is None:
		return default
	s = str(raw).strip().lower()
	if not s:
		return default
	if s in ("0", "false", "off", "no", "disabled"):
		return False
	return True


def get_special_rule_enabled(key: str) -> bool:
	"""Internal helper: read a special-rule flag. Defaults to True when unset."""
	try:
		k = _normalize_special_rule_key(key)
		raw = frappe.defaults.get_global_default(_storage_key_for_special_rule(k))
	except Exception:
		return True
	return _coerce_bool_flag(raw, default=True)


@frappe.whitelist()
def get_special_rule_flag(key: str | None = None) -> dict:
	"""Return {key, enabled} for a known special rule. Defaults to enabled=True."""
	_ensure_logged_in()
	k = _normalize_special_rule_key(key)
	return {"key": k, "enabled": get_special_rule_enabled(k)}


@frappe.whitelist()
def set_special_rule_flag(key: str | None = None, enabled: Any = None) -> dict:
	"""Set a special-rule flag. Requires board-settings permission."""
	_ensure_logged_in()
	_ensure_can_manage_board_settings()
	k = _normalize_special_rule_key(key)
	val = _coerce_bool_flag(enabled, default=True)
	frappe.defaults.set_global_default(
		_storage_key_for_special_rule(k),
		"1" if val else "0",
	)
	return {"ok": True, "key": k, "enabled": val}
