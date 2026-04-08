"""
Activity Log APIs (website-safe)
- Projects + Clients create/update/delete
- Supports masked output unless correct password provided
"""

from __future__ import annotations

from typing import Any

import frappe
from frappe.utils import getdate


def _ensure_logged_in() -> None:
	if frappe.session.user in (None, "", "Guest"):
		frappe.throw("Not permitted", frappe.PermissionError)


def _normalize_int(v: Any, default: int) -> int:
	try:
		return int(v)
	except Exception:
		return int(default)


def _clean_str(v: Any) -> str:
	return str(v or "").strip()


def _target_doctypes(target: str | None = None) -> list[str]:
	t = _clean_str(target).lower()
	if t == "project":
		return ["Project"]
	if t == "client":
		return ["Customer"]
	return ["Project", "Customer"]


def _activity_filter(activity: str | None = None) -> set[str]:
	a = _clean_str(activity).lower()
	if a in ("create", "update", "delete"):
		return {a}
	return {"create", "update", "delete"}


def _get_user_fullname(user: str, cache: dict[str, str]) -> str:
	u = _clean_str(user)
	if not u:
		return ""
	if u in cache:
		return cache[u]
	try:
		name = frappe.get_cached_value("User", u, "full_name") or u
		cache[u] = name
		return name
	except Exception:
		cache[u] = u
		return u


def _is_password_valid(password: str | None) -> bool:
	pwd = _clean_str(password)
	if not pwd:
		return False
	cfg = frappe.get_site_config() or {}
	secret = _clean_str(cfg.get("smart_activity_log_password"))
	if not secret:
		return False
	return pwd == secret


def _safe_json(v: Any) -> dict:
	try:
		if isinstance(v, dict):
			return v
		if isinstance(v, str):
			return frappe.parse_json(v) or {}
	except Exception:
		pass
	return {}


def _field_label_map(doctype: str) -> dict[str, str]:
	try:
		meta = frappe.get_meta(doctype)
	except Exception:
		return {}
	out: dict[str, str] = {}
	for f in (meta.fields or []):
		fn = _clean_str(getattr(f, "fieldname", ""))
		lb = _clean_str(getattr(f, "label", "")) or fn
		if fn:
			out[fn] = lb
	return out


def _short(v: Any) -> str:
	s = _clean_str(v)
	if len(s) <= 120:
		return s
	return f"{s[:117]}..."


def _norm_cmp(v: Any) -> str:
	if v is None:
		return ""
	return str(v).strip()


def _coerce_value_for_field(doc, fieldname: str, value: Any):
	meta_field = None
	try:
		meta_field = doc.meta.get_field(fieldname)
	except Exception:
		meta_field = None
	fieldtype = str(getattr(meta_field, "fieldtype", "") or "").strip()
	raw = _norm_cmp(value)
	if not raw:
		return None
	if fieldtype in {"Int", "Check"}:
		try:
			return int(raw)
		except Exception:
			return 0
	if fieldtype in {"Float", "Currency", "Percent"}:
		try:
			return float(raw)
		except Exception:
			return 0.0
	if fieldtype == "Date":
		try:
			return getdate(raw)
		except Exception:
			return raw
	return raw


def _can_manage_project_comment(row: dict, user: str) -> bool:
	if not isinstance(row, dict):
		return False
	u = _clean_str(user)
	if not u:
		return False
	if u == "Administrator":
		return True
	try:
		if "System Manager" in (frappe.get_roles(u) or []):
			return True
	except Exception:
		pass
	return _clean_str(row.get("owner")) == u


def _parse_sb_activity_comment(content: Any) -> dict | None:
	raw = _clean_str(content)
	prefix = "SB_ACTIVITY::"
	if not raw.startswith(prefix):
		return None
	try:
		obj = frappe.parse_json(raw[len(prefix) :]) or {}
		if isinstance(obj, dict):
			return obj
	except Exception:
		return None
	return None


@frappe.whitelist()
def get_activity_users() -> dict:
	_ensure_logged_in()
	rows = frappe.get_all(
		"User",
		filters={"enabled": 1},
		fields=["name", "full_name"],
		limit_page_length=2000,
		order_by="full_name asc",
	)
	items = [
		{"user": r.get("name"), "label": r.get("full_name") or r.get("name")}
		for r in (rows or [])
		if r.get("name")
	]
	return {"items": items}


