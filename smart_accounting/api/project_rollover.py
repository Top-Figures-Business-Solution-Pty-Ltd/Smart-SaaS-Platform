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
from frappe.utils import add_months, get_last_day, getdate, today

from .project_board import _ensure_logged_in, _normalize_list

# Child tables that may be copied.
CARRY_CHILD_TABLES = {"custom_team_members", "custom_softwares"}

# Always carried (identity / mandatory), regardless of the carry list.
_ALWAYS_CARRY = ("customer", "company", "custom_fiscal_year")

# Overrides are allowed for carryable fields plus these structural ones.
_OVERRIDE_EXTRA = {"custom_fiscal_year", "project_name", "project_type"}

# Never carried/overridden via roll over (identity / structural / handled elsewhere).
_DENY_FIELDS = {
    "name", "owner", "creation", "modified", "modified_by", "docstatus", "idx",
    "parent", "parentfield", "parenttype", "naming_series",
    "_user_tags", "_comments", "_assign", "_liked_by",
    "project_name", "project_type", "is_active",
    "customer", "company", "custom_fiscal_year",
    "percent_complete", "percent_complete_method", "_seen",
}

# Layout / non-data field types that can't hold a copyable scalar value.
_SKIP_FIELDTYPES = {
    "Section Break", "Column Break", "Tab Break", "HTML", "Button",
    "Heading", "Fold", "Table", "Table MultiSelect", "Image", "Geolocation",
}


def _carryable_fields() -> set:
    """All Project scalar fields a user may carry/override (minus the denylist)."""
    try:
        meta = frappe.get_meta("Project")
    except Exception:
        return set()
    out = set()
    for df in (meta.fields or []):
        fn = getattr(df, "fieldname", None)
        ft = getattr(df, "fieldtype", None)
        if not fn or fn in _DENY_FIELDS:
            continue
        if ft in _SKIP_FIELDTYPES:
            continue
        out.add(fn)
    return out

_FY_TAG_RE = re.compile(
    r"\s*\((?:(?:FY|CY|Grants)\s*\d{2,4}|\d{4}(?:-\d{2,4})?)\)\s*$",
    re.IGNORECASE,
)

# A trailing "(Roll Over)" / "(Roll Over 2)" tag added by a previous roll over.
_RO_TAG_RE = re.compile(r"\s*\(\s*roll\s*over(?:\s+\d+)?\s*\)\s*$", re.IGNORECASE)


def _strip_trailing_tag(name: str) -> str:
    """Remove trailing ' (FY 2027)' / ' (Roll Over)' tags so repeated roll overs
    don't stack the same suffix over and over."""
    prev = None
    out = str(name or "")
    while prev != out:
        prev = out
        out = _FY_TAG_RE.sub("", out).strip()
        out = _RO_TAG_RE.sub("", out).strip()
    return out


def _unique_project_name(base: str, tag: str) -> str:
    """Build a project_name from base + tag that is unique (project_name has a
    UNIQUE index). On collision a counter is folded INTO the tag, e.g.
    "Acme (Roll Over)" -> "Acme (Roll Over 2)" / "Acme (ASIC)" -> "Acme (ASIC 2)".
    """
    base = str(base or "").strip()
    tag = str(tag or "").strip()
    first = (f"{base} {tag}").strip() if tag else base
    if not first:
        first = base or "Project"
    if not frappe.db.exists("Project", {"project_name": first}):
        return first

    inner = tag[1:-1].strip() if (tag.startswith("(") and tag.endswith(")")) else tag
    n = 2
    while True:
        if inner:
            cand = (f"{base} ({inner} {n})").strip()
        else:
            cand = (f"{base} ({n})").strip()
        if not frappe.db.exists("Project", {"project_name": cand}):
            return cand
        n += 1


def _plus_one_year(value: Any) -> Any:
    """Return `value` (a date) advanced by exactly one year.

    Preserves an end-of-month date (e.g. 30 Jun -> 30 Jun next year; 28/29 Feb is
    handled by add_months). Returns None when value is empty/unparseable.
    """
    if not value:
        return None
    try:
        d = getdate(value)
    except Exception:
        return None
    nxt = add_months(d, 12)
    # Keep month-end alignment for dates that sit on the last day of the month.
    if d == get_last_day(d):
        nxt = get_last_day(nxt)
    return nxt


def _date_fields() -> set:
    """Project Date/Datetime fieldnames (targets eligible for the +1 year mode)."""
    try:
        meta = frappe.get_meta("Project")
    except Exception:
        return set()
    out = set()
    for df in (meta.fields or []):
        if getattr(df, "fieldtype", None) in ("Date", "Datetime"):
            fn = getattr(df, "fieldname", None)
            if fn:
                out.add(fn)
    return out


def _next_fiscal_year(current: str | None) -> str | None:
    """Return the Fiscal Year that immediately follows `current` (by date), or None.

    Prefers the FY whose start date is the day after `current` ends; otherwise the
    next FY by start date.
    """
    name = str(current or "").strip()
    if not name:
        return None
    row = frappe.db.get_value(
        "Fiscal Year", name, ["year_start_date", "year_end_date"], as_dict=True
    )
    if not row:
        return None
    from frappe.utils import add_days

    end = row.get("year_end_date")
    if end:
        adjacent = frappe.db.get_value(
            "Fiscal Year", {"year_start_date": add_days(end, 1)}, "name"
        )
        if adjacent:
            return adjacent
    start = row.get("year_start_date")
    if start:
        nxt = frappe.get_all(
            "Fiscal Year",
            filters={"year_start_date": [">", start]},
            order_by="year_start_date asc",
            limit_page_length=1,
            pluck="name",
        )
        if nxt:
            return nxt[0]
    return None


