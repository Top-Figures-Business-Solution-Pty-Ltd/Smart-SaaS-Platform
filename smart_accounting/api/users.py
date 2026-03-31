"""
Users APIs (website-safe)
"""

from __future__ import annotations

from importlib import import_module
from typing import Any

import frappe

SMART_ACCOUNTING_ROLE = "Smart Accounting User"
SMART_GRANTS_ROLE = "Smart Grants User"
MANAGED_MODULE_ROLES = (SMART_ACCOUNTING_ROLE, SMART_GRANTS_ROLE)


def _ensure_logged_in() -> None:
	if frappe.session.user in (None, "", "Guest"):
		frappe.throw("Not permitted", frappe.PermissionError)


def _normalize_int(v: Any, default: int) -> int:
	try:
		return int(v)
	except Exception:
		return int(default)


def _normalize_bool(v: Any, default: bool = False) -> bool:
	if v is None:
		return bool(default)
	if isinstance(v, bool):
		return v
	text = str(v).strip().lower()
	if text in {"1", "true", "yes", "on"}:
		return True
	if text in {"0", "false", "no", "off", ""}:
		return False
	return bool(v)


def _parse_payload(payload: dict | str | None = None) -> dict[str, Any]:
	if isinstance(payload, str):
		try:
			data = frappe.parse_json(payload) or {}
		except Exception:
			data = {}
	else:
		data = payload or {}
	return data if isinstance(data, dict) else {}


def _is_admin_like(user: str | None = None) -> bool:
	username = str(user or frappe.session.user or "").strip()
	if not username:
		return False
	if username == "Administrator":
		return True
	try:
		roles = frappe.get_roles(username) or []
	except Exception:
		roles = []
	return "System Manager" in {str(r or "").strip() for r in roles}


def _ensure_user_admin() -> None:
	_ensure_logged_in()
	if not _is_admin_like():
		frappe.throw("Not permitted", frappe.PermissionError)


def _split_full_name(full_name: str | None = None) -> tuple[str, str]:
	text = str(full_name or "").strip()
	if not text:
		return ("", "")
	parts = text.split()
	if len(parts) <= 1:
		return (text, "")
	return (parts[0], " ".join(parts[1:]))


def _get_module_role_map(usernames: list[str] | None = None) -> dict[str, set[str]]:
	names = [str(x or "").strip() for x in (usernames or []) if str(x or "").strip()]
	if not names:
		return {}
	try:
		rows = frappe.get_all(
			"Has Role",
			filters=[["parent", "in", names], ["role", "in", list(MANAGED_MODULE_ROLES)]],
			fields=["parent", "role"],
			limit_page_length=min(1000, max(50, len(names) * 4)),
			ignore_permissions=True,
		)
	except Exception:
		rows = []
	out: dict[str, set[str]] = {name: set() for name in names}
	for row in rows or []:
		parent = str(row.get("parent") or "").strip()
		role = str(row.get("role") or "").strip()
		if parent and role:
			out.setdefault(parent, set()).add(role)
	return out


def _serialize_user(row: dict[str, Any], role_map: dict[str, set[str]] | None = None) -> dict[str, Any]:
	name = str(row.get("name") or "").strip()
	email = str(row.get("email") or "").strip() or name
	full_name = str(row.get("full_name") or "").strip() or email or name
	roles = set((role_map or {}).get(name) or set())
	locked = name == "Administrator"
	return {
		"name": name,
		"full_name": full_name,
		"email": email,
		"enabled": int(row.get("enabled") or 0),
		"user_image": str(row.get("user_image") or "").strip(),
		"smart_accounting_access": SMART_ACCOUNTING_ROLE in roles,
		"smart_grants_access": SMART_GRANTS_ROLE in roles,
		"locked": 1 if locked else 0,
	}


def _sync_module_roles(doc, *, accounting_access: bool, grants_access: bool) -> None:
	desired = set()
	if accounting_access:
		desired.add(SMART_ACCOUNTING_ROLE)
	if grants_access:
		desired.add(SMART_GRANTS_ROLE)

	existing_rows = list(doc.get("roles") or [])
	for row in list(existing_rows):
		role = str(getattr(row, "role", "") or "").strip()
		if role in MANAGED_MODULE_ROLES and role not in desired:
			try:
				doc.get("roles").remove(row)
			except Exception:
				pass

	current_roles = {str(getattr(r, "role", "") or "").strip() for r in (doc.get("roles") or [])}
	for role in sorted(desired):
		if role in current_roles:
			continue
		doc.append("roles", {"role": role})


def _set_user_password(user: str, new_password: str) -> None:
	mod = import_module("frappe.utils.password")
	update_password = getattr(mod, "update_password")
	update_password(user=user, pwd=new_password, logout_all_sessions=False)


