from __future__ import annotations

import frappe


def get_context(context):
	"""Smart Grants entrypoint."""
	context.login_required = True
	context.no_cache = 1
	context.brand_name = "Smart Grants"
	context.brand_tagline = "Grants workspace"
	# Legacy aggregated "Smart Grants" board was removed; land on the first year board.
	context.grants_project_type = "Grants 2024"
	return context
