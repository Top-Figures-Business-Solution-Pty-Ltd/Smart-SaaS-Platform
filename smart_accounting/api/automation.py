# -*- coding: utf-8 -*-
"""
Board Automation API
CRUD operations for Board Automation rules.
Website-safe (/smart) — all endpoints are whitelisted.
"""

import json
import frappe
from typing import Any
from frappe.utils import today


def _ensure_logged_in():
    if frappe.session.user == "Guest":
        frappe.throw("Please log in", frappe.AuthenticationError)


def _parse_json(val):
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return {}
    return {}


def _coerce_legacy_trigger_type(candidate: str) -> str:
    """
    Board Automation.trigger_type is a legacy Select field kept for backward compatibility.
    Runtime logic already reads trigger_config.triggers first, so if DocField options are stale,
    we safely coerce this legacy field to any allowed option to avoid save-time Select validation errors.
    """
    cand = str(candidate or "").strip()
    try:
        meta = frappe.get_meta("Board Automation")
        f = meta.get_field("trigger_type") if meta else None
        raw = str(getattr(f, "options", "") or "")
        allowed = [x.strip() for x in raw.split("\n") if str(x).strip()]
    except Exception:
        allowed = []
    if not allowed:
        return cand
    if cand in allowed:
        return cand
    if "status_change" in allowed:
        return "status_change"
    return allowed[0]


# ============================================================
# Metadata: available trigger / action options
# ============================================================

# Each trigger/action carries a "modules" tag controlling which Smart Board module
# (accounting / grants) may use it. Items with no "modules" key are available everywhere.
TRIGGER_TYPES = {
    "status_change": {
        "label": "Status changes to",
        "modules": ["accounting"],
        "config_fields": [
            {
                "key": "to_value",
                "label": "Target Status",
                "type": "select",
                "source": "project_status_pool",
            }
        ],
    },
    "status_is": {
        "label": "Status is",
        "modules": ["accounting"],
        # Guardrail: state-based trigger is risky as a sole trigger because
        # it may repeatedly match on subsequent saves/scheduler runs.
        "cannot_be_only": True,
        "config_fields": [
            {
                "key": "value",
                "label": "Status",
                "type": "select",
                "source": "project_status_pool",
            }
        ],
    },
    "project_type_is": {
        "label": "Project type is",
        "modules": ["accounting"],
        "config_fields": [
            {
                "key": "project_type",
                "label": "Project Type",
                "type": "select",
                "source": "project_type_pool",
            }
        ],
    },
    "date_reaches": {
        "label": "Date reaches",
        "modules": ["accounting"],
        "config_fields": [
            {
                "key": "date_field",
                "label": "Date Field",
                "type": "select",
                "source": "project_date_fields",
            },
            {
                "key": "mode",
                "label": "When",
                "type": "select",
                "options": [
                    {"value": "on", "label": "On date"},
                    {"value": "on_or_after", "label": "On or after date"},
                ],
                "default": "on",
            },
        ],
    },
    # ---- Smart Grants only ----
    "date_arrives": {
        "label": "Date arrives",
        "modules": ["grants"],
        "config_fields": [
            {
                "key": "date_field",
                "label": "Date Field",
                "type": "select",
                "source": "project_date_fields",
            },
        ],
    },
    "date_approaching": {
        "label": "Date is approaching",
        "modules": ["grants"],
        "config_fields": [
            {
                "key": "date_field",
                "label": "Date Field",
                "type": "select",
                "source": "project_date_fields",
            },
            {"type": "break"},
            {"type": "caption", "text": "Highlight from"},
            {"key": "months", "label": "Months", "type": "number", "default": 0, "suffix": "months"},
            {"key": "weeks", "label": "Weeks", "type": "number", "default": 0, "suffix": "weeks"},
            {"key": "days", "label": "Days", "type": "number", "default": 0, "suffix": "days"},
            {"type": "caption", "text": "before the date"},
        ],
    },
}