@frappe.whitelist()
def get_activity_log(
	limit_start: int = 0,
	limit_page_length: int = 50,
	user: str | None = None,
	target: str | None = None,
	activity: str | None = None,
	password: str | None = None,
) -> dict:
	_ensure_logged_in()

	limit_start = max(0, _normalize_int(limit_start, 0))
	limit_page_length = max(1, min(200, _normalize_int(limit_page_length, 50)))
	fetch_limit = max(200, limit_start + limit_page_length)

	target_doctypes = _target_doctypes(target)
	activity_set = _activity_filter(activity)
	user_filter = _clean_str(user)
	unlocked = _is_password_valid(password)

	events: list[dict] = []

	# Create events (doc creation)
	if "create" in activity_set:
		for dt in target_doctypes:
			filters = {}
			if user_filter:
				filters["owner"] = user_filter
			rows = frappe.get_all(
				dt,
				filters=filters,
				fields=["name", "owner", "creation"],
				order_by="creation desc",
				limit_page_length=fetch_limit,
			)
			for r in rows or []:
				events.append(
					{
						"action": "Create",
						"doctype": dt,
						"docname": r.get("name"),
						"user": r.get("owner"),
						"timestamp": r.get("creation"),
					}
				)

	# Update events (Version)
	if "update" in activity_set:
		v_filters: dict[str, Any] = {"ref_doctype": ["in", target_doctypes]}
		if user_filter:
			v_filters["owner"] = user_filter
		rows = frappe.get_all(
			"Version",
			filters=v_filters,
			fields=["ref_doctype", "docname", "owner", "creation"],
			order_by="creation desc",
			limit_page_length=fetch_limit,
		)
		for r in rows or []:
			events.append(
				{
					"action": "Update",
					"doctype": r.get("ref_doctype"),
					"docname": r.get("docname"),
					"user": r.get("owner"),
					"timestamp": r.get("creation"),
				}
			)

	# Delete events (Deleted Document)
	if "delete" in activity_set:
		d_filters: dict[str, Any] = {"deleted_doctype": ["in", target_doctypes]}
		if user_filter:
			d_filters["owner"] = user_filter
		rows = frappe.get_all(
			"Deleted Document",
			filters=d_filters,
			fields=["deleted_doctype", "deleted_name", "owner", "creation"],
			order_by="creation desc",
			limit_page_length=fetch_limit,
		)
		for r in rows or []:
			events.append(
				{
					"action": "Delete",
					"doctype": r.get("deleted_doctype"),
					"docname": r.get("deleted_name"),
					"user": r.get("owner"),
					"timestamp": r.get("creation"),
				}
			)

	# Sort & paginate
	events.sort(key=lambda x: str(x.get("timestamp") or ""), reverse=True)
	page = events[limit_start : limit_start + limit_page_length]

	user_cache: dict[str, str] = {}
	out_items = []
	for ev in page:
		doctype = _clean_str(ev.get("doctype"))
		is_project = doctype == "Project"
		target_label = "Project" if is_project else "Client"
		user_name = _clean_str(ev.get("user"))
		docname = _clean_str(ev.get("docname"))
		if unlocked:
			user_label = _get_user_fullname(user_name, user_cache) or user_name or "Unknown"
			doc_label = docname or "—"
		else:
			user_label = "Someone"
			doc_label = "a project" if is_project else "a client"

		out_items.append(
			{
				"action": ev.get("action"),
				"target": "project" if is_project else "client",
				"target_label": target_label,
				"user": user_name,
				"user_label": user_label,
				"docname": docname,
				"doc_label": doc_label,
				"timestamp": ev.get("timestamp"),
			}
		)

	return {
		"items": out_items,
		"meta": {
			"limit_start": limit_start,
			"limit_page_length": limit_page_length,
			"unlocked": unlocked,
			"total_count": len(events),
		},
	}


