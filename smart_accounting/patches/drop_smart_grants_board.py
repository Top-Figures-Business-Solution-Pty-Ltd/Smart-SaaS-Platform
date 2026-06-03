# -*- coding: utf-8 -*-
"""
Delete the legacy aggregated "Smart Grants" board (Project Type).

Projects have already been split onto the per-year boards (Grants 2024..2027).
Any project still on "Smart Grants" is moved to the Archived (Holding) placeholder
and archived by SmartProjectType.on_trash (which runs before Frappe's link check),
so deletion is safe and lossless. Saved Views pinned to the old board are
deactivated so they no longer surface anywhere.

Idempotent: if the board is already gone, this is a no-op.
"""

import frappe

LEGACY_BOARD = "Smart Grants"


def execute():
    if not frappe.db.exists("Project Type", LEGACY_BOARD):
        return

    # Ensure the holding placeholder exists before on_trash needs it
    # (patches run before fixtures sync).
    try:
        from smart_accounting.overrides.project_type import ensure_archived_holding_type
        ensure_archived_holding_type()
    except Exception:
        return

    # Deactivate orphan Saved Views pinned to the old board.
    try:
        if frappe.db.has_column("Saved View", "project_type"):
            views = frappe.get_all("Saved View", filters={"project_type": LEGACY_BOARD}, pluck="name")
            for v in views:
                update = {}
                if frappe.db.has_column("Saved View", "is_active"):
                    update["is_active"] = 0
                if frappe.db.has_column("Saved View", "is_default"):
                    update["is_default"] = 0
                if update:
                    frappe.db.set_value("Saved View", v, update, update_modified=False)
    except Exception:
        pass

    # Deleting the type triggers SmartProjectType.on_trash, which reassigns any
    # remaining projects to Archived (Holding) and removes board automations.
    frappe.delete_doc("Project Type", LEGACY_BOARD, ignore_permissions=True)
    frappe.db.commit()