# Each action is now a standalone unit (no bundled side-effects).
ACTION_TYPES = {
    "roll_due_date": {
        "label": "Roll Lodgement Due forward by frequency",
        "modules": ["accounting"],
        "config_fields": [],  # No user config needed; field is hardcoded to custom_lodgement_due_date
    },
    "reset_status": {
        "label": "Reset status to",
        "modules": ["accounting"],
        "config_fields": [
            {
                "key": "reset_to",
                "label": "Reset To",
                "type": "select",
                "source": "project_status_pool",
                "default": "Not started",
            },
        ],
    },
    "notify_someone": {
        "label": "Notify someone",
        "modules": ["accounting"],
        "config_fields": [
            {
                "key": "role",
                "label": "User Type",
                "type": "select",
                "options": [
                    {"value": "Assigned Person", "label": "Assigned Person"},
                    {"value": "Preparer", "label": "Preparer"},
                    {"value": "Manager", "label": "Manager"},
                    {"value": "Partner", "label": "Partner"},
                ],
            },
        ],
    },
    "archive_project": {
        "label": "Archive project",
        "modules": ["accounting"],
        "config_fields": [],
    },
    "push_date": {
        "label": "Push a date",
        "modules": ["accounting"],
        "config_fields": [
            {
                "key": "date_field",
                "label": "Date Field",
                "type": "select",
                "source": "project_push_date_fields",
            },
            {
                "key": "period",
                "label": "By",
                "type": "select",
                "options": [
                    {"value": "frequency", "label": "frequency"},
                    {"value": "1_week", "label": "1 week"},
                    {"value": "1_fortnight", "label": "1 fortnight"},
                    {"value": "1_month", "label": "1 month"},
                    {"value": "1_quarter", "label": "1 quarter"},
                    {"value": "1_year", "label": "1 year"},
                ],
                "default": "1_month",
            },
        ],
    },
    # ---- Smart Grants only ----
    "highlight_row": {
        "label": "Highlight row",
        "modules": ["grants"],
        "config_fields": [
            {"key": "color", "label": "Highlight color", "type": "color", "default": "#fff3a3"},
        ],
    },
    "clear_highlight": {
        "label": "Clear highlight",
        "modules": ["grants"],
        "config_fields": [],
    },
}


def _filter_meta_by_module(d: dict, module_key: str) -> dict:
    """Keep only trigger/action types available to the given module."""
    mk = str(module_key or "").strip()
    if not mk:
        return dict(d)
    out = {}
    for key, cfg in d.items():
        mods = cfg.get("modules")
        if not mods or mk in mods:
            out[key] = cfg
    return out


def _get_project_status_pool() -> list[str]:
    try:
        meta = frappe.get_meta("Project")
        f = meta.get_field("status")
        raw = str(getattr(f, "options", "") or "")
        return [x.strip() for x in raw.split("\n") if str(x).strip()]
    except Exception:
        return ["Not started", "Working on it", "Completed"]


def _get_project_type_pool() -> list[str]:
    try:
        rows = frappe.get_all("Project Type", fields=["name"], order_by="name asc", limit_page_length=5000)
        return [str(r.get("name") or "").strip() for r in (rows or []) if str(r.get("name") or "").strip()]
    except Exception:
        return []


def _get_project_date_field_options() -> list[dict]:
    # Prefer dynamic Project Date fields; force-include Reset Date if present.
    out: list[dict] = []
    seen = set()
    excluded = {
        "expected_start_date",
        "expected_end_date",
        "actual_start_date",
        "actual_end_date",
    }
    try:
        meta = frappe.get_meta("Project")
        for f in (meta.fields or []):
            if str(getattr(f, "fieldtype", "") or "").strip() != "Date":
                continue
            fn = str(getattr(f, "fieldname", "") or "").strip()
            if not fn or fn in seen or fn in excluded:
                continue
            lb = str(getattr(f, "label", "") or fn).strip() or fn
            out.append({"value": fn, "label": lb})
            seen.add(fn)
    except Exception:
        pass
    if "custom_reset_date" not in seen:
        out.append({"value": "custom_reset_date", "label": "Reset Date"})
    return out


def _get_project_push_date_field_options() -> list[dict]:
    out = list(_get_project_date_field_options() or [])
    values = {str(x.get("value") or "").strip() for x in out if isinstance(x, dict)}
    if "custom_target_month" not in values:
        out.append({"value": "custom_target_month", "label": "Target Month"})
    return out


