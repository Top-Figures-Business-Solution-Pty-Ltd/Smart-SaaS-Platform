# -*- coding: utf-8 -*-
"""
Clear out-of-range values from the grants Select fields on Project.

Background:
- ``custom_grants_priority`` and ``custom_grants_type`` live on the global Project
  DocType (they apply to every project, not just Smart Grants boards).
- The priority options were changed from Urgent/High/Medium/Low to S1-S4. When the
  field was first added it stamped a value onto pre-existing rows, so projects on
  *any* board (including Smart Accounting, e.g. Ad-Hoc) can still hold a now-invalid
  value like "Urgent". Frappe validates Select fields on every save, so archiving
  or editing such a project fails with "Grants Priority cannot be 'Urgent'...".

Fix:
- Null out any value that is no longer one of the allowed options. This unblocks
  Smart Accounting saves and clears stale grants values that no longer mean anything.
- Direct DB writes bypass document validation (which is exactly what we want for a
  one-off data fix) and never touch the modified timestamp.

Idempotent: re-running is a no-op once values are clean.
"""

import frappe

ALLOWED = {
    "custom_grants_priority": ("S1", "S2", "S3", "S4"),
    "custom_grants_type": ("R&DTI", "EMDG"),
}


def execute():
    for field, allowed in ALLOWED.items():
        if not frappe.db.has_column("Project", field):
            continue
        placeholders = ", ".join(["%s"] * len(allowed))
        frappe.db.sql(
            """
            update `tabProject`
            set `{field}` = NULL
            where `{field}` is not null
              and `{field}` != ''
              and `{field}` not in ({placeholders})
            """.format(field=field, placeholders=placeholders),
            tuple(allowed),
        )
    frappe.db.commit()