@frappe.whitelist()
def get_users(search: str | None = None, limit_start: int = 0, limit_page_length: int = 100) -> dict:
	"""
	List system users for the product shell.

	Returns:
	- items: [{name, full_name, email, enabled}]
	"""
	_ensure_logged_in()

	q = str(search or "").strip()
	limit_start = max(0, _normalize_int(limit_start, 0))
	limit_page_length = max(1, min(200, _normalize_int(limit_page_length, 100)))

	filters: list[list[Any]] = [["name", "!=", "Guest"], ["user_type", "=", "System User"]]
	or_filters: list[list[Any]] = []
	if q:
		like = f"%{q}%"
		or_filters = [
			["name", "like", like],
			["email", "like", like],
			["full_name", "like", like],
		]

	rows = frappe.get_all(
		"User",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "full_name", "email", "enabled", "user_image"],
		order_by="enabled desc, full_name asc, name asc",
		limit_start=limit_start,
		limit_page_length=limit_page_length,
		ignore_permissions=True,
	)

	role_map = _get_module_role_map([row.get("name") for row in (rows or []) if row.get("name")])
	items = []
	for row in rows or []:
		if not str(row.get("name") or "").strip():
			continue
		items.append(_serialize_user(row, role_map))

	total_rows = frappe.get_all(
		"User",
		filters=filters,
		or_filters=or_filters,
		fields=["count(name) as cnt"],
		limit_page_length=1,
		ignore_permissions=True,
	)
	try:
		total_count = int((total_rows or [{}])[0].get("cnt") or 0)
	except Exception:
		total_count = len(items)

	return {
		"items": items,
		"meta": {
			"total_count": total_count,
			"returned_count": len(items),
			"limit_start": limit_start,
			"limit_page_length": limit_page_length,
			"can_manage_users": _is_admin_like(),
		},
	}


@frappe.whitelist()
def create_user(payload: dict | str | None = None) -> dict:
	_ensure_user_admin()
	data = _parse_payload(payload)

	email = str(data.get("email") or "").strip().lower()
	full_name = str(data.get("full_name") or "").strip()
	password = str(data.get("password") or "")
	enabled = _normalize_bool(data.get("enabled"), True)
	accounting_access = _normalize_bool(data.get("smart_accounting_access"), False)
	grants_access = _normalize_bool(data.get("smart_grants_access"), False)

	if not email:
		frappe.throw("Email is required")
	if not full_name:
		frappe.throw("Full name is required")
	if not password:
		frappe.throw("Password is required")
	if frappe.db.exists("User", email):
		frappe.throw("User already exists")

	first_name, last_name = _split_full_name(full_name)
	if not first_name:
		frappe.throw("Full name is required")

	doc = frappe.get_doc(
		{
			"doctype": "User",
			"name": email,
			"email": email,
			"enabled": 1 if enabled else 0,
			"first_name": first_name,
			"last_name": last_name or None,
			"user_type": "System User",
			"send_welcome_email": 0,
		}
	)
	doc.flags.no_welcome_mail = True
	doc.insert(ignore_permissions=True)
	_sync_module_roles(
		doc,
		accounting_access=accounting_access,
		grants_access=grants_access,
	)
	doc.save(ignore_permissions=True)
	_set_user_password(doc.name, password)
	doc.reload()

	role_map = _get_module_role_map([doc.name])
	return {"item": _serialize_user(doc.as_dict(), role_map)}


@frappe.whitelist()
def update_user(payload: dict | str | None = None) -> dict:
	_ensure_user_admin()
	data = _parse_payload(payload)

	name = str(data.get("name") or "").strip()
	full_name = str(data.get("full_name") or "").strip()
	enabled_provided = "enabled" in data
	accounting_provided = "smart_accounting_access" in data
	grants_provided = "smart_grants_access" in data

	if not name:
		frappe.throw("User is required")
	if name == "Guest":
		frappe.throw("Not permitted", frappe.PermissionError)

	doc = frappe.get_doc("User", name)
	if name == "Administrator":
		frappe.throw("Administrator cannot be edited here")

	if full_name:
		first_name, last_name = _split_full_name(full_name)
		if not first_name:
			frappe.throw("Full name is required")
		doc.first_name = first_name
		doc.last_name = last_name or None

	if enabled_provided:
		doc.enabled = 1 if _normalize_bool(data.get("enabled"), True) else 0

	if accounting_provided or grants_provided:
		current_roles = {str(getattr(r, "role", "") or "").strip() for r in (doc.get("roles") or [])}
		_sync_module_roles(
			doc,
			accounting_access=_normalize_bool(
				data.get("smart_accounting_access"),
				SMART_ACCOUNTING_ROLE in current_roles,
			),
			grants_access=_normalize_bool(
				data.get("smart_grants_access"),
				SMART_GRANTS_ROLE in current_roles,
			),
		)

	doc.save(ignore_permissions=True)
	doc.reload()
	role_map = _get_module_role_map([doc.name])
	return {"item": _serialize_user(doc.as_dict(), role_map)}


@frappe.whitelist()
def set_user_password(payload: dict | str | None = None) -> dict:
	_ensure_user_admin()
	data = _parse_payload(payload)

	name = str(data.get("name") or "").strip()
	new_password = str(data.get("new_password") or "")
	if not name:
		frappe.throw("User is required")
	if not new_password:
		frappe.throw("New password is required")
	if name == "Guest":
		frappe.throw("Not permitted", frappe.PermissionError)

	_set_user_password(name, new_password)
	return {"ok": True}