@frappe.whitelist()
def get_rollover_field_meta() -> dict:
    """Return per-field meta for the Project DocType so the Roll Over modal can
    render a "Set new value" editor that matches real inline editing.

    Shape: { fieldname: {fieldtype, label, options: [...], read_only: 0|1} }
    Only scalar (non-layout) fields are returned; Table / Table MultiSelect are
    included so the UI can grey out their "Set" option deliberately.
    """
    _ensure_logged_in()
    try:
        meta = frappe.get_meta("Project")
    except Exception:
        return {}

    out: dict = {}
    layout = {"Section Break", "Column Break", "Tab Break", "HTML", "Button", "Heading", "Fold"}
    for df in (meta.fields or []):
        fn = getattr(df, "fieldname", None)
        ft = getattr(df, "fieldtype", None)
        if not fn or fn in _DENY_FIELDS or ft in layout:
            continue
        options = []
        if ft in ("Select",):
            raw = getattr(df, "options", None) or ""
            options = [x.strip() for x in str(raw).split("\n") if str(x).strip()]
        out[fn] = {
            "fieldtype": ft,
            "label": getattr(df, "label", None) or fn,
            "options": options,
            # Link target doctype (kept for reference; UI uses a text box for links).
            "link_doctype": (getattr(df, "options", None) if ft == "Link" else None),
            "read_only": 1 if getattr(df, "read_only", 0) else 0,
        }
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
    advance_fiscal_year: Any = 0,
    advance_year_fields: Any = None,
    archive_source: Any = 0,
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

    allowed = _carryable_fields()
    carry = {str(f).strip() for f in _normalize_list(carry_fields) if str(f).strip()}
    carry_simple = carry & allowed
    carry_children = carry & CARRY_CHILD_TABLES

    ov_raw = _parse_obj(overrides)
    ov = {k: v for k, v in ov_raw.items() if k in allowed or k in _OVERRIDE_EXTRA}

    target_pt = str(target_project_type or "").strip()
    suffix = str(name_suffix or "").strip()
    status_value = str(reset_status or "").strip() or "Not started"
    advance_fy = str(advance_fiscal_year) in ("1", "true", "True", "yes")
    archive_src = str(archive_source) in ("1", "true", "True", "yes")

    # Date fields to advance by +1 year (e.g. Lodgement Due "Next year"). Restricted
    # to real Date/Datetime Project fields the user is allowed to carry.
    date_fields = _date_fields()
    advance_years = {
        str(f).strip() for f in _normalize_list(advance_year_fields) if str(f).strip()
    } & allowed & date_fields

    created: list[dict] = []
    errors: list[dict] = []
    archived: list[str] = []

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

            # Fiscal year +1 (unless the user explicitly Set one). Falls back to the
            # source's fiscal year when no following year exists (keeps it valid).
            if advance_fy and "custom_fiscal_year" not in ov:
                nxt = _next_fiscal_year(src.get("custom_fiscal_year"))
                if nxt:
                    new.set("custom_fiscal_year", nxt)

            # Date fields advanced by +1 year (e.g. Lodgement Due "Next year"),
            # computed from the SOURCE value. Explicit Set overrides win.
            for f in advance_years:
                if f in ov:
                    continue
                nd = _plus_one_year(src.get(f))
                if nd is not None:
                    new.set(f, nd)

            # When the user carried (or set) Year End, lock it so the create-time
            # Customer-Entity auto-sync can't overwrite the rolled-over value.
            if "custom_year_end" in carry_simple or "custom_year_end" in ov:
                new.flags.skip_year_end_autosync = True

            # Build the new name: keep the original (minus any prior roll-over tag) and
            # ALWAYS append a distinguishing suffix so it never collides with the source.
            # Suffix priority: explicit > target board (if changed) > new fiscal year
            # (if changed) > "(Roll Over)". A counter is folded in on any remaining clash.
            base = _strip_trailing_tag(src.get("project_name") or "") or (src.get("project_name") or "")
            tag = suffix
            if tag and not (tag.startswith("(") and tag.endswith(")")):
                tag = f"({tag})"
            if not tag:
                src_pt = str(src.get("project_type") or "").strip()
                new_pt = str(new.get("project_type") or "").strip()
                new_fy = str(new.get("custom_fiscal_year") or "").strip()
                src_fy = str(src.get("custom_fiscal_year") or "").strip()
                if new_pt and new_pt != src_pt:
                    tag = f"({new_pt})"
                elif new_fy and new_fy != src_fy:
                    tag = f"({new_fy})"
                else:
                    tag = "(Roll Over)"
            new.project_name = _unique_project_name(base, tag)

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

    # Archive the originals (only those that produced a copy) when requested, so a
    # roll over can replace the previous cycle in one step instead of a manual archive.
    if archive_src and created:
        rolled_sources = {c.get("source") for c in created}
        for sname in rolled_sources:
            try:
                doc = frappe.get_doc("Project", sname)
                if str(getattr(doc, "is_active", "") or "").strip() == "No":
                    continue
                doc.is_active = "No"
                doc._sb_archive_source = "manual"
                doc.flags.skip_board_automation = True
                doc.save()
                archived.append(sname)
            except Exception as e:
                errors.append({"source": sname, "error": f"Archive failed: {e}"})

    if created or archived:
        frappe.db.commit()

    return {
        "created": created,
        "errors": errors,
        "count": len(created),
        "archived": archived,
    }