@frappe.whitelist()
def get_project_activity(project: str, limit_start: int = 0, limit_page_length: int = 100) -> dict:
	"""
	Project-centric activity feed for Smart Board popup.
	Returns update rows (who/when/field/from/to) parsed from Version.data.
	"""
	_ensure_logged_in()
	name = _clean_str(project)
	if not name:
		frappe.throw("project is required")
	if not frappe.has_permission("Project", "read", name):
		frappe.throw("Not permitted", frappe.PermissionError)

	limit_start = max(0, _normalize_int(limit_start, 0))
	limit_page_length = max(1, min(300, _normalize_int(limit_page_length, 100)))

	labels = _field_label_map("Project")
	user_cache: dict[str, str] = {}
	items: list[dict] = []

	# Creation event (single)
	try:
		created = frappe.db.get_value("Project", name, ["owner", "creation"], as_dict=True) or {}
		if created.get("creation"):
			user_name = _clean_str(created.get("owner"))
			items.append(
				{
					"action": "create",
					"field": "Project",
					"field_label": "Project",
					"from_value": "",
					"to_value": "Created",
					"user": user_name,
					"user_label": _get_user_fullname(user_name, user_cache) or user_name or "Unknown",
					"timestamp": created.get("creation"),
				}
			)
	except Exception:
		pass

	# Update events
	comment_rows = frappe.get_all(
		"Comment",
		filters={
			"reference_doctype": "Project",
			"reference_name": name,
			"comment_type": "Info",
		},
		fields=["name", "owner", "creation", "content"],
		order_by="creation desc",
		limit_page_length=5000,
	)
	for r in (comment_rows or []):
		payload = _parse_sb_activity_comment(r.get("content"))
		if not payload:
			continue
		field = _clean_str(payload.get("field"))
		if field and field not in _PROJECT_ACTIVITY_FIELDS:
			continue
		user_name = _clean_str(r.get("owner"))
		items.append(
			{
				"action": "update",
				"activity_name": r.get("name"),
				"field": field,
				"field_label": _clean_str(payload.get("field_label")) or labels.get(field) or field,
				"from_value": _short(payload.get("from_value")),
				"to_value": _short(payload.get("to_value")),
				"change_source": _clean_str(payload.get("change_source")),
				"automation_name": _clean_str(payload.get("automation_name")),
				"automation_run_id": _clean_str(payload.get("automation_run_id")),
				"automation_action_type": _clean_str(payload.get("automation_action_type")),
				"archive_source": _clean_str(payload.get("archive_source")),
				"archive_rule": _clean_str(payload.get("archive_rule")),
				"undoable": field in _PROJECT_ACTIVITY_UNDO_FIELDS,
				"user": user_name,
				"user_label": _get_user_fullname(user_name, user_cache) or user_name or "Unknown",
				"timestamp": r.get("creation"),
			}
		)

	# Project updates (comment_type=Comment): include in Last Updated feed.
	try:
		update_rows = frappe.get_all(
			"Comment",
			filters={
				"reference_doctype": "Project",
				"reference_name": name,
				"comment_type": "Comment",
			},
			fields=["name", "owner", "creation", "modified", "comment_by", "comment_email", "content"],
			order_by="creation desc",
			limit_page_length=5000,
			ignore_permissions=True,
		)
	except Exception:
		update_rows = []
	current_user = _clean_str(frappe.session.user)
	for r in (update_rows or []):
		content_plain = ""
		try:
			content_plain = _clean_str(frappe.utils.strip_html(r.get("content") or ""))
		except Exception:
			content_plain = _clean_str(r.get("content"))
		user_name = _clean_str(r.get("owner"))
		items.append(
			{
				"action": "comment",
				"kind": "update_comment",
				"update_name": r.get("name"),
				"content": content_plain,
				"is_edited": _clean_str(r.get("modified")) != _clean_str(r.get("creation")),
				"can_manage": _can_manage_project_comment(r, current_user),
				"user": user_name,
				"user_label": _clean_str(r.get("comment_by")) or _get_user_fullname(user_name, user_cache) or user_name or "Unknown",
				"timestamp": r.get("creation"),
			}
		)

	# Backward-compat fallback: old Version rows (only when no new structured comments yet)
	if not any((x.get("action") == "update") for x in items):
		rows = frappe.get_all(
			"Version",
			filters={"ref_doctype": "Project", "docname": name},
			fields=["name", "owner", "creation", "data"],
			order_by="creation desc",
			limit_page_length=2000,
		)

		for r in (rows or []):
			payload = _safe_json(r.get("data"))
			changed = payload.get("changed") if isinstance(payload, dict) else None
			if not isinstance(changed, list):
				continue
			user_name = _clean_str(r.get("owner"))
			user_label = _get_user_fullname(user_name, user_cache) or user_name or "Unknown"
			ts = r.get("creation")
			for c in changed:
				if not isinstance(c, (list, tuple)) or len(c) < 3:
					continue
				field = _clean_str(c[0])
				if not field:
					continue
				if field not in _PROJECT_ACTIVITY_FIELDS:
					continue
				items.append(
					{
						"action": "update",
						"activity_name": "",
						"field": field,
						"field_label": labels.get(field) or field,
						"from_value": _short(c[1]),
						"to_value": _short(c[2]),
						"undoable": False,
						"user": user_name,
						"user_label": user_label,
						"timestamp": ts,
					}
				)

	# Newest first
	items.sort(key=lambda x: str(x.get("timestamp") or ""), reverse=True)
	page = items[limit_start : limit_start + limit_page_length]
	return {
		"items": page,
		"meta": {
			"limit_start": limit_start,
			"limit_page_length": limit_page_length,
			"total_count": len(items),
		},
	}


