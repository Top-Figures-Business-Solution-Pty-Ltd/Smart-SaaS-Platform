# -*- coding: utf-8 -*-
"""
Make the month Select fields on Project default to *empty* instead of "January".

Background:
- ``custom_target_month`` and ``custom_year_end`` are Select fields whose options
  start with "January" (no leading blank line). Frappe treats the first option of
  such a Select as the implicit default, so EVERY new Project — and every rolled-over
  Project where the value isn't explicitly carried/set — silently gets "January".
- This is why Roll Over "Clear" appeared to produce January, and why Year End drifted
  to January in production: whenever the explicit value didn't reach the document
  (e.g. a stale JS bundle that didn't send the carry/clear payload), the first-option
  default ("January") stuck.

Fix:
- Prepend a blank line to the options so the default becomes empty. Carry/Set/Clear
  all keep working; only the "nothing was chosen" case changes (empty, not January).
- Existing project values are left untouched (a real January stays January).

Idempotent: re-running is a no-op once the blank prefix is present.
"""

import frappe

_MONTHS = (
    "January\nFebruary\nMarch\nApril\nMay\nJune\n"
    "July\nAugust\nSeptember\nOctober\nNovember\nDecember"
)
_FIELDS = ("custom_target_month", "custom_year_end")


def execute():
    desired = "\n" + _MONTHS
    for fieldname in _FIELDS:
        cf = frappe.db.get_value(
            "Custom Field",
            {"dt": "Project", "fieldname": fieldname},
            ["name", "options"],
            as_dict=True,
        )
        if not cf:
            continue
        opts = cf.get("options") or ""
        if opts.startswith("\n"):
            continue
        # Only rewrite when the current options are exactly the 12 months (no surprises).
        if opts.strip() == _MONTHS:
            frappe.db.set_value("Custom Field", cf["name"], "options", desired, update_modified=False)
    frappe.clear_cache(doctype="Project")
    frappe.db.commit()
