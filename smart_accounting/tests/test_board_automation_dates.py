# -*- coding: utf-8 -*-

from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, getdate

from smart_accounting.api.automation import (
	DATE_REACHES_CATCHUP_DAYS,
	_has_date_reaches_trigger,
	date_reaches_candidate_or_filters,
	date_reaches_save_edge_allowed,
	date_reaches_value_matches,
)


class TestDateReachesHelpers(FrappeTestCase):
	def test_on_mode_matches_exact_today_only(self):
		today = getdate("2026-11-20")
		self.assertTrue(date_reaches_value_matches("2026-11-20", "on", today))
		self.assertFalse(date_reaches_value_matches("2026-11-19", "on", today))
		self.assertFalse(date_reaches_value_matches("2026-11-21", "on", today))
		self.assertFalse(date_reaches_value_matches(None, "on", today))

	def test_missing_mode_is_on(self):
		today = getdate("2026-11-20")
		self.assertTrue(date_reaches_value_matches("2026-11-20", "", today))
		self.assertTrue(date_reaches_value_matches("2026-11-20", None, today))
		self.assertFalse(date_reaches_value_matches("2026-11-19", None, today))

	def test_on_or_after_includes_overdue(self):
		today = getdate("2026-11-20")
		self.assertTrue(date_reaches_value_matches("2026-11-20", "on_or_after", today))
		self.assertTrue(date_reaches_value_matches("2026-11-01", "on_or_after", today))
		self.assertFalse(date_reaches_value_matches("2026-11-21", "on_or_after", today))

	def test_save_edge_requires_status_or_date_change(self):
		self.assertTrue(date_reaches_save_edge_allowed(True, [], ["custom_reset_date"]))
		self.assertTrue(
			date_reaches_save_edge_allowed(False, ["custom_reset_date"], ["custom_reset_date"])
		)
		self.assertFalse(
			date_reaches_save_edge_allowed(False, ["project_name"], ["custom_reset_date"])
		)
		self.assertFalse(date_reaches_save_edge_allowed(False, [], ["custom_reset_date"]))

	def test_on_only_candidate_filter_is_exact_today(self):
		autos = [
			{
				"trigger_type": "date_reaches",
				"trigger_config": {
					"triggers": [
						{
							"trigger_type": "date_reaches",
							"config": {"date_field": "custom_reset_date", "mode": "on"},
						}
					]
				},
			}
		]
		self.assertEqual(
			date_reaches_candidate_or_filters(autos, "2026-11-20"),
			[["custom_reset_date", "=", "2026-11-20"]],
		)

	def test_on_or_after_candidate_filter_uses_lookback_window(self):
		autos = [
			{
				"trigger_type": "status_is",
				"trigger_config": {
					"triggers": [
						{"trigger_type": "status_is", "config": {"value": "Completed"}},
						{
							"trigger_type": "date_reaches",
							"config": {"date_field": "custom_reset_date", "mode": "on_or_after"},
						},
					]
				},
			}
		]
		lookback = str(add_days(getdate("2026-11-20"), -DATE_REACHES_CATCHUP_DAYS))
		self.assertEqual(
			date_reaches_candidate_or_filters(autos, "2026-11-20"),
			[["custom_reset_date", "between", [lookback, "2026-11-20"]]],
		)

	def test_mixed_modes_on_same_field_use_catchup_scan(self):
		autos = [
			{
				"trigger_config": {
					"triggers": [
						{
							"trigger_type": "date_reaches",
							"config": {"date_field": "custom_reset_date", "mode": "on"},
						}
					]
				}
			},
			{
				"trigger_config": {
					"triggers": [
						{
							"trigger_type": "date_reaches",
							"config": {"date_field": "custom_reset_date", "mode": "on_or_after"},
						}
					]
				}
			},
		]
		lookback = str(add_days(getdate("2026-11-20"), -DATE_REACHES_CATCHUP_DAYS))
		self.assertEqual(
			date_reaches_candidate_or_filters(autos, "2026-11-20"),
			[["custom_reset_date", "between", [lookback, "2026-11-20"]]],
		)

	def test_detects_date_reaches_in_composite_triggers(self):
		self.assertTrue(
			_has_date_reaches_trigger(
				{
					"triggers": [
						{"trigger_type": "status_is", "config": {"value": "Completed"}},
						{
							"trigger_type": "date_reaches",
							"config": {"date_field": "custom_reset_date", "mode": "on"},
						},
					]
				},
				"status_is",
			)
		)
		self.assertFalse(
			_has_date_reaches_trigger(
				{"triggers": [{"trigger_type": "status_change", "config": {"to_value": "Completed"}}]},
				"status_change",
			)
		)
