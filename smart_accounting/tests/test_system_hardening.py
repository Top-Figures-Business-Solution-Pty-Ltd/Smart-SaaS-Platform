# -*- coding: utf-8 -*-

from frappe.tests.utils import FrappeTestCase

import frappe

from smart_accounting.api.activity_log import undo_project_activity_batch
from smart_accounting.api.automation_health import get_automation_health
from smart_accounting.api.authz import is_admin_like
from smart_accounting.config.smart_board import (
	GLOBAL_PROJECT_STATUS_POOL,
	GRANTS_STATUS_ORDER,
	GRANTS_YEAR_BOARDS,
)


class TestSmartBoardConfig(FrappeTestCase):
	def test_grants_statuses_are_in_global_project_status_pool(self):
		global_pool = set(GLOBAL_PROJECT_STATUS_POOL)
		missing = [status for status in GRANTS_STATUS_ORDER if status not in global_pool]
		self.assertEqual(missing, [])

	def test_grants_year_boards_are_fy_project_types(self):
		self.assertGreaterEqual(len(GRANTS_YEAR_BOARDS), 1)
		for board in GRANTS_YEAR_BOARDS:
			self.assertRegex(board, r"^FY \d{4}$")


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
