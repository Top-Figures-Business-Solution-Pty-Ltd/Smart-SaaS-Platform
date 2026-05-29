# -*- coding: utf-8 -*-
"""
Remove the Smart Grants "Deliverer" field (custom_grants_deliverer) and its data.

Why:
- The Deliverer field is being retired. Removing it from provisioning/fixtures stops it being
  re-created, but existing test/prod databases still hold the Custom Field, the DB column (with
  data), and stale references in Saved View columns / the Project field_order property setter.
- This patch runs once on migrate so every environment converges after a git pull.

What it does (all idempotent / best-effort):
1. Delete the Custom Field definition `Project-custom_grants_deliverer`.
2. Drop the `custom_grants_deliverer` column from `tabProject` (this deletes the data).
3. Strip the field from any Saved View `columns` JSON.
4. Strip the field from the Project field_order property setter so the form layout stays clean.
"""

from __future__ import annotations

import frappe

FIELD = "custom_grants_deliverer"
CF_NAME = f"Project-{FIELD}"


def _strip_cols(cols):
    if not isinstance(cols, list):
        return cols, False
    out = [c for c in cols if not (isinstance(c, dict) and str(c.get("field") or "").strip() == FIELD)]
    return out, (len(out) != len(cols))


def _clean_saved_views():
    if not frappe.db.exists("DocType", "Saved View"):
        return
    rows = frappe.get_all("Saved View", fields=["name", "columns"], ignore_permissions=True, limit_page_length=100000)
    for row in (rows or []):
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        try:
            raw = frappe.parse_json(row.get("columns"))
        except Exception:
            continue
        changed = False
        if isinstance(raw, list):
            next_obj, changed = _strip_cols(raw)
        elif isinstance(raw, dict):
            proj, c1 = _strip_cols(raw.get("project") if isinstance(raw.get("project"), list) else [])
            tasks, c2 = _strip_cols(raw.get("tasks") if isinstance(raw.get("tasks"), list) else [])
            changed = c1 or c2
            next_obj = {**raw, "project": proj, "tasks": tasks}
        else:
            continue
        if changed:
            try:
                frappe.db.set_value("Saved View", name, "columns", frappe.as_json(next_obj), update_modified=False)
            except Exception:
                pass


def _clean_field_order():
    rows = frappe.get_all(
        "Property Setter",
        filters={"doc_type": "Project", "property": "field_order"},
        fields=["name", "value"],
        ignore_permissions=True,
    )
    for row in (rows or []):
        try:
            order = frappe.parse_json(row.get("value"))
        except Exception:
            continue
        if not isinstance(order, list) or FIELD not in order:
            continue
        cleaned = [f for f in order if str(f or "").strip() != FIELD]
        try:
            frappe.db.set_value("Property Setter", row.get("name"), "value", frappe.as_json(cleaned), update_modified=False)
        except Exception:
            pass


def execute():
    # 1) Delete the Custom Field definition
    if frappe.db.exists("Custom Field", CF_NAME):
        try:
            frappe.delete_doc("Custom Field", CF_NAME, force=True, ignore_permissions=True)
        except Exception:
            pass

    # 2) Drop the DB column (removes the data)
    try:
        if frappe.db.has_column("Project", FIELD):
            frappe.db.sql_ddl(f"ALTER TABLE `tabProject` DROP COLUMN `{FIELD}`")
    except Exception:
        pass

    # 3) + 4) Clean stale references
    _clean_saved_views()
    _clean_field_order()

    frappe.db.commit()
    try:
        frappe.clear_cache(doctype="Project")
    except Exception:
        pass
