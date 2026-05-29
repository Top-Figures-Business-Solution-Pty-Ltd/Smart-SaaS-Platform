# -*- coding: utf-8 -*-
"""
De-duplicate Shared/default board views so each board (Project Type) has exactly ONE.

Why:
- The Smart Board relies on a single Shared + is_default Saved View per Project Type so that all
  users share the same column configuration. Client-side find-or-create raced under concurrent
  first-loads and left multiple active+default Shared views per board, making the "shared" columns
  look unstable (whichever was edited last floated to the top).

Strategy (safe / reversible):
- Group active+default Shared Project views by their pinned Project Type.
- Keep the most recently modified one as the canonical view (this is exactly what the board would
  display today), and DEMOTE the rest to is_default=0, is_active=0 (kept for history, not deleted).

Idempotent: re-running finds at most one per group and changes nothing.
"""

from __future__ import annotations

import frappe


def _infer_pinned_project_type(view: dict) -> str:
    pt = str((view or {}).get("project_type") or "").strip()
    if pt:
        return pt
    try:
        payload = frappe.parse_json((view or {}).get("filters"))
    except Exception:
        payload = None
    seq = []
    if isinstance(payload, dict):
        ui = payload.get("ui") or {}
        if isinstance(ui, dict) and ui.get("pinned_project_type"):
            return str(ui.get("pinned_project_type")).strip()
        seq = payload.get("filters") or []
    elif isinstance(payload, list):
        seq = payload
    for f in seq:
        try:
            if f[0] == "project_type" and f[1] == "=" and f[2]:
                return str(f[2]).strip()
        except Exception:
            pass
    return ""


def execute():
    if not frappe.db.exists("DocType", "Saved View"):
        return

    rows = frappe.get_all(
        "Saved View",
        filters={
            "reference_doctype": "Project",
            "scope": "Shared",
            "is_active": 1,
            "is_default": 1,
        },
        fields=["name", "project_type", "filters", "modified"],
        order_by="modified desc",
        limit_page_length=100000,
        ignore_permissions=True,
    )

    groups: dict[str, list[dict]] = {}
    for r in (rows or []):
        pt = _infer_pinned_project_type(r)
        if not pt:
            continue
        groups.setdefault(pt, []).append(r)

    demoted = 0
    for pt, items in groups.items():
        if len(items) <= 1:
            continue
        # items are already ordered modified desc -> keep items[0], demote the rest.
        for dup in items[1:]:
            frappe.db.set_value(
                "Saved View",
                dup["name"],
                {"is_default": 0, "is_active": 0},
                update_modified=False,
            )
            demoted += 1

    if demoted:
        frappe.db.commit()