@frappe.whitelist()
def get_automation_meta(module: str | None = None) -> dict:
    """
    Return available trigger types and action types with their config schemas.
    When `module` ("accounting" / "grants") is given, only items available to
    that module are returned.
    """
    _ensure_logged_in()
    status_pool = _get_project_status_pool()
    module_key = str(module or "").strip()
    trigger_catalog = _filter_meta_by_module(TRIGGER_TYPES, module_key)
    action_catalog = _filter_meta_by_module(ACTION_TYPES, module_key)

    def resolve_fields(config_fields):
        out = []
        for cf in config_fields:
            field = {**cf}
            if field.get("source") == "project_status_pool":
                field["options"] = [{"value": s, "label": s} for s in status_pool]
                del field["source"]
            elif field.get("source") == "project_type_pool":
                field["options"] = [{"value": s, "label": s} for s in _get_project_type_pool()]
                del field["source"]
            elif field.get("source") == "project_date_fields":
                field["options"] = _get_project_date_field_options()
                del field["source"]
            elif field.get("source") == "project_push_date_fields":
                field["options"] = _get_project_push_date_field_options()
                del field["source"]
            out.append(field)
        return out

    triggers = {}
    for key, cfg in trigger_catalog.items():
        triggers[key] = {**cfg, "config_fields": resolve_fields(cfg.get("config_fields", []))}

    actions = {}
    for key, cfg in action_catalog.items():
        actions[key] = {**cfg, "config_fields": resolve_fields(cfg.get("config_fields", []))}

    return {"triggers": triggers, "actions": actions}


# ============================================================
# CRUD
# ============================================================

@frappe.whitelist()
def get_automations(limit_start: int = 0, limit_page_length: int = 50, search: str | None = None, module: str | None = None) -> dict:
    _ensure_logged_in()
    module_key = str(module or "").strip()
    try:
        limit_start = max(0, int(limit_start or 0))
    except Exception:
        limit_start = 0
    try:
        limit_page_length = max(1, min(100, int(limit_page_length or 50)))
    except Exception:
        limit_page_length = 50
    q = str(search or "").strip()

    try:
        filters = {}
        or_filters = None
        if q:
            like = f"%{q}%"
            or_filters = [
                ["automation_name", "like", like],
                ["name", "like", like],
                ["trigger_type", "like", like],
            ]
        items = frappe.get_all(
            "Board Automation",
            filters=filters,
            or_filters=or_filters,
            fields=[
                "name", "enabled", "automation_name", "trigger_type", "trigger_config",
                "actions", "execution_count", "last_triggered",
            ],
            order_by="creation asc",
            limit_start=limit_start,
            limit_page_length=limit_page_length,
        )
        total_rows = frappe.get_all(
            "Board Automation",
            filters=filters,
            or_filters=or_filters,
            fields=["count(name) as cnt"],
            limit_page_length=1,
        )
        try:
            total_count = int((total_rows or [{}])[0].get("cnt") or 0)
        except Exception:
            total_count = len(items or [])
    except Exception:
        items = []
        total_count = 0

    for item in items:
        item["trigger_config"] = _parse_json(item.get("trigger_config"))
        raw_actions = item.get("actions")
        if isinstance(raw_actions, str):
            try:
                raw_actions = json.loads(raw_actions)
            except Exception:
                raw_actions = []
        item["actions"] = raw_actions if isinstance(raw_actions, list) else []

    # Module isolation: grants modal only sees grants automations and vice versa.
    # Untagged / legacy automations are treated as accounting.
    if module_key:
        def _item_module(it):
            tc = it.get("trigger_config") or {}
            return str((tc or {}).get("module") or "").strip() if isinstance(tc, dict) else ""
        if module_key == "grants":
            items = [it for it in items if _item_module(it) == "grants"]
        else:
            items = [it for it in items if _item_module(it) != "grants"]
        total_count = len(items)

    return {
        "items": items,
        "meta": {
            "total_count": int(total_count or 0),
            "limit_start": limit_start,
            "limit_page_length": limit_page_length,
        },
    }


