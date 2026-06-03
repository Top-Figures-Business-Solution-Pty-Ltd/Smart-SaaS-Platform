# -*- coding: utf-8 -*-
"""
Customer doc_events for Smart Grants.

Portal access (received flag + expiry date) is stored on the Customer as the
source of truth. When it changes on the Customer, fan the values out to every
Project of that customer so board mirrors stay consistent.
"""

import frappe

PORTAL_FIELDS = ("custom_portal_access_received", "custom_portal_access_expiry_date")


def _portal_equal(field, a, b) -> bool:
    if field == "custom_portal_access_received":
        try:
            return bool(int(a or 0)) == bool(int(b or 0))
        except Exception:
            return bool(a) == bool(b)
    try:
        from frappe.utils import getdate
        da = getdate(a) if a not in (None, "") else None
        db_ = getdate(b) if b not in (None, "") else None
        return da == db_
    except Exception:
        return str(a or "") == str(b or "")


def sync_portal_access_to_projects(doc, method=None):
    """on_update handler: propagate changed portal-access fields to the customer's projects."""
    if frappe.flags.get("_sb_portal_sync"):
        return

    changed = {}
    for f in PORTAL_FIELDS:
        try:
            if doc.has_value_changed(f):
                changed[f] = doc.get(f)
        except Exception:
            continue
    if not changed:
        return

    frappe.flags["_sb_portal_sync"] = True
    try:
        names = frappe.get_all("Project", filters={"customer": doc.name}, pluck="name")
        for name in names:
            cur = frappe.db.get_value("Project", name, list(changed.keys()), as_dict=True) or {}
            diff = {f: v for f, v in changed.items() if not _portal_equal(f, cur.get(f), v)}
            if diff:
                frappe.db.set_value("Project", name, diff, update_modified=False)
    finally:
        frappe.flags["_sb_portal_sync"] = False
