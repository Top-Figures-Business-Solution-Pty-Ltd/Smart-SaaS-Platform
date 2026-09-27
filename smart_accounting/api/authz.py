# -*- coding: utf-8 -*-
"""Shared API authorization helpers for Smart Accounting website APIs."""

from __future__ import annotations

import frappe


ADMIN_LIKE_ROLES = {"System Manager", "Automation Manager"}


def ensure_logged_in() -> None:
	if frappe.session.user in (None, "", "Guest"):
		frappe.throw("Not permitted", frappe.PermissionError)


def is_admin_like(user: str | None = None, extra_roles: set[str] | None = None) -> bool:
	username = str(user or frappe.session.user or "").strip()
	if username == "Administrator":
		return True
	if not username or username == "Guest":
		return False
	try:
		roles = {str(r or "").strip() for r in (frappe.get_roles(username) or [])}
	except Exception:
		roles = set()
	allowed = set(ADMIN_LIKE_ROLES)
	if extra_roles:
		allowed.update(str(r or "").strip() for r in extra_roles if str(r or "").strip())
	return bool(roles.intersection(allowed))


def ensure_admin_like(extra_roles: set[str] | None = None) -> None:
	ensure_logged_in()
	if not is_admin_like(extra_roles=extra_roles):
		frappe.throw("Not permitted", frappe.PermissionError)


def has_http_request() -> bool:
	return getattr(frappe.local, "request", None) is not None


def ensure_admin_for_http_request(extra_roles: set[str] | None = None) -> None:
	if has_http_request():
		ensure_admin_like(extra_roles=extra_roles)
