# -*- coding: utf-8 -*-
"""Project activity audit helpers for Smart Board-facing Project fields."""

from __future__ import annotations

import json
from typing import Any

import frappe


_AUDIT_SKIP_FIELDS = {
    "modified",
    "modified_by",
    "creation",
    "owner",
    "idx",
    "_user_tags",
    "_comments",
    "_assign",
    "_liked_by",
    # Internal Smart Board/system helpers, not user-facing activity rows.
    "custom_archive_source",
    "custom_archive_source_ref",
    "custom_board_row_highlight",
}

_AUDIT_STANDARD_BOARD_FIELDS = {
    # Project identity/workflow fields that Smart Accounting/Grants expose as board columns.
    # Future Custom Fields are handled dynamically by the `custom_` prefix check below;
    # ERPNext standard fields are opt-in so calculated timesheet/cost rollup fields stay hidden.
    "customer",
    "project_name",
    "status",
    "notes",
    "project_type",
    "company",
    "priority",
    "expected_start_date",
    "expected_end_date",
    "estimated_costing",
    "is_active",
}

_AUDIT_SKIP_FIELDTYPES = {
    "Section Break",
    "Column Break",
    "Tab Break",
    "Fold",
    "HTML",
    "Button",
}

_AUDIT_UNDO_SKIP_FIELDTYPES = {
    *_AUDIT_SKIP_FIELDTYPES,
    "Table",
    "Table MultiSelect",
}


def get_project_meta_field(fieldname: str):
    try:
        return frappe.get_meta("Project").get_field(fieldname)
    except Exception:
        return None


def is_project_activity_field(fieldname: str, meta_field=None) -> bool:
    """
    Dynamic activity boundary for Smart Accounting/Grants board fields.

    Record Smart Board-facing Project fields without maintaining a per-column
    list for every custom field:
    - Custom Fields (`custom_*`) are included automatically.
    - ERPNext standard fields are opt-in, because Project has many calculated
      timesheet/cost fields that change as side effects and should not appear
      in Last Updated.
    - System/layout fields are always excluded.
    """
    fn = str(fieldname or "").strip()
    if not fn or fn in _AUDIT_SKIP_FIELDS:
        return False
    df = meta_field or get_project_meta_field(fn)
    if not df:
        return False
    fieldtype = str(getattr(df, "fieldtype", "") or "").strip()
    if fieldtype in _AUDIT_SKIP_FIELDTYPES:
        return False
    if not (fn.startswith("custom_") or fn in _AUDIT_STANDARD_BOARD_FIELDS):
        return False
    return True


def is_project_activity_undo_field(fieldname: str) -> bool:
    fn = str(fieldname or "").strip()
    if not is_project_activity_field(fn):
        return False
    df = get_project_meta_field(fn)
    fieldtype = str(getattr(df, "fieldtype", "") or "").strip()
    if fieldtype in _AUDIT_UNDO_SKIP_FIELDTYPES:
        return False
    if bool(getattr(df, "read_only", 0)):
        return False
    return True


def short_text(v: str, max_len: int = 180) -> str:
    s = str(v or "").strip()
    if len(s) <= max_len:
        return s
    return f"{s[: max_len - 3]}..."


def value_to_text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return ", ".join([value_to_text(x) for x in v if value_to_text(x)])
    if isinstance(v, dict):
        try:
            return json.dumps(v, ensure_ascii=False, sort_keys=True)
        except Exception:
            return str(v)
    return str(v).strip()


