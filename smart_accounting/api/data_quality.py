# -*- coding: utf-8 -*-
"""Read-only Smart Board data quality checks."""

from __future__ import annotations

import json
from typing import Any

import frappe
from frappe.utils import now_datetime

from smart_accounting.api.authz import ensure_admin_like
from smart_accounting.config.smart_board import GLOBAL_PROJECT_STATUS_POOL, GRANTS_YEAR_BOARDS


MAX_ITEMS_PER_CHECK = 25
MAX_PROJECT_SCAN = 5000
VALID_TAX_AGENT_VALUES = {"", "TG - Yes", "No"}


def _clean(value: Any) -> str:
	return str(value or "").strip()


def _project_field_exists(fieldname: str) -> bool:
	try:
		return bool(frappe.get_meta("Project").get_field(fieldname))
	except Exception:
		return False


def _base_project_fields(extra_fields: list[str] | None = None) -> list[str]:
	fields = ["name", "project_name", "project_type", "status", "is_active"]
	for field in extra_fields or []:
		if field not in fields and _project_field_exists(field):
			fields.append(field)
	return fields


def _project_item(row: dict[str, Any], detail: str = "") -> dict[str, str]:
	return {
		"item_type": "project",
		"project": _clean(row.get("name")),
		"project_title": _clean(row.get("project_name")) or _clean(row.get("name")),
		"project_type": _clean(row.get("project_type")),
		"status": _clean(row.get("status")),
		"detail": detail,
	}


def _check_result(key: str, title: str, severity: str, description: str, items: list[dict[str, Any]]) -> dict:
	return {
		"key": key,
		"title": title,
		"severity": severity,
		"description": description,
		"count": len(items),
		"items": items[:MAX_ITEMS_PER_CHECK],
		"more_count": max(0, len(items) - MAX_ITEMS_PER_CHECK),
	}


def _active_grants_rows(extra_fields: list[str] | None = None) -> list[dict[str, Any]]:
	if not GRANTS_YEAR_BOARDS:
		return []
	fields = _base_project_fields(extra_fields or [])
	return frappe.get_all(
		"Project",
		filters={
			"project_type": ["in", list(GRANTS_YEAR_BOARDS)],
			"is_active": ["!=", "No"],
		},
		fields=fields,
		order_by="modified desc",
		limit_page_length=MAX_PROJECT_SCAN,
		ignore_permissions=True,
	)


def _check_missing_grants_salesperson() -> dict:
	field = "custom_grants_salesperson"
	if not _project_field_exists(field):
		return _check_result(
			"missing_grants_salesperson_field",
			"Salesperson field is missing",
			"critical",
			"Project.custom_grants_salesperson is not available on this site.",
			[{"item_type": "system", "detail": "Run migrate and confirm Custom Field fixtures are installed."}],
		)
	rows = _active_grants_rows([field])
	items = [
		_project_item(row, "Missing salesperson")
		for row in rows
		if _clean(row.get("status")) not in {"Completed", "Not to Proceed"} and not _clean(row.get(field))
	]
	return _check_result(
		"missing_grants_salesperson",
		"Active grants missing salesperson",
		"warning",
		"Active Smart Grants projects should have a salesperson for ownership and reporting.",
		items,
	)


def _check_missing_engagement_date() -> dict:
	field = "custom_engagement_date"
	if not _project_field_exists(field):
		return _check_result(
			"missing_engagement_date_field",
			"Engagement Date field is missing",
			"critical",
			"Project.custom_engagement_date is not available on this site.",
			[{"item_type": "system", "detail": "Run migrate and confirm Custom Field fixtures are installed."}],
		)
	rows = _active_grants_rows([field])
	items = [
		_project_item(row, "Missing engagement date")
		for row in rows
		if _clean(row.get("status")) not in {"Completed", "Not to Proceed"} and not row.get(field)
	]
	return _check_result(
		"missing_engagement_date",
		"Active grants missing engagement date",
		"warning",
		"Engagement Date is used to identify new clients by month in the financial year.",
		items,
	)


def _check_invalid_project_status() -> dict:
	allowed = set(GLOBAL_PROJECT_STATUS_POOL)
	rows = frappe.get_all(
		"Project",
		filters={"is_active": ["!=", "No"]},
		fields=_base_project_fields(),
		order_by="modified desc",
		limit_page_length=MAX_PROJECT_SCAN,
		ignore_permissions=True,
	)
	items = [
		_project_item(row, f"Status is not in configured pool: {_clean(row.get('status')) or '(empty)'}")
		for row in rows
		if _clean(row.get("status")) not in allowed
	]
	return _check_result(
		"invalid_project_status",
		"Active projects with invalid status",
		"critical",
		"Statuses outside the configured Smart Board status pool can break filters, grouping, or automation assumptions.",
		items,
	)