@frappe.whitelist()
def save_automation(
    name: str | None = None,
    enabled: int = 1,
    automation_name: str | None = None,
    trigger_type: str = "",
    trigger_config: Any = None,
    actions: Any = None,
    module: str | None = None,
) -> dict:
    """
    Create or update a Board Automation rule.
    actions: JSON array of [{action_type, config}]
    """
    _ensure_logged_in()
    module_key = str(module or "").strip() or "accounting"

    trigger_type = str(trigger_type or "").strip()
    if not trigger_type:
        frappe.throw("Trigger type is required")
    if trigger_type not in TRIGGER_TYPES:
        frappe.throw(f"Unknown trigger type: {trigger_type}")

    # Parse trigger_config
    tc = trigger_config
    if isinstance(tc, str):
        try:
            tc = json.loads(tc)
        except Exception:
            tc = {}
    if not isinstance(tc, dict):
        tc = {}

    # Composite trigger support:
    # - New: trigger_config.triggers = [{trigger_type, config}, ...]
    # - Legacy: top-level trigger_type + trigger_config
    raw_triggers = tc.get("triggers")
    if isinstance(raw_triggers, str):
        try:
            raw_triggers = json.loads(raw_triggers)
        except Exception:
            raw_triggers = None
    trigger_items = raw_triggers if isinstance(raw_triggers, list) else [
        {"trigger_type": trigger_type, "config": tc}
    ]
    clean_triggers = []
    for t in trigger_items:
        if not isinstance(t, dict):
            continue
        tt = str(t.get("trigger_type") or "").strip()
        if not tt or tt not in TRIGGER_TYPES:
            continue
        cfg = t.get("config") or {}
        if isinstance(cfg, str):
            try:
                cfg = json.loads(cfg)
            except Exception:
                cfg = {}
        if not isinstance(cfg, dict):
            cfg = {}
        clean_triggers.append({"trigger_type": tt, "config": cfg})
    if not clean_triggers:
        frappe.throw("At least one valid trigger is required")
    if len(clean_triggers) == 1:
        only_type = str(clean_triggers[0].get("trigger_type") or "").strip()
        only_meta = TRIGGER_TYPES.get(only_type) or {}
        if bool(only_meta.get("cannot_be_only")):
            frappe.throw(
                f'Trigger "{only_type}" cannot be used alone. Please add at least one more trigger.'
            )
    # Persist both for backward compatibility; runtime reads trigger_config.triggers first.
    tc = {"triggers": clean_triggers, "module": module_key}
    trigger_type = clean_triggers[0]["trigger_type"]
    persisted_trigger_type = _coerce_legacy_trigger_type(trigger_type)

    # Parse actions array
    acts = actions
    if isinstance(acts, str):
        try:
            acts = json.loads(acts)
        except Exception:
            acts = []
    if not isinstance(acts, list):
        acts = []

    # Validate each action
    clean_actions = []
    for a in acts:
        if not isinstance(a, dict):
            continue
        at = str(a.get("action_type") or "").strip()
        if not at or at not in ACTION_TYPES:
            continue
        ac = a.get("config") or {}
        if isinstance(ac, str):
            try:
                ac = json.loads(ac)
            except Exception:
                ac = {}
        clean_actions.append({"action_type": at, "config": ac})

    if not clean_actions:
        frappe.throw("At least one valid action is required")

    automation_name = str(automation_name or "").strip()
    if not automation_name:
        # Keep backward compatibility: caller may not pass a title yet.
        automation_name = f"Automation {trigger_type}"

    name = str(name or "").strip()
    if name and frappe.db.exists("Board Automation", name):
        doc = frappe.get_doc("Board Automation", name)
        doc.enabled = int(enabled or 0)
        if hasattr(doc, "automation_name"):
            doc.automation_name = automation_name
        doc.trigger_type = persisted_trigger_type
        doc.trigger_config = json.dumps(tc)
        doc.actions = json.dumps(clean_actions)
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.new_doc("Board Automation")
        doc.enabled = int(enabled or 0)
        if hasattr(doc, "automation_name"):
            doc.automation_name = automation_name
        doc.trigger_type = persisted_trigger_type
        doc.trigger_config = json.dumps(tc)
        doc.actions = json.dumps(clean_actions)
        doc.insert(ignore_permissions=True)

    return {
        "ok": True,
        "name": doc.name,
        "enabled": doc.enabled,
        "automation_name": getattr(doc, "automation_name", "") or "",
        "trigger_type": doc.trigger_type,
        "execution_count": int(getattr(doc, "execution_count", 0) or 0),
    }


def _has_date_reaches_trigger(trigger_config: Any, trigger_type: str | None = None) -> bool:
    tc = _parse_json(trigger_config)
    trs = tc.get("triggers") if isinstance(tc, dict) else None
    if isinstance(trs, list):
        for t in trs:
            if isinstance(t, dict) and str(t.get("trigger_type") or "").strip() == "date_reaches":
                return True
        return False
    return str(trigger_type or "").strip() == "date_reaches"