def table_summary(fieldname: str, rows: Any) -> str:
    arr = rows if isinstance(rows, list) else []
    if fieldname == "custom_team_members":
        role_map: dict[str, list[str]] = {}
        for r in arr:
            if not isinstance(r, dict):
                try:
                    r = r.as_dict()
                except Exception:
                    r = {}
            role = str(r.get("role") or "").strip()
            user = str(r.get("user") or "").strip()
            if not role and not user:
                continue
            key = role or "(no role)"
            role_map.setdefault(key, [])
            if user:
                role_map[key].append(user)
        parts = []
        for role in sorted(role_map.keys()):
            users = sorted(set([u for u in role_map[role] if u]))
            parts.append(f"{role}: {', '.join(users)}" if users else role)
        return " | ".join(parts)

    if fieldname == "custom_softwares":
        vals = []
        for r in arr:
            if not isinstance(r, dict):
                try:
                    r = r.as_dict()
                except Exception:
                    v0 = str(r or "").strip()
                    if v0:
                        vals.append(v0)
                    continue
            v = str(r.get("software") or r.get("software_name") or r.get("name") or "").strip()
            if v:
                vals.append(v)
        return ", ".join(sorted(set(vals)))

    cleaned = []
    for r in arr:
        if not isinstance(r, dict):
            try:
                r = r.as_dict()
            except Exception:
                r = {}
        row = {}
        for k, v in (r or {}).items():
            key = str(k or "").strip()
            if not key or key in {"name", "parent", "parenttype", "parentfield", "idx", "owner", "creation", "modified", "modified_by", "docstatus", "doctype"}:
                continue
            txt = value_to_text(v)
            if txt:
                row[key] = txt
        if row:
            cleaned.append(row)
    cleaned.sort(key=lambda x: json.dumps(x, sort_keys=True, ensure_ascii=False))
    if not cleaned:
        return ""
    try:
        return short_text(json.dumps(cleaned, ensure_ascii=False, sort_keys=True), max_len=300)
    except Exception:
        return short_text(str(cleaned), max_len=300)


def build_project_activity_changes(doc, before: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    before_map = before if isinstance(before, dict) else {}
    out: list[dict[str, Any]] = []
    meta = getattr(doc, "meta", None)
    for f in (getattr(meta, "fields", None) or []):
        fieldname = str(getattr(f, "fieldname", "") or "").strip()
        fieldtype = str(getattr(f, "fieldtype", "") or "").strip()
        if not fieldname:
            continue
        if not is_project_activity_field(fieldname, f):
            continue
        try:
            if not doc.has_value_changed(fieldname):
                continue
        except Exception:
            pass

        old_raw = before_map.get(fieldname)
        new_raw = doc.get(fieldname)
        if fieldtype in {"Table", "Table MultiSelect"}:
            old_v = table_summary(fieldname, old_raw)
            new_v = table_summary(fieldname, new_raw)
        else:
            old_v = short_text(value_to_text(old_raw))
            new_v = short_text(value_to_text(new_raw))
        if old_v == new_v:
            continue

        row = {
            "field": fieldname,
            "field_label": str(getattr(f, "label", "") or fieldname),
            "from_value": old_v,
            "to_value": new_v,
        }
        if fieldname == "is_active":
            _attach_archive_metadata(doc, row, old_v, new_v)
        _attach_automation_metadata(doc, row, fieldname)
        _attach_batch_metadata(doc, row)
        out.append(row)
    return out


def _attach_archive_metadata(doc, row: dict[str, Any], old_v: Any, new_v: Any) -> None:
    old_s = str(old_v or "").strip().lower()
    new_s = str(new_v or "").strip().lower()
    if old_s == "yes" and new_s == "no":
        source = str(getattr(doc, "_sb_archive_source", "") or "manual").strip() or "manual"
        row["archive_source"] = source
        if source == "automation":
            row["archive_rule"] = str(getattr(doc, "_sb_archive_rule", "") or "").strip()
    elif old_s == "no" and new_s == "yes":
        row["archive_source"] = "restore"


def _attach_automation_metadata(doc, row: dict[str, Any], fieldname: str) -> None:
    field_meta = (getattr(doc, "_sb_automation_field_meta", None) or {}).get(fieldname)
    if not isinstance(field_meta, dict):
        return
    row["change_source"] = "automation"
    row["automation_name"] = str(field_meta.get("automation_name") or "").strip()
    row["automation_run_id"] = str(field_meta.get("automation_run_id") or "").strip()
    row["automation_action_type"] = str(field_meta.get("automation_action_type") or "").strip()


def _attach_batch_metadata(doc, row: dict[str, Any]) -> None:
    batch_id = str(getattr(doc, "_sb_activity_batch_id", "") or "").strip()
    if not batch_id:
        return
    row["batch_id"] = batch_id
    row["batch_label"] = str(getattr(doc, "_sb_activity_batch_label", "") or "").strip()
    try:
        row["batch_size"] = int(getattr(doc, "_sb_activity_batch_size", 0) or 0)
    except Exception:
        row["batch_size"] = 0