def _check_invalid_tax_agent_values() -> dict:
	field = "custom_tg_tax_agent"
	if not _project_field_exists(field):
		return _check_result(
			"missing_tax_agent_field",
			"Tax Agent field is missing",
			"critical",
			"Project.custom_tg_tax_agent is not available on this site.",
			[{"item_type": "system", "detail": "Run migrate and confirm Tax Agent field migration is installed."}],
		)
	rows = _active_grants_rows([field])
	items = [
		_project_item(row, f"Unexpected Tax Agent value: {_clean(row.get(field))}")
		for row in rows
		if _clean(row.get(field)) not in VALID_TAX_AGENT_VALUES
	]
	return _check_result(
		"invalid_tax_agent_values",
		"Grants with unexpected Tax Agent value",
		"warning",
		"Tax Agent should currently be blank, TG - Yes, or No.",
		items,
	)


def _check_salesperson_user_links() -> dict:
	field = "custom_grants_salesperson"
	if not _project_field_exists(field):
		return _check_result(
			"invalid_salesperson_user_links",
			"Invalid salesperson user links",
			"warning",
			"Cannot validate salesperson links because the field is missing.",
			[],
		)
	rows = _active_grants_rows([field])
	users = {_clean(row.get(field)) for row in rows if _clean(row.get(field))}
	if not users:
		return _check_result(
			"invalid_salesperson_user_links",
			"Invalid salesperson user links",
			"notice",
			"No salesperson links were found to validate.",
			[],
		)
	valid_users = set(
		frappe.get_all(
			"User",
			filters={"name": ["in", list(users)], "enabled": 1},
			pluck="name",
			ignore_permissions=True,
		)
	)
	items = [
		_project_item(row, f"Salesperson user is missing or disabled: {_clean(row.get(field))}")
		for row in rows
		if _clean(row.get(field)) and _clean(row.get(field)) not in valid_users
	]
	return _check_result(
		"invalid_salesperson_user_links",
		"Invalid salesperson user links",
		"critical",
		"Salesperson links should point to enabled User records.",
		items,
	)


def _parse_json(value: Any):
	if isinstance(value, (dict, list)):
		return value
	if isinstance(value, str):
		try:
			return json.loads(value)
		except Exception:
			return None
	return None


def _check_incomplete_enabled_automations() -> dict:
	try:
		if not frappe.db.exists("DocType", "Board Automation"):
			return _check_result(
				"incomplete_enabled_automations",
				"Incomplete enabled automations",
				"notice",
				"Board Automation DocType is not installed.",
				[],
			)
	except Exception:
		return _check_result("incomplete_enabled_automations", "Incomplete enabled automations", "notice", "Automation DocType could not be checked.", [])

	rows = frappe.get_all(
		"Board Automation",
		filters={"enabled": 1},
		fields=["name", "automation_name", "trigger_type", "trigger_config", "actions"],
		order_by="modified desc",
		limit_page_length=1000,
		ignore_permissions=True,
	)
	items = []
	for row in rows or []:
		triggers_config = _parse_json(row.get("trigger_config"))
		triggers = triggers_config.get("triggers") if isinstance(triggers_config, dict) else None
		actions = _parse_json(row.get("actions"))
		has_trigger = bool(triggers) if isinstance(triggers, list) else bool(_clean(row.get("trigger_type")))
		has_action = bool(actions) if isinstance(actions, list) else False
		if not has_trigger or not has_action:
			label = _clean(row.get("automation_name")) or _clean(row.get("name"))
			reason = []
			if not has_trigger:
				reason.append("missing trigger")
			if not has_action:
				reason.append("missing action")
			items.append({"item_type": "automation", "automation": row.get("name"), "automation_name": label, "detail": ", ".join(reason)})
	return _check_result(
		"incomplete_enabled_automations",
		"Incomplete enabled automations",
		"critical",
		"Enabled automations should have at least one trigger and one action.",
		items,
	)


def _summary(checks: list[dict]) -> dict[str, int]:
	out = {"critical": 0, "warning": 0, "notice": 0, "total": 0}
	for check in checks:
		count = int(check.get("count") or 0)
		severity = _clean(check.get("severity")).lower() or "notice"
		if severity not in out:
			severity = "notice"
		out[severity] += count
		out["total"] += count
	return out


@frappe.whitelist()
def get_data_quality_report() -> dict:
	"""Return read-only data quality diagnostics for Smart Board admins."""
	ensure_admin_like()
	checks = [
		_check_missing_grants_salesperson(),
		_check_missing_engagement_date(),
		_check_invalid_project_status(),
		_check_invalid_tax_agent_values(),
		_check_salesperson_user_links(),
		_check_incomplete_enabled_automations(),
	]
	return {
		"ok": True,
		"generated_at": now_datetime(),
		"summary": _summary(checks),
		"checks": checks,
		"meta": {
			"max_items_per_check": MAX_ITEMS_PER_CHECK,
			"max_project_scan": MAX_PROJECT_SCAN,
		},
	}
