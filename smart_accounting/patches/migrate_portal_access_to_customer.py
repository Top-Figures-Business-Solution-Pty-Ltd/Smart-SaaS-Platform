# -*- coding: utf-8 -*-
"""
Lift existing Portal Access data from Projects up to the Customer (new source of
truth), then fan the canonical values back out to all of that customer's projects
so every board mirror is consistent.

Conflict rule (per user): when a customer's projects hold different values, the
most-recently-modified project that has any portal value wins, and BOTH fields
are taken from that single project (kept as a pair).

Idempotent: re-running converges to the same state.
"""

import frappe

PORTAL_FIELDS = ["custom_portal_access_received", "custom_portal_access_expiry_date"]


def execute():
    # Patches run before fixtures sync, so make sure the fields exist first.
    try:
        from smart_accounting.setup.grants_provision import ensure_portal_access_fields
        ensure_portal_access_fields()
    except Exception:
        # If provisioning fails we cannot safely migrate; bail out quietly.
        return

    if not frappe.db.has_column("Customer", "custom_portal_access_expiry_date"):
        return

    customers = frappe.get_all("Customer", pluck="name")
    for cust in customers:
        projs = frappe.get_all(
            "Project",
            filters={"customer": cust},
            fields=["name", "modified"] + PORTAL_FIELDS,
            order_by="modified desc",
        )
        if not projs:
            continue

        canonical = None
        for p in projs:
            if p.get("custom_portal_access_expiry_date") or int(p.get("custom_portal_access_received") or 0):
                canonical = p
                break
        if not canonical:
            continue

        vals = {
            "custom_portal_access_received": int(canonical.get("custom_portal_access_received") or 0),
            "custom_portal_access_expiry_date": canonical.get("custom_portal_access_expiry_date"),
        }

        # 1) Customer = source of truth
        cur_c = frappe.db.get_value("Customer", cust, PORTAL_FIELDS, as_dict=True) or {}
        c_diff = {f: v for f, v in vals.items() if cur_c.get(f) != v}
        if c_diff:
            frappe.db.set_value("Customer", cust, c_diff, update_modified=False)

        # 2) Fan out to all of this customer's projects
        for p in projs:
            diff = {f: v for f, v in vals.items() if p.get(f) != v}
            if diff:
                frappe.db.set_value("Project", p["name"], diff, update_modified=False)

    frappe.db.commit()
