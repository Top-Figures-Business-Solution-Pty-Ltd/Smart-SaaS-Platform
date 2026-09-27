# -*- coding: utf-8 -*-
"""
Update Smart Grants Tax Agent and Project status options.

This patch is intentionally idempotent so test/prod can pick it up through
bench migrate instead of manual Customize Form changes.
"""

from __future__ import annotations

import frappe


TG_TAX_AGENT_FIELD = "custom_tg_tax_agent"
TG_TAX_AGENT_OPTIONS = ["TG - Yes", "No"]

WAITING_FOR_KICKOFF = "Waiting for kickoff"
WAITING_FOR_TECH_MEETING = "Waiting for tech meeting"
WAITING_FOR_TECH_EVIDENCE = "Waiting for tech evidence"
WAITING_FOR_EVIDENCE_REVIEW = "Waiting for evidence review"


def execute():
	ensure_tg_tax_agent_field()
	migrate_tg_tax_agent_values()
	ensure_project_status_options()
	frappe.db.commit()
	try:
		frappe.clear_cache(doctype="Project")
	except Exception:
		pass


def ensure_tg_tax_agent_field() -> None:
	name = f"Project-{TG_TAX_AGENT_FIELD}"
	payload = {
		"dt": "Project",
		"fieldname": TG_TAX_AGENT_FIELD,
		"label": "Tax Agent",
		"fieldtype": "Select",
		"options": "\n".join(TG_TAX_AGENT_OPTIONS),
		"default": "No",
		"insert_after": "custom_portal_access_received",
		"is_system_generated": 1,
	}

	if frappe.db.exists("Custom Field", name):
		# Frappe blocks Custom Field type changes through doc.save(), so migrations
		# update the physical column first and then write meta directly.
		ensure_project_column_type(TG_TAX_AGENT_FIELD, "varchar(140)")
		frappe.db.set_value("Custom Field", name, payload, update_modified=False)
	else:
		frappe.get_doc({"doctype": "Custom Field", **payload}).insert(ignore_permissions=True)
		ensure_project_column_type(TG_TAX_AGENT_FIELD, "varchar(140)")


def ensure_project_column_type(fieldname: str, column_type: str) -> None:
	rows = frappe.db.sql("SHOW COLUMNS FROM `tabProject` LIKE %s", (fieldname,), as_dict=True) or []
	if not rows:
		return
	current = str((rows[0] or {}).get("Type") or "").lower()
	if "varchar" in current:
		return
	frappe.db.sql(f"ALTER TABLE `tabProject` MODIFY COLUMN `{fieldname}` {column_type}")


def migrate_tg_tax_agent_values() -> None:
	rows = frappe.db.sql("SHOW COLUMNS FROM `tabProject` LIKE %s", (TG_TAX_AGENT_FIELD,), as_dict=True) or []
	if not rows:
		return
	frappe.db.sql(
		f"""
		UPDATE `tabProject`
		SET `{TG_TAX_AGENT_FIELD}` = CASE
			WHEN LOWER(TRIM(COALESCE(`{TG_TAX_AGENT_FIELD}`, ''))) IN ('', '0', 'no', 'false') THEN 'No'
			ELSE 'TG - Yes'
		END
		"""
	)


def ensure_project_status_options() -> None:
	options = get_current_project_status_options()
	options = insert_before(options, WAITING_FOR_KICKOFF, WAITING_FOR_TECH_MEETING)
	options = insert_after(options, WAITING_FOR_EVIDENCE_REVIEW, WAITING_FOR_TECH_EVIDENCE)
	set_project_status_options(options)


def get_current_project_status_options() -> list[str]:
	value = frappe.db.get_value("Property Setter", "Project-status-options", "value")
	if value:
		return split_options(value)

	df = frappe.get_meta("Project").get_field("status")
	return split_options(getattr(df, "options", "") or "")


def split_options(value: str) -> list[str]:
	return [line.strip() for line in str(value or "").splitlines() if line.strip()]


def insert_before(options: list[str], item: str, before: str) -> list[str]:
	cleaned = [x for x in options if x != item]
	try:
		idx = cleaned.index(before)
	except ValueError:
		cleaned.append(item)
	else:
		cleaned.insert(idx, item)
	return cleaned


def insert_after(options: list[str], item: str, after: str) -> list[str]:
	cleaned = [x for x in options if x != item]
	try:
		idx = cleaned.index(after)
	except ValueError:
		cleaned.append(item)
	else:
		cleaned.insert(idx + 1, item)
	return cleaned


def set_project_status_options(options: list[str]) -> None:
	value = "\n".join(options)
	name = "Project-status-options"
	if frappe.db.exists("Property Setter", name):
		frappe.db.set_value("Property Setter", name, "value", value, update_modified=False)
		return

	frappe.get_doc(
		{
			"doctype": "Property Setter",
			"name": name,
			"doc_type": "Project",
			"doctype_or_field": "DocField",
			"field_name": "status",
			"property": "options",
			"property_type": "Text",
			"value": value,
		}
	).insert(ignore_permissions=True)
