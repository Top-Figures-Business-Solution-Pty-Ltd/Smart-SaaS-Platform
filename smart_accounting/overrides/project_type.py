from __future__ import annotations

import frappe
from erpnext.projects.doctype.project_type.project_type import ProjectType as ERPNextProjectType

# Placeholder type that holds projects whose original Project Type was deleted.
ARCHIVED_HOLDING_PROJECT_TYPE = "Archived (Holding)"


class SmartProjectType(ERPNextProjectType):
	"""
	ERPNext blocks deletion of the Project Type named exactly 'External' in core.

	In Smart Accounting we treat placeholder Project Types as user-manageable,
	so we allow deleting them (still subject to normal link checks).

	Safety: deleting a Project Type would otherwise be blocked by Link validation
	if any Project still references it. Before deletion we move all such Projects
	to the Archived (Holding) placeholder and archive them, recording the original
	type so a later restore can offer it back. on_trash runs before the link check
	(see frappe/model/delete_doc.py), so this keeps deletion safe and lossless.
	"""

	def on_trash(self):
		self._reassign_projects_to_holding()
		self._cleanup_board_references()
		# Allow deleting ERPNext's protected placeholder type(s) if your org wants to remove them.
		if self.name in {"External"}:
			return
		return super().on_trash()

	def _cleanup_board_references(self):
		"""Remove other links that would otherwise block deletion of this board.

		Board Automations are board-specific and meaningless once the board is gone,
		so delete them. Project Templates referencing this type are cleared."""
		if self.name == ARCHIVED_HOLDING_PROJECT_TYPE:
			return
		try:
			if frappe.db.has_column("Board Automation", "project_type"):
				for n in frappe.get_all("Board Automation", filters={"project_type": self.name}, pluck="name"):
					frappe.delete_doc("Board Automation", n, ignore_permissions=True, force=True)
		except Exception:
			pass
		try:
			if frappe.db.exists("DocType", "Project Template") and frappe.db.has_column("Project Template", "project_type"):
				for n in frappe.get_all("Project Template", filters={"project_type": self.name}, pluck="name"):
					frappe.db.set_value("Project Template", n, "project_type", None, update_modified=False)
		except Exception:
			pass

	def _reassign_projects_to_holding(self):
		# Never reassign the holding placeholder onto itself.
		if self.name == ARCHIVED_HOLDING_PROJECT_TYPE:
			return
		try:
			ensure_archived_holding_type()
		except Exception:
			return

		names = frappe.get_all("Project", filters={"project_type": self.name}, pluck="name")
		if not names:
			return

		has_source = frappe.db.has_column("Project", "custom_archive_source")
		has_ref = frappe.db.has_column("Project", "custom_archive_source_ref")
		for name in names:
			update = {"project_type": ARCHIVED_HOLDING_PROJECT_TYPE, "is_active": "No"}
			if has_source:
				update["custom_archive_source"] = "Type Deleted"
			if has_ref:
				update["custom_archive_source_ref"] = self.name
			frappe.db.set_value("Project", name, update, update_modified=True)


def ensure_archived_holding_type() -> str:
	"""Idempotently ensure the Archived (Holding) placeholder Project Type exists."""
	if not frappe.db.exists("Project Type", ARCHIVED_HOLDING_PROJECT_TYPE):
		frappe.get_doc(
			{"doctype": "Project Type", "project_type": ARCHIVED_HOLDING_PROJECT_TYPE}
		).insert(ignore_permissions=True)
	return ARCHIVED_HOLDING_PROJECT_TYPE
