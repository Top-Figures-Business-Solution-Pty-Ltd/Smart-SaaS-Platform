# -*- coding: utf-8 -*-
"""
Rename Smart Grants status:
  Waiting for evidence review -> Reviewing R&D Evidence

This is an internal review step, not a client-waiting state. The workflow
position stays the same: after Waiting for tech evidence, before Preparing
R&D report.

Idempotent so prod can pick it up through bench migrate.
"""

from __future__ import annotations

import frappe

OLD = "Waiting for evidence review"
NEW = "Reviewing R&D Evidence"
RENAME = {OLD: NEW}


def _remap_json(raw):
	if not raw:
		return None
	try:
		data = frappe.parse_json(raw)
	except Exception:
		if isinstance(raw, str) and OLD in raw:
			return raw.replace(OLD, NEW)
		return None

	changed = {"v": False}

	def walk(value):
		if isinstance(value, list):
			return [walk(item) for item in value]
		if isinstance(value, dict):
			return {key: walk(item) for key, item in value.items()}
		if isinstance(value, str) and value == OLD:
			changed["v"] = True
			return NEW
		return value

	new = walk(data)
	return frappe.as_json(new) if changed["v"] else None


def _replace_status_options() -> None:
	name = "Project-status-options"
	value = frappe.db.get_value("Property Setter", name, "value")
	if not value:
		return
	options = [line.strip() for line in str(value).splitlines() if line.strip()]
	if OLD not in options:
		if NEW not in options:
			try:
				idx = options.index("Waiting for tech evidence") + 1
			except ValueError:
				options.append(NEW)
			else:
				options.insert(idx, NEW)
		else:
			return
	else:
		options = [NEW if item == OLD else item for item in options]
	# Keep a single entry if both names somehow existed.
	clean = []
	seen = set()
	for item in options:
		if item in seen:
			continue
		clean.append(item)
		seen.add(item)
	frappe.db.set_value("Property Setter", name, "value", "\n".join(clean), update_modified=False)


def _rename_project_status() -> None:
	if not frappe.db.has_column("Project", "status"):
		return
	frappe.db.sql("update `tabProject` set status=%s where status=%s", (NEW, OLD))


def _rename_json_docs(doctype: str, fields: list[str]) -> None:
	if not frappe.db.exists("DocType", doctype):
		return
	for name in frappe.get_all(doctype, pluck="name"):
		row = frappe.db.get_value(doctype, name, fields, as_dict=True) or {}
		update = {}
		for field in fields:
			remapped = _remap_json(row.get(field))
			if remapped is not None:
				update[field] = remapped
		if update:
			frappe.db.set_value(doctype, name, update, update_modified=False)


def _rename_status_config_default() -> None:
	key = "smart_accounting_project_type_status_config"
	raw = frappe.defaults.get_global_default(key)
	remapped = _remap_json(raw)
	if remapped is not None:
		frappe.defaults.set_global_default(key, remapped)


def execute():
	_replace_status_options()
	_rename_project_status()
	_rename_json_docs("Board Automation", ["trigger_config", "actions"])
	_rename_json_docs("Saved View", ["filters"])
	_rename_status_config_default()
	frappe.db.commit()
	try:
		frappe.clear_cache(doctype="Project")
	except Exception:
		pass
