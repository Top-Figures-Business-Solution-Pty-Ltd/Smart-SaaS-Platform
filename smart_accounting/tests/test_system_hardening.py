# -*- coding: utf-8 -*-

from frappe.tests.utils import FrappeTestCase

import frappe

from smart_accounting.api.activity_log import undo_project_activity_batch
from smart_accounting.api.automation_health import get_automation_health
from smart_accounting.api.automation_logs import build_run_diagnosis
from smart_accounting.api.authz import is_admin_like
from smart_accounting.api.data_quality import _summary, get_data_quality_report
from smart_accounting.config.smart_board import (
	GLOBAL_PROJECT_STATUS_POOL,
	GRANTS_STATUS_ORDER,
	GRANTS_YEAR_BOARDS,
)
from smart_accounting.project_activity import build_project_activity_changes, is_project_activity_field


class TestSmartBoardConfig(FrappeTestCase):
	def test_grants_statuses_are_in_global_project_status_pool(self):
		global_pool = set(GLOBAL_PROJECT_STATUS_POOL)
		missing = [status for status in GRANTS_STATUS_ORDER if status not in global_pool]
		self.assertEqual(missing, [])

	def test_grants_year_boards_are_fy_project_types(self):
		self.assertGreaterEqual(len(GRANTS_YEAR_BOARDS), 1)
		for board in GRANTS_YEAR_BOARDS:
			self.assertRegex(board, r"^FY \d{4}$")

	def test_reviewing_evidence_keeps_workflow_position(self):
		self.assertIn("Reviewing R&D Evidence", GRANTS_STATUS_ORDER)
		self.assertNotIn("Waiting for evidence review", GRANTS_STATUS_ORDER)
		self.assertEqual(
			GRANTS_STATUS_ORDER.index("Reviewing R&D Evidence"),
			GRANTS_STATUS_ORDER.index("Waiting for tech evidence") + 1,
		)

	def test_grants_status_sort_uses_workflow_order(self):
		from smart_accounting.api.project_board import _sort_project_rows_by_status

		rows = _sort_project_rows_by_status(
			[
				{"name": "P3", "status": "Waiting for tech meeting"},
				{"name": "P1", "status": "Waiting for payment"},
				{"name": "P2", "status": "Waiting for kickoff"},
			],
			"asc",
			grants=True,
		)
		self.assertEqual(
			[row["status"] for row in rows],
			["Waiting for kickoff", "Waiting for tech meeting", "Waiting for payment"],
		)


class TestAuthzHelpers(FrappeTestCase):
	def test_guest_is_not_admin_like(self):
		self.assertFalse(is_admin_like("Guest"))


class TestActivityBatchUndo(FrappeTestCase):
	def test_batch_undo_requires_batch_id(self):
		with self.assertRaises(frappe.ValidationError):
			undo_project_activity_batch("")


class TestAutomationHealth(FrappeTestCase):
	def test_automation_health_endpoint_is_importable(self):
		self.assertTrue(callable(get_automation_health))


class TestDataQuality(FrappeTestCase):
	def test_data_quality_endpoint_is_importable(self):
		self.assertTrue(callable(get_data_quality_report))

	def test_data_quality_summary_counts_by_severity(self):
		self.assertEqual(
			_summary(
				[
					{"severity": "critical", "count": 2},
					{"severity": "warning", "count": 3},
					{"severity": "notice", "count": 1},
				]
			),
			{"critical": 2, "warning": 3, "notice": 1, "total": 6},
		)


class TestAutomationRunDiagnosis(FrappeTestCase):
	def test_failed_run_diagnosis_prefers_error_details(self):
		diag = build_run_diagnosis(
			{
				"result": "Failed",
				"message": "Generic failure",
				"error_details": "Lodgement Due Date is invalid",
				"matched_triggers": "date_reaches",
				"actions_attempted": "roll_due_date",
			},
			[],
		)
		self.assertEqual(diag["title"], "Automation failed")
		self.assertEqual(diag["summary"], "Lodgement Due Date is invalid")
		self.assertIn("Matched triggers: date_reaches", diag["details"])

	def test_success_diagnosis_summarises_changed_fields(self):
		diag = build_run_diagnosis(
			{"result": "Success", "message": "Updated fields"},
			[
				{"fieldname": "status", "field_label": "Status"},
				{"fieldname": "custom_lodgement_due_date", "field_label": "Lodgement Due Date"},
			],
		)
		self.assertEqual(diag["title"], "Automation completed")
		self.assertEqual(diag["summary"], "Updated Status, Lodgement Due Date")


class TestProjectActivityHelpers(FrappeTestCase):
	def test_custom_field_is_activity_field_with_meta(self):
		class Field:
			fieldtype = "Data"

		self.assertTrue(is_project_activity_field("custom_engagement_date", Field()))

	def test_build_project_activity_changes_keeps_batch_and_automation_metadata(self):
		class Field:
			fieldname = "custom_salesperson"
			fieldtype = "Link"
			label = "Salesperson"

		class Meta:
			fields = [Field()]

		class Doc:
			meta = Meta()
			_sb_activity_batch_id = "batch-1"
			_sb_activity_batch_label = "Bulk update"
			_sb_activity_batch_size = 2
			_sb_automation_field_meta = {
				"custom_salesperson": {
					"automation_name": "Assign salesperson",
					"automation_run_id": "run-1",
					"automation_action_type": "set_field",
				}
			}

			def has_value_changed(self, fieldname):
				return fieldname == "custom_salesperson"

			def get(self, fieldname):
				if fieldname == "custom_salesperson":
					return "new@example.com"
				return ""

		rows = build_project_activity_changes(Doc(), {"custom_salesperson": "old@example.com"})
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["field"], "custom_salesperson")
		self.assertEqual(rows[0]["batch_id"], "batch-1")
		self.assertEqual(rows[0]["change_source"], "automation")
		self.assertEqual(rows[0]["automation_run_id"], "run-1")