@frappe.whitelist()
def run_due_date_automations_daily() -> dict:
    """
    Daily scheduler entry:
    - Finds automations that include date_reaches trigger.
    - Loads candidate projects where at least one configured date field == today.
    - Executes actions once via CustomProject automation engine.
    """
    autos = frappe.get_all(
        "Board Automation",
        filters={"enabled": 1},
        fields=["name", "trigger_type", "trigger_config"],
        limit_page_length=1000,
    )
    date_autos = [a for a in (autos or []) if _has_date_reaches_trigger(a.get("trigger_config"), a.get("trigger_type"))]
    if not date_autos:
        return {"ok": True, "checked": 0, "updated": 0}

    # Collect configured date fields from all date_reaches trigger clauses.
    date_fields = set()
    for a in date_autos:
        tc = _parse_json(a.get("trigger_config"))
        trs = tc.get("triggers") if isinstance(tc, dict) else None
        if not isinstance(trs, list):
            trs = [{"trigger_type": a.get("trigger_type"), "config": tc}]
        for t in trs:
            if not isinstance(t, dict):
                continue
            if str(t.get("trigger_type") or "").strip() != "date_reaches":
                continue
            cfg = t.get("config") or {}
            if isinstance(cfg, str):
                try:
                    cfg = json.loads(cfg)
                except Exception:
                    cfg = {}
            fn = str((cfg or {}).get("date_field") or "").strip()
            if fn:
                date_fields.add(fn)
    if not date_fields:
        return {"ok": True, "checked": 0, "updated": 0}

    # Build OR filters: any configured date field equals today.
    or_filters = [[f, "=", today()] for f in sorted(date_fields)]
    rows = frappe.get_all(
        "Project",
        fields=["name"],
        filters={"is_active": "Yes"},
        or_filters=or_filters,
        limit_page_length=20000,
    )
    names = [str(r.get("name") or "").strip() for r in (rows or []) if str(r.get("name") or "").strip()]
    updated = 0
    for name in names:
        try:
            doc = frappe.get_doc("Project", name)
            # Execute now, then save once; skip validate-time second pass.
            changed = bool(doc._run_board_automations({"event": "daily"}))
            if changed:
                doc.flags.skip_board_automation = True
                doc.save(ignore_permissions=True)
                updated += 1
        except Exception:
            continue

    return {"ok": True, "checked": len(names), "updated": updated}


@frappe.whitelist()
def run_due_date_automations_hourly() -> dict:
    """
    Hourly catch-up runner for date_reaches automations.
    Uses the same candidate and trigger semantics as daily runner.
    """
    autos = frappe.get_all(
        "Board Automation",
        filters={"enabled": 1},
        fields=["name", "trigger_type", "trigger_config"],
        limit_page_length=1000,
    )
    date_autos = [a for a in (autos or []) if _has_date_reaches_trigger(a.get("trigger_config"), a.get("trigger_type"))]
    if not date_autos:
        return {"ok": True, "checked": 0, "updated": 0}

    date_fields = set()
    for a in date_autos:
        tc = _parse_json(a.get("trigger_config"))
        trs = tc.get("triggers") if isinstance(tc, dict) else None
        if not isinstance(trs, list):
            trs = [{"trigger_type": a.get("trigger_type"), "config": tc}]
        for t in trs:
            if not isinstance(t, dict):
                continue
            if str(t.get("trigger_type") or "").strip() != "date_reaches":
                continue
            cfg = t.get("config") or {}
            if isinstance(cfg, str):
                try:
                    cfg = json.loads(cfg)
                except Exception:
                    cfg = {}
            fn = str((cfg or {}).get("date_field") or "").strip()
            if fn:
                date_fields.add(fn)
    if not date_fields:
        return {"ok": True, "checked": 0, "updated": 0}

    or_filters = [[f, "=", today()] for f in sorted(date_fields)]
    rows = frappe.get_all(
        "Project",
        fields=["name"],
        filters={"is_active": "Yes"},
        or_filters=or_filters,
        limit_page_length=20000,
    )
    names = [str(r.get("name") or "").strip() for r in (rows or []) if str(r.get("name") or "").strip()]
    updated = 0
    for name in names:
        try:
            doc = frappe.get_doc("Project", name)
            changed = bool(doc._run_board_automations({"event": "hourly"}))
            if changed:
                doc.flags.skip_board_automation = True
                doc.save(ignore_permissions=True)
                updated += 1
        except Exception:
            continue

    return {"ok": True, "checked": len(names), "updated": updated}


@frappe.whitelist()
def toggle_automation(name: str, enabled: int = 1) -> dict:
    _ensure_logged_in()
    name = str(name or "").strip()
    if not name or not frappe.db.exists("Board Automation", name):
        frappe.throw("Automation not found")
    frappe.db.set_value("Board Automation", name, "enabled", int(enabled or 0))
    return {"ok": True, "name": name, "enabled": int(enabled or 0)}


@frappe.whitelist()
def delete_automation(name: str) -> dict:
    _ensure_logged_in()
    name = str(name or "").strip()
    if not name or not frappe.db.exists("Board Automation", name):
        frappe.throw("Automation not found")
    frappe.delete_doc("Board Automation", name, ignore_permissions=True)
    return {"ok": True, "name": name}
