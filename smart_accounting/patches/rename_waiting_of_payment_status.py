# -*- coding: utf-8 -*-
"""
Fix the status typo: "Waiting of payment" -> "Waiting for payment".

The status pool (Property Setter) is corrected via fixtures; this patch renames
the value on any existing Project that still uses the old spelling so the data
stays consistent on prod after the GitHub deploy. Idempotent.
"""

import frappe

OLD = "Waiting of payment"
NEW = "Waiting for payment"


def execute():
    if not frappe.db.has_column("Project", "status"):
        return
    rows = frappe.get_all("Project", filters={"status": OLD}, pluck="name")
    for name in rows:
        frappe.db.set_value("Project", name, "status", NEW, update_modified=False)
    if rows:
        frappe.db.commit()
