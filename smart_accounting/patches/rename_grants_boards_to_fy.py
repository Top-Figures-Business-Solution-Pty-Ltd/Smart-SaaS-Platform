# -*- coding: utf-8 -*-
"""
Rename the four Smart Grants year boards: "Grants 20XX" -> "FY 20XX".

Rationale: the board name should represent the *financial year a project falls in*,
while the per-row "FY/CY" field represents the client's own project FY/CY. Using
"FY 20XX" for the board removes the ambiguity between the two.

What this does (idempotent):
1. Renames the Project Type docs. Project.project_type is a Link field, so Frappe's
   rename_doc cascades the new value onto every project automatically.
2. Saved View.project_type is a Data field (not a Link) and the board filter also
   lives inside the filters JSON ([["project_type","=",pt]] + ui.pinned_project_type),
   so rename_doc cannot touch them — we remap both here.
3. Board Automation rules may pin a board via a project_type_is condition stored in
   the trigger_config / actions JSON — remap those defensively too.

Runs before fixtures sync, so project_type.json (already updated to the FY names)
upserts the renamed boards as a no-op afterwards.
"""

import frappe

RENAME = {
    "Grants 2024": "FY 2024",
    "Grants 2025": "FY 2025",
    "Grants 2026": "FY 2026",
    "Grants 2027": "FY 2027",
}


def _remap_json(raw, mapping):
    """Return a new JSON string with any string value found in `mapping` replaced,
    or None when nothing changed / the value isn't parseable JSON."""
    if not raw:
        return None
    try:
        data = frappe.parse_json(raw)
    except Exception:
        return None
    changed = {"v": False}

    def walk(x):
        if isinstance(x, list):
            return [walk(i) for i in x]
        if isinstance(x, dict):
            return {k: walk(v) for k, v in x.items()}
        if isinstance(x, str) and x in mapping:
            changed["v"] = True
            return mapping[x]
        return x

    new = walk(data)
    return frappe.as_json(new) if changed["v"] else None


def execute():
    # 1) Rename Project Type docs (cascades Project.project_type Link automatically).
    for old, new in RENAME.items():
        old_exists = frappe.db.exists("Project Type", old)
        new_exists = frappe.db.exists("Project Type", new)
        if old_exists and not new_exists:
            frappe.rename_doc("Project Type", old, new, force=True)
        elif old_exists and new_exists:
            # Defensive (partial re-run): move stragglers onto the new board.
            frappe.db.sql(
                "update `tabProject` set project_type=%s where project_type=%s",
                (new, old),
            )

    # 2) Saved Views: project_type (Data) + filters JSON.
    if frappe.db.exists("DocType", "Saved View"):
        for nm in frappe.get_all("Saved View", pluck="name"):
            row = frappe.db.get_value(
                "Saved View", nm, ["project_type", "filters"], as_dict=True
            ) or {}
            update = {}
            pt = (row.get("project_type") or "").strip()
            if pt in RENAME:
                update["project_type"] = RENAME[pt]
            new_filters = _remap_json(row.get("filters"), RENAME)
            if new_filters is not None:
                update["filters"] = new_filters
            if update:
                frappe.db.set_value("Saved View", nm, update, update_modified=False)

    # 3) Board Automation rules: project_type pinned inside trigger_config / actions.
    if frappe.db.exists("DocType", "Board Automation"):
        for nm in frappe.get_all("Board Automation", pluck="name"):
            row = frappe.db.get_value(
                "Board Automation", nm, ["trigger_config", "actions"], as_dict=True
            ) or {}
            update = {}
            tc = _remap_json(row.get("trigger_config"), RENAME)
            if tc is not None:
                update["trigger_config"] = tc
            ac = _remap_json(row.get("actions"), RENAME)
            if ac is not None:
                update["actions"] = ac
            if update:
                frappe.db.set_value("Board Automation", nm, update, update_modified=False)

    frappe.db.commit()