@frappe.whitelist()
def undo_project_activity(project: str, activity_name: str, expected_to_value: str | None = None) -> dict:
	"""
	Undo a single project update row recorded by SB_ACTIVITY comment.
	Only supports safe scalar fields listed in _PROJECT_ACTIVITY_UNDO_FIELDS.
	"""
	_ensure_logged_in()
	name = _clean_str(project)
	activity = _clean_str(activity_name)
	if not name:
		frappe.throw("project is required")
	if not activity:
		frappe.throw("activity_name is required")
	if not frappe.has_permission("Project", "write", name):
		frappe.throw("Not permitted", frappe.PermissionError)

	row = frappe.db.get_value(
		"Comment",
		activity,
		["name", "reference_doctype", "reference_name", "comment_type", "content"],
		as_dict=True,
	)
	if not row:
		frappe.throw("Activity row not found")
	if _clean_str(row.get("reference_doctype")) != "Project" or _clean_str(row.get("reference_name")) != name:
		frappe.throw("Activity row does not belong to this project")
	if _clean_str(row.get("comment_type")) != "Info":
		frappe.throw("Unsupported activity row")

	payload = _parse_sb_activity_comment(row.get("content"))
	if not payload:
		frappe.throw("Unsupported activity row")
	field = _clean_str(payload.get("field"))
	if field not in _PROJECT_ACTIVITY_UNDO_FIELDS:
		frappe.throw("This update type cannot be undone")

	from_value = payload.get("from_value")
	to_value = payload.get("to_value")
	doc = frappe.get_doc("Project", name)
	current_value = doc.get(field)
	expected_now = expected_to_value if expected_to_value is not None else to_value
	if _norm_cmp(current_value) != _norm_cmp(expected_now):
		frappe.throw("Cannot undo because this field changed again")

	doc.flags.skip_board_automation = True
	doc.set(field, _coerce_value_for_field(doc, field, from_value))
	doc.save(ignore_permissions=True)
	return {"ok": True, "field": field, "value": doc.get(field)}


_PROJECT_ACTIVITY_FIELDS = {
	"customer",
	"project_name",
	"status",
	"expected_end_date",
	"expected_start_date",
	"notes",
	"company",
	"custom_lodgement_due_date",
	"custom_target_month",
	"priority",
	"estimated_costing",
	"custom_entity_type",
	"custom_customer_entity",
	"project_type",
	"custom_project_frequency",
	"custom_fiscal_year",
	"custom_reset_date",
	"is_active",
	"custom_team_members",
	"custom_softwares",
	"custom_engagement_letter",
}


_PROJECT_ACTIVITY_UNDO_FIELDS = {
	"status",
	"project_name",
	"company",
	"project_type",
	"custom_project_frequency",
	"custom_fiscal_year",
	"custom_entity_type",
	"custom_customer_entity",
	"custom_lodgement_due_date",
	"custom_target_month",
	"custom_reset_date",
	"custom_engagement_letter",
	"is_active",
	"priority",
	"estimated_costing",
	"expected_start_date",
	"expected_end_date",
}

