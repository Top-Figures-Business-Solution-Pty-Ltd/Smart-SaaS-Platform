# -*- coding: utf-8 -*-
"""
Roll Over / Duplicate projects (website-safe).

Used by the Smart Board "Roll Over" bulk action: take selected projects and create
copies, carrying over a user-chosen set of field values, optionally onto a different
board (Project Type), with project-level fields reset.

Smart Grants use case: copy a year board's projects onto the next year board,
keeping the fixed client info and dropping project-level progress values.
(Smart Accounting roll-over — same board, fiscal year +1 — will reuse this API.)

Security:
- Only fields in ALLOWED_CARRY_FIELDS may be copied or overridden.
- Source must be readable; new docs go through normal insert() permission checks.
"""

from __future__ import annotations

import re
from typing import Any

import frappe
from frappe.utils import today

from .project_board import _ensure_logged_in, _normalize_list

# Project fields that may be carried/overridden during a roll over. Anything not
# listed is silently ignored (never blindly copy arbitrary fields from the client).
ALLOWED_CARRY_FIELDS = {
    # shared / accounting
    "priority",
    "custom_entity_type",
    "custom_customer_entity",
    "custom_project_frequency",
    "custom_target_month",
    "custom_year_end",
    "custom_engagement_letter",
    "estimated_costing",
    "notes",
    # grants client info (fixed year-to-year)
    "custom_grants_fy_label",
    "custom_grants_abn_snapshot",
    "custom_grants_state",
    "custom_grants_industry_category",
    "custom_grants_type",
    "custom_grants_priority",
    "custom_grants_partner_label",
    "custom_grants_referral_text",
    "custom_grants_owner_name",
    "custom_grants_address_snapshot",
    "custom_grants_contact_name",
    "custom_grants_primary_communication",
    "custom_tg_tax_agent",
    "custom_portal_access_received",
    "custom_portal_access_expiry_date",
    # grants project-level (carried only if the user explicitly ticks them)
    "custom_grants_status",
    "custom_ap_submit_date",
    "custom_industry_approval_date",
    "custom_tax_lodgement_date",
    "custom_rebate_amount_text",
    "custom_fee_percentage_text",
}

# Child tables that may be copied.
CARRY_CHILD_TABLES = {"custom_team_members", "custom_softwares"}

# Always carried (identity / mandatory), regardless of the carry list.
_ALWAYS_CARRY = ("customer", "company", "custom_fiscal_year")

# Overrides are allowed for carry fields plus these structural ones.
_OVERRIDE_EXTRA = {"custom_fiscal_year", "project_name", "project_type"}

_FY_TAG_RE = re.compile(r"\s*\((?:FY|CY|Grants)\s*\d{2,4}\)\s*$", re.IGNORECASE)


def _strip_trailing_tag(name: str) -> str:
    """Remove a trailing ' (FY 2027)'-style tag so repeated roll overs don't stack."""
    prev = None
    out = str(name or "")
    while prev != out:
        prev = out
        out = _FY_TAG_RE.sub("", out).strip()
    return out


def _parse_obj(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = frappe.parse_json(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


@frappe.whitelist()
def roll_over_projects(
    source_names: Any = None,
    target_project_type: str | None = None,
    carry_fields: Any = None,
    overrides: Any = None,
    name_suffix: str | None = None,
    reset_status: str | None = "Not started",
) -> dict:
    """
    Create roll-over copies of the given projects.

    Args:
        source_names: list (or JSON) of Project names to roll over.
        target_project_type: board to create the copies on; defaults to each
            source's own board (same-board duplicate).
        carry_fields: list (or JSON) of field/child-table names to copy. Anything
            not in ALLOWED_CARRY_FIELDS / CARRY_CHILD_TABLES is ignored.
        overrides: dict (or JSON) of field -> value applied AFTER carry (e.g.
            {"custom_grants_fy_label": "FY27"}).
        name_suffix: appended to the (tag-stripped) source project_name.
        reset_status: status for the new docs (default "Not started").

    Returns: {"created": [...], "errors": [...], "count": n}
    """
    _ensure_logged_in()

    names = [str(n).strip() for n in _normalize_list(source_names) if str(n).strip()]
    if not names:
        frappe.throw("No source projects provided")

    carry = {str(f).strip() for f in _normalize_list(carry_fields) if str(f).strip()}
    carry_simple = carry & ALLOWED_CARRY_FIELDS
    carry_children = carry & CARRY_CHILD_TABLES

    ov_raw = _parse_obj(overrides)
    ov = {k: v for k, v in ov_raw.items() if k in ALLOWED_CARRY_FIELDS or k in _OVERRIDE_EXTRA}

    target_pt = str(target_project_type or "").strip()
    suffix = str(name_suffix or "").strip()
    status_value = str(reset_status or "").strip() or "Not started"

    created: list[dict] = []
    errors: list[dict] = []

    for name in names:
        try:
            src = frappe.get_doc("Project", name)
            if not src.has_permission("read"):
                raise frappe.PermissionError("Not permitted to read source project")

            new = frappe.new_doc("Project")

            # Identity / mandatory
            for f in _ALWAYS_CARRY:
                new.set(f, src.get(f))
            new.project_type = target_pt or src.get("project_type")
            new.status = status_value

            # Name = source name (without any trailing FY tag) + suffix
            base = _strip_trailing_tag(src.get("project_name") or "") or (src.get("project_name") or "")
            new.project_name = (base + ((" " + suffix) if suffix else "")).strip() or base

            # Carry simple fields
            for f in carry_simple:
                new.set(f, src.get(f))

            # Carry child tables
            if "custom_team_members" in carry_children:
                for m in (src.get("custom_team_members") or []):
                    user = str(getattr(m, "user", "") or "").strip()
                    if not user:
                        continue
                    new.append(
                        "custom_team_members",
                        {
                            "user": user,
                            "role": str(getattr(m, "role", "") or "").strip() or "Preparer",
                            "assigned_date": today(),
                        },
                    )
            if "custom_softwares" in carry_children:
                for s in (src.get("custom_softwares") or []):
                    sw = str(getattr(s, "software", "") or getattr(s, "software_name", "") or "").strip()
                    if sw:
                        new.append("custom_softwares", {"software": sw})

            # Overrides win over carry
            for k, v in ov.items():
                new.set(k, v)

            new.insert()
            created.append(
                {
                    "name": new.name,
                    "project_name": new.project_name,
                    "project_type": new.get("project_type"),
                    "source": name,
                }
            )
        except Exception as e:
            errors.append({"source": name, "error": str(e)})

    if created:
        frappe.db.commit()

    return {"created": created, "errors": errors, "count": len(created)}
