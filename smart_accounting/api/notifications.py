"""
Notification APIs (website-safe)

We use Frappe's native Notification Log doctype for in-app notifications.
"""

from __future__ import annotations

from typing import Any

import frappe


def _ensure_logged_in() -> None:
	if frappe.session.user in (None, "", "Guest"):
		frappe.throw("Not permitted", frappe.PermissionError)


def _normalize_int(v: Any, default: int) -> int:
	try:
		return int(v)
	except Exception:
		return int(default)


@frappe.whitelist()
def get_my_notifications(limit_start: int = 0, limit_page_length: int = 20, unread_only: int = 0) -> dict:
	"""
	List current user's notifications (newest first).
	Returns:
	- items: [{name, subject, type, creation, read, document_type, document_name, from_user, link}]
	"""
	_ensure_logged_in()

	user = frappe.session.user
	limit_start = max(0, _normalize_int(limit_start, 0))
	limit_page_length = max(1, min(100, _normalize_int(limit_page_length, 20)))
	unread_only = 1 if _normalize_int(unread_only, 0) else 0

	filters = {"for_user": user}
	if unread_only:
		filters["read"] = 0

	rows = frappe.get_all(
		"Notification Log",
		filters=filters,
		fields=[
			"name",
			"subject",
			"type",
			"creation",
			"read",
			"document_type",
			"document_name",
			"from_user",
			"link",
		],
		order_by="creation desc",
		limit_start=limit_start,
		limit_page_length=limit_page_length,
		ignore_permissions=True,  # bounded by for_user filter
	)

	total_count = frappe.db.count("Notification Log", filters=filters)

	return {
		"items": rows or [],
		"meta": {
			"total_count": int(total_count or 0),
			"limit_start": limit_start,
			"limit_page_length": limit_page_length,
		},
	}


@frappe.whitelist()
def get_unread_count() -> dict:
	_ensure_logged_in()
	user = frappe.session.user
	cnt = frappe.db.count("Notification Log", filters={"for_user": user, "read": 0})
	return {"count": int(cnt or 0)}


@frappe.whitelist()
def mark_as_read(docname: str) -> dict:
	"""
	Mark a single notification as read (must belong to current user).
	"""
	_ensure_logged_in()
	name = str(docname or "").strip()
	if not name:
		return {"ok": 1}

	user = frappe.session.user
	owner = frappe.db.get_value("Notification Log", name, "for_user")
	if owner != user:
		frappe.throw("Not permitted", frappe.PermissionError)

	if not frappe.flags.read_only:
		frappe.db.set_value("Notification Log", name, "read", 1, update_modified=False)
	return {"ok": 1}


@frappe.whitelist()
def mark_all_as_read() -> dict:
	_ensure_logged_in()
	user = frappe.session.user
	if frappe.flags.read_only:
		return {"ok": 1}
	frappe.db.set_value(
		"Notification Log",
		{"for_user": user, "read": 0},
		"read",
		1,
		update_modified=False,
	)
	return {"ok": 1}


