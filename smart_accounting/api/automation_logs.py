"""
Automation run log APIs (website-safe)
"""

from __future__ import annotations

from typing import Any

import frappe


def _ensure_logged_in() -> None:
	if frappe.session.user in (None, "", "Guest"):
		frappe.throw("Not permitted", frappe.PermissionError)


def _normalize_int(v: Any, default: int = 0) -> int:
	try:
		return int(v)
	except Exception:
		return int(default)


def _clean(v: Any) -> str:
	return str(v or "").strip()


def _join_non_empty(parts: list[str], sep: str = " · ") -> str:
	return sep.join([p for p in parts if _clean(p)])


def build_run_diagnosis(row: dict[str, Any] | None, changes: list[dict[str, Any]] | None = None) -> dict:
	"""Build a small human-readable diagnosis from existing run-log fields."""
	r = row or {}
	result = _clean(r.get("result")) or "Unknown"
	message = _clean(r.get("message"))
	error_details = _clean(r.get("error_details"))
	triggers = _clean(r.get("matched_triggers"))
	actions = _clean(r.get("actions_attempted"))
	change_rows = changes if isinstance(changes, list) else []
	changed_fields = []
	for ch in change_rows:
		if not isinstance(ch, dict):
			continue
		label = _clean(ch.get("field_label")) or _clean(ch.get("fieldname"))
		if label and label not in changed_fields:
			changed_fields.append(label)

	if result == "Failed":
		title = "Automation failed"
		summary = error_details or message or "The automation stopped with an error."
	elif result == "Skipped":
		title = "Automation skipped"
		summary = message or "The automation was skipped before changing the project."
	elif result == "No Change":
		title = "No project changes"
		summary = message or "The automation matched but no field needed to change."
	elif result == "Success":
		title = "Automation completed"
		if changed_fields:
			summary = f"Updated {', '.join(changed_fields[:3])}{', ...' if len(changed_fields) > 3 else ''}"
		else:
			summary = message or "The automation completed successfully."
	else:
		title = "Automation run"
		summary = message or "No summary was recorded."

	details = []
	if triggers:
		details.append(f"Matched triggers: {triggers}")
	if actions:
		details.append(f"Actions attempted: {actions}")
	if changed_fields:
		details.append(f"Changed fields: {', '.join(changed_fields[:8])}")
	if error_details and error_details != summary:
		details.append(f"Error details: {error_details}")

	return {
		"title": title,
		"summary": summary,
		"details": details,
	}


@frappe.whitelist()
def get_automation_run_logs(
	automation: str | None = None,
	project: str | None = None,
	project_type: str | None = None,
	result: str | None = None,
	execution_source: str | None = None,
	search: str | None = None,
	limit_start: int = 0,
	limit_page_length: int = 20,
) -> dict:
	_ensure_logged_in()
	limit_start = max(0, _normalize_int(limit_start, 0))
	limit_page_length = max(1, min(100, _normalize_int(limit_page_length, 20)))

	filters: dict[str, Any] = {}
	automation_name = _clean(automation)
	project_name = _clean(project)
	project_type_name = _clean(project_type)
	result_name = _clean(result)
	source_name = _clean(execution_source)
	search_term = _clean(search)
	if automation_name:
		filters["automation"] = automation_name
	if project_name:
		if not frappe.has_permission("Project", "read", project_name):
			frappe.throw("Not permitted", frappe.PermissionError)
		filters["project"] = project_name
	if project_type_name:
		filters["project_type"] = project_type_name
	if result_name:
		filters["result"] = result_name
	if source_name:
		filters["execution_source"] = source_name

	or_filters = None
	if search_term:
		like = f"%{search_term}%"
		or_filters = [
			["automation_name", "like", like],
			["project_title", "like", like],
			["project", "like", like],
			["message", "like", like],
		]

	rows = frappe.get_all(
		"Automation Run Log",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name",
			"run_id",
			"automation",
			"automation_name",
			"project",
			"project_title",
			"project_type",
			"triggered_at",
			"execution_source",
			"result",
			"matched_triggers",
			"actions_attempted",
			"message",
			"error_details",
			"changed_field_count",
		],
		order_by="triggered_at desc, creation desc",
		limit_start=limit_start,
		limit_page_length=limit_page_length,
		ignore_permissions=True,
	)

	items = []
	for row in (rows or []):
		log_name = _clean(row.get("name"))
		changes = frappe.get_all(
			"Automation Run Log Change",
			filters={"parent": log_name, "parenttype": "Automation Run Log", "parentfield": "changes"},
			fields=["fieldname", "field_label", "action_type", "from_value", "to_value"],
			order_by="idx asc",
			limit_page_length=20,
			ignore_permissions=True,
		) if log_name else []
		items.append({**row, "changes": changes or [], "diagnosis": build_run_diagnosis(row, changes or [])})

	total_rows = frappe.get_all(
		"Automation Run Log",
		filters=filters,
		or_filters=or_filters,
		fields=["count(name) as cnt"],
		limit_page_length=1,
		ignore_permissions=True,
	)
	try:
		total_count = int((total_rows or [{}])[0].get("cnt") or 0)
	except Exception:
		total_count = len(items)

	return {
		"items": items,
		"meta": {
			"limit_start": limit_start,
			"limit_page_length": limit_page_length,
			"total_count": total_count,
		},
	}
