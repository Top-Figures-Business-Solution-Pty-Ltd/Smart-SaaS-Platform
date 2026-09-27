# -*- coding: utf-8 -*-
"""Read-only health summary for existing Board Automation run logs."""

from __future__ import annotations

from typing import Any

import frappe
from frappe.utils import add_to_date, now_datetime

from smart_accounting.api.authz import ensure_admin_like


def _to_int(value: Any, default: int) -> int:
	try:
		return int(value)
	except Exception:
		return int(default)


def _clean(value: Any) -> str:
	return str(value or "").strip()


def _doctype_exists(doctype: str) -> bool:
	try:
		return bool(frappe.db.exists("DocType", doctype))
	except Exception:
		return False


@frappe.whitelist()
def get_automation_health(lookback_hours: int = 24, recent_limit: int = 10) -> dict:
	"""
	Return a read-only summary of existing automation run logs.

	This method intentionally does not execute automations and does not write any
	records. It is safe to call from a diagnostics page or via bench execute.
	"""
	ensure_admin_like()

	if not _doctype_exists("Board Automation") or not _doctype_exists("Automation Run Log"):
		return {"ok": True, "available": False, "reason": "automation doctypes not installed"}

	hours = max(1, min(24 * 30, _to_int(lookback_hours, 24)))
	limit = max(1, min(100, _to_int(recent_limit, 10)))
	since = add_to_date(now_datetime(), hours=-hours)

	enabled_rows = frappe.get_all(
		"Board Automation",
		filters={"enabled": 1},
		fields=["name", "automation_name", "trigger_type"],
		order_by="modified desc",
		limit_page_length=1000,
		ignore_permissions=True,
	)
	enabled_by_name = {_clean(r.get("name")): r for r in enabled_rows or [] if _clean(r.get("name"))}

	run_rows = frappe.get_all(
		"Automation Run Log",
		filters=[["triggered_at", ">=", since]],
		fields=[
			"name",
			"run_id",
			"automation",
			"automation_name",
			"project",
			"project_type",
			"triggered_at",
			"execution_source",
			"result",
			"changed_field_count",
		],
		order_by="triggered_at desc",
		limit_page_length=5000,
		ignore_permissions=True,
	)

	by_automation: dict[str, dict] = {}
	result_counts: dict[str, int] = {}
	changed_projects: set[str] = set()
	for row in run_rows or []:
		result = _clean(row.get("result")) or "Unknown"
		result_counts[result] = result_counts.get(result, 0) + 1
		project = _clean(row.get("project"))
		if project and _to_int(row.get("changed_field_count"), 0) > 0:
			changed_projects.add(project)
		key = _clean(row.get("automation")) or _clean(row.get("automation_name")) or "Unknown"
		item = by_automation.setdefault(
			key,
			{
				"automation": key,
				"automation_name": _clean(row.get("automation_name")) or key,
				"run_count": 0,
				"failed_count": 0,
				"skipped_count": 0,
				"changed_project_count": 0,
				"last_run_at": row.get("triggered_at"),
				"last_result": result,
			},
		)
		item["run_count"] += 1
		if result == "Failed":
			item["failed_count"] += 1
		if result == "Skipped":
			item["skipped_count"] += 1
		if project and _to_int(row.get("changed_field_count"), 0) > 0:
			item["changed_project_count"] += 1
		if str(row.get("triggered_at") or "") > str(item.get("last_run_at") or ""):
			item["last_run_at"] = row.get("triggered_at")
			item["last_result"] = result

	no_recent_runs = []
	for name, auto in enabled_by_name.items():
		if name in by_automation:
			continue
		no_recent_runs.append(
			{
				"automation": name,
				"automation_name": _clean(auto.get("automation_name")) or name,
				"trigger_type": _clean(auto.get("trigger_type")),
			}
		)

	recent_problem_rows = [
		{
			"name": r.get("name"),
			"run_id": r.get("run_id"),
			"automation": r.get("automation"),
			"automation_name": r.get("automation_name"),
			"project": r.get("project"),
			"project_type": r.get("project_type"),
			"triggered_at": r.get("triggered_at"),
			"execution_source": r.get("execution_source"),
			"result": r.get("result"),
		}
		for r in (run_rows or [])
		if _clean(r.get("result")) in {"Failed", "Skipped"}
	][:limit]

	return {
		"ok": True,
		"available": True,
		"lookback_hours": hours,
		"enabled_automation_count": len(enabled_by_name),
		"run_count": len(run_rows or []),
		"result_counts": result_counts,
		"changed_project_count": len(changed_projects),
		"automation_summaries": sorted(by_automation.values(), key=lambda x: str(x.get("last_run_at") or ""), reverse=True),
		"enabled_with_no_recent_runs": no_recent_runs,
		"recent_problems": recent_problem_rows,
	}
