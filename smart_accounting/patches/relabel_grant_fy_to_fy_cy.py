# -*- coding: utf-8 -*-
"""
Relabel the Smart Grants FY column header from "Grant FY" to "FY/CY".

Why:
- The custom field `custom_grants_fy_label` was renamed (label only) from "Grant FY" to "FY/CY".
- Existing Saved Views cache the old header text in their `columns` JSON, so boards would keep
  showing "Grant FY" until the column is re-added by hand. This patch rewrites the cached label
  once on migrate so test/prod auto-align after a git pull.

Idempotent:
- Safe to run multiple times; only touches columns whose field is `custom_grants_fy_label`.
"""

from __future__ import annotations

import frappe

OLD_LABEL = "Grant FY"
NEW_LABEL = "FY/CY"
FIELD = "custom_grants_fy_label"


def _relabel_cols(cols):
    changed = False
    if not isinstance(cols, list):
        return cols, changed
    out = []
    for c in cols:
        if isinstance(c, dict) and str(c.get("field") or "").strip() == FIELD:
            if str(c.get("label") or "").strip() != NEW_LABEL:
                c = {**c, "label": NEW_LABEL}
                changed = True
        out.append(c)
    return out, changed


def execute():
    if not frappe.db.exists("DocType", "Saved View"):
        return

    rows = frappe.get_all(
        "Saved View",
        fields=["name", "columns"],
        ignore_permissions=True,
        limit_page_length=100000,
    )

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
            next_obj, changed = _relabel_cols(raw)
        elif isinstance(raw, dict):
            proj, c1 = _relabel_cols(raw.get("project") if isinstance(raw.get("project"), list) else [])
            tasks, c2 = _relabel_cols(raw.get("tasks") if isinstance(raw.get("tasks"), list) else [])
            changed = c1 or c2
            next_obj = {**raw, "project": proj, "tasks": tasks}
        else:
            continue

        if changed:
            try:
                frappe.db.set_value("Saved View", name, "columns", frappe.as_json(next_obj), update_modified=False)
            except Exception:
                pass

    frappe.db.commit()
