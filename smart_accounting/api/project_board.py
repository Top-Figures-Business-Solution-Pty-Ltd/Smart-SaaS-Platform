"""
Smart Board - Project editing APIs

These APIs exist to keep the frontend architecture healthy:
- Complex columns (child tables / table multiselect) should NOT be mutated via
  ad-hoc `frappe.client.set_value` payloads from the browser.
- Instead, the frontend submits a small, validated payload, and backend performs
  a controlled update on the Project doc.

All methods are website-safe (usable from /smart shell) and permission-aware.
"""

from __future__ import annotations

from typing import Any, Iterable

import frappe
from frappe.utils import today


def _ensure_write_permission(doc) -> None:
	# Enforce standard permission checks (no ignore_permissions here).
	if not doc.has_permission("write"):
		frappe.throw("Not permitted", frappe.PermissionError)

def _ensure_logged_in() -> None:
	if frappe.session.user in (None, "", "Guest"):
		frappe.throw("Not permitted", frappe.PermissionError)


def _normalize_list(value: Any) -> list:
	if value is None:
		return []
	if isinstance(value, list):
		return value
	# Accept JSON string from frappe.call
	if isinstance(value, str):
		try:
			parsed = frappe.parse_json(value)
			return parsed if isinstance(parsed, list) else []
		except Exception:
			return []
	return []


def _normalize_int(value: Any, default: int = 0) -> int:
	try:
		return int(value)
	except Exception:
		return int(default)


def _parse_json_if_string(value: Any) -> Any:
	if not isinstance(value, str):
		return value
	try:
		return frappe.parse_json(value)
	except Exception:
		return value


def _sanitize_project_list_fields(fields: Any) -> list[str]:
	req_fields = [str(x).strip() for x in _normalize_list(fields) if str(x).strip()]
	if not req_fields:
		return req_fields

	# Safety: drop unknown/non-column fields to avoid SQL 1054 when a site
	# hasn't synced a newly introduced Custom Field yet (e.g. custom_reset_date).
	try:
		meta = frappe.get_meta("Project")
		type_by_field = {
			str(getattr(df, "fieldname", "") or "").strip(): str(getattr(df, "fieldtype", "") or "").strip()
			for df in (meta.fields or [])
			if str(getattr(df, "fieldname", "") or "").strip()
		}
		known = set(type_by_field.keys())
		known |= {"name", "owner", "creation", "modified", "modified_by", "docstatus", "idx", "_user_tags", "_comments", "_assign", "_liked_by"}
		req_fields = [
			f for f in req_fields
			if (
				(str(f or "").strip() in known)
				and (type_by_field.get(str(f or "").strip(), "") not in {"Table", "Table MultiSelect"})
			)
		]
	except Exception:
		# Best-effort only; keep original behavior on meta failure.
		pass

	# Ensure enrich paths have the necessary inputs (adds minimal payload, safe for callers)
	try:
		if "customer" not in req_fields:
			req_fields.append("customer")
		if ("custom_entity_type" in req_fields or "custom_year_end" in req_fields) and "custom_customer_entity" not in req_fields:
			req_fields.append("custom_customer_entity")
	except Exception:
		pass
	return req_fields


def _enrich_project_rows(rows: list[dict], requested_fields: list[str] | None = None) -> list[dict]:
	out = list(rows or [])
	req_fields = [str(x).strip() for x in (requested_fields or []) if str(x).strip()]

	try:
		_attach_customer_name(out)
	except Exception:
		pass

	need_entity = "custom_entity_type" in req_fields or "custom_customer_entity" in req_fields
	if need_entity:
		try:
			_attach_effective_entity_type(out)
		except Exception:
			pass

	need_year_end = "custom_year_end" in req_fields
	if need_year_end:
		try:
			_attach_effective_year_end(out)
		except Exception:
			pass

	return out


def _get_readable_project_rows(
	names: Any,
	*,
	fields: list[str] | None = None,
	active_only: bool = False,
	limit_page_length: int = 100000,
) -> tuple[list[str], list[dict]]:
	project_names = [str(x).strip() for x in _normalize_list(names) if str(x).strip()]
	if not project_names:
		return [], []

	allowed = _project_names_with_read_permission(project_names)
	allowed = [str(x).strip() for x in (allowed or []) if str(x).strip()]
	if not allowed:
		return [], []

	project_filters = [["name", "in", allowed]]
	if active_only:
		project_filters.append(["is_active", "=", "Yes"])

	try:
		rows = frappe.get_all(
			"Project",
			filters=project_filters,
			fields=fields or ["name"],
			limit_page_length=limit_page_length,
		)
	except frappe.PermissionError:
		return allowed, []
	return allowed, rows or []


def _get_task_team_fieldname() -> str | None:
	"""
		Find the Task table field that points to Project Team Member.
		Prefer fieldname 'custom_task_members' if present.
	"""
	def _find(meta) -> str | None:
		if not meta:
			return None
		candidate = None
		for f in (meta.fields or []):
			if str(f.fieldtype or "") != "Table":
				continue
			if str(f.options or "") != "Project Team Member":
				continue
			if str(f.fieldname or "") == "custom_task_members":
				return "custom_task_members"
			if str(f.fieldname or "") == "custom_team_members":
				return "custom_team_members"
			if not candidate:
				candidate = str(f.fieldname or "") or None
		return candidate

	try:
		meta = frappe.get_meta("Task")
		fieldname = _find(meta)
		if fieldname:
			return fieldname
		# Cache could be stale if Custom Field was just added
		try:
			frappe.clear_cache(doctype="Task")
		except Exception:
			pass
		meta = frappe.get_meta("Task", cached=False)
		return _find(meta)
	except Exception:
		return None


def _uniq_preserve_order(items: Iterable[tuple]) -> list[tuple]:
	seen = set()
	out = []
	for x in items:
		if x in seen:
			continue
		seen.add(x)
		out.append(x)
	return out


def _attach_user_image(rows: list[dict]) -> list[dict]:
	"""
	Attach `user_image` + `user_full_name` to Project Team Member-style rows for UI avatar rendering.

	Permission model:
	- Uses `get_user_meta()` which respects User permissions; if User cannot be read,
	  images will be empty (safe).
	"""
	try:
		users = [str(r.get("user") or "").strip() for r in (rows or []) if str(r.get("user") or "").strip()]
	except Exception:
		users = []

	meta = {}
	if users:
		try:
			meta = get_user_meta(users) or {}
		except Exception:
			meta = {}

	for r in (rows or []):
		try:
			u = str(r.get("user") or "").strip()
		except Exception:
			u = ""
		try:
			m = meta.get(u) or {}
			img = m.get("image") or ""
			label = m.get("label") or ""
		except Exception:
			img = ""
			label = ""
		r["user_image"] = img or ""
		# Full name (for initials like "JR" instead of "J")
		r["user_full_name"] = label or ""
	return rows


def _attach_customer_name(project_rows: list[dict]) -> list[dict]:
	"""
	Attach `customer_name` onto Project list rows based on Project.customer (Customer.name).

	Rationale:
	- Project.customer stores Customer.name (ID/docname), which may not be human-friendly when
	  Customer Naming By = Naming Series (e.g. CUST-0001).
	- Smart Board UI should display the readable Client Name consistently across environments.

	Behavior:
	- Best-effort only: on any error, rows are returned unchanged.
	- Adds:
	  - customer_name: Customer.customer_name (fallback to Project.customer)
	"""
	rows = list(project_rows or [])
	if not rows:
		return rows

	ids = []
	for r in rows:
		try:
			c = str(r.get("customer") or "").strip()
		except Exception:
			c = ""
		if c:
			ids.append(c)
	if not ids:
		return rows

	# de-dupe (stable order)
	seen = set()
	uniq = []
	for x in ids:
		if x in seen:
			continue
		seen.add(x)
		uniq.append(x)

	by_id: dict[str, str] = {}

	# Permission-aware first; fall back to ignore_permissions for website shell.
	try:
		crows = frappe.get_list(
			"Customer",
			filters=[["name", "in", uniq]],
			fields=["name", "customer_name"],
			limit_page_length=len(uniq),
		)
	except frappe.PermissionError:
		try:
			crows = frappe.get_list(
				"Customer",
				filters=[["name", "in", uniq]],
				fields=["name", "customer_name"],
				limit_page_length=len(uniq),
				ignore_permissions=True,
			)
		except Exception:
			crows = []
	except Exception:
		crows = []

	for c in (crows or []):
		cid = str(c.get("name") or "").strip()
		label = str(c.get("customer_name") or "").strip()
		if cid:
			by_id[cid] = label or cid

	for r in rows:
		try:
			cid = str(r.get("customer") or "").strip()
		except Exception:
			cid = ""
		if not cid:
			continue
		# Preserve existing customer_name if caller already provided it.
		if r.get("customer_name"):
			continue
		r["customer_name"] = by_id.get(cid) or cid

	return rows


def _attach_effective_entity_type(project_rows: list[dict]) -> list[dict]:
	"""
	Attach Project.custom_entity_type for UI display when missing.
	Uses:
	- Project.custom_customer_entity override -> Customer Entity.entity_type
	- fallback -> Customer primary entity (Customer Entity where parent=<customer> and is_primary=1)
	"""
	try:
		from smart_accounting.api.project_entity import attach_effective_entity_type
	except Exception:
		return project_rows
	try:
		return attach_effective_entity_type(project_rows)
	except Exception:
		return project_rows


def _attach_effective_year_end(project_rows: list[dict]) -> list[dict]:
	"""
	Attach Project.custom_year_end for UI display when missing.
	Uses:
	- Project.custom_customer_entity override -> Customer Entity.year_end
	- fallback -> Customer primary entity year_end
	"""
	rows = list(project_rows or [])
	if not rows:
		return rows
	customers = [str(r.get("customer") or "").strip() for r in rows if str(r.get("customer") or "").strip()]
	links = [str(r.get("custom_customer_entity") or "").strip() for r in rows if str(r.get("custom_customer_entity") or "").strip()]
	customers = list(dict.fromkeys(customers))
	links = list(dict.fromkeys(links))

	by_link: dict[str, str] = {}
	by_customer_primary: dict[str, str] = {}

	if links:
		try:
			erows = frappe.get_all(
				"Customer Entity",
				filters=[["name", "in", links]],
				fields=["name", "year_end"],
				ignore_permissions=True,
				limit_page_length=100000,
			)
			for e in erows or []:
				n = str(e.get("name") or "").strip()
				y = str(e.get("year_end") or "").strip()
				if n and y:
					by_link[n] = y
		except Exception:
			pass

	if customers:
		try:
			prows = frappe.get_all(
				"Customer Entity",
				filters=[["parent", "in", customers], ["is_primary", "=", 1]],
				fields=["parent", "year_end"],
				ignore_permissions=True,
				limit_page_length=100000,
			)
			for e in prows or []:
				c = str(e.get("parent") or "").strip()
				y = str(e.get("year_end") or "").strip()
				if c and y and c not in by_customer_primary:
					by_customer_primary[c] = y
		except Exception:
			pass

	for r in rows:
		try:
			if str(r.get("custom_year_end") or "").strip():
				continue
			link = str(r.get("custom_customer_entity") or "").strip()
			if link and link in by_link:
				r["custom_year_end"] = by_link.get(link) or ""
				continue
			c = str(r.get("customer") or "").strip()
			if c and c in by_customer_primary:
				r["custom_year_end"] = by_customer_primary.get(c) or ""
		except Exception:
			continue
	return rows


def _project_names_with_read_permission(names: list[str]) -> list[str]:
	# Respect Project permissions first; this bounds all downstream queries.
	allowed = frappe.get_all("Project", filters=[["name", "in", names]], pluck="name")
	return [str(x) for x in (allowed or [])]


def _year_end_to_month_num(year_end: str | None) -> int | None:
	"""
	Map Customer Entity.year_end (Select) to month number.
	Expected values: June/December/March/September (case-insensitive).
	"""
	if not year_end:
		return None
	s = str(year_end).strip().lower()
	m = {
		"june": 6,
		"december": 12,
		"march": 3,
		"september": 9,
	}.get(s)
	return int(m) if m else None


def _fy_start_month_from_year_end(year_end: str | None) -> int | None:
	m = _year_end_to_month_num(year_end)
	if not m:
		return None
	return (m % 12) + 1


def _get_project_fy_start_months(project_rows: list[dict]) -> tuple[dict[str, int], dict[int, int]]:
	"""
	Compute fiscal start month per Project:
	- Prefer Project.custom_customer_entity.year_end (override)
	- Fallback to Customer primary entity year_end

	Returns:
	- by_project: { project_name: start_month_int }
	- counts: { start_month_int: n_projects }
	"""
	by_project: dict[str, int] = {}
	counts: dict[int, int] = {}

	projects = [r for r in (project_rows or []) if r.get("name")]
	if not projects:
		return by_project, counts

	# 1) Collect customers + entity links
	customers = [str(r.get("customer") or "").strip() for r in projects if str(r.get("customer") or "").strip()]
	entity_links = [str(r.get("custom_customer_entity") or "").strip() for r in projects if str(r.get("custom_customer_entity") or "").strip()]
	customers = list(dict.fromkeys(customers))
	entity_links = list(dict.fromkeys(entity_links))

	# 2) Fetch year_end for linked Customer Entity rows (override path)
	entity_year_end: dict[str, str] = {}
	if entity_links:
		try:
			rows = frappe.get_all(
				"Customer Entity",
				filters=[["name", "in", entity_links]],
				fields=["name", "year_end"],
				ignore_permissions=True,
				limit_page_length=100000,
			)
			for r in (rows or []):
				n = str(r.get("name") or "").strip()
				ye = str(r.get("year_end") or "").strip()
				if n and ye:
					entity_year_end[n] = ye
		except Exception:
			pass

	# 3) Fetch primary entity year_end per customer (fallback path)
	customer_year_end: dict[str, str] = {}
	if customers:
		try:
			rows = frappe.get_all(
				"Customer Entity",
				filters=[["parent", "in", customers], ["is_primary", "=", 1]],
				fields=["parent", "year_end"],
				ignore_permissions=True,
				limit_page_length=100000,
			)
			for r in (rows or []):
				c = str(r.get("parent") or "").strip()
				ye = str(r.get("year_end") or "").strip()
				if c and ye and c not in customer_year_end:
					customer_year_end[c] = ye
		except Exception:
			pass

	# 4) Build per-project mapping
	for r in projects:
		pn = str(r.get("name") or "").strip()
		if not pn:
			continue
		ye = None
		el = str(r.get("custom_customer_entity") or "").strip()
		if el and el in entity_year_end:
			ye = entity_year_end.get(el)
		if not ye:
			c = str(r.get("customer") or "").strip()
			ye = customer_year_end.get(c)
		start = _fy_start_month_from_year_end(ye)
		if start:
			by_project[pn] = start
			counts[start] = int(counts.get(start, 0)) + 1

	return by_project, counts


@frappe.whitelist()
def get_projects_list(
	fields: Any = None,
	filters: Any = None,
	or_filters: Any = None,
	order_by: str | None = "project_name asc, name asc",
	limit_start: int = 0,
	limit_page_length: int = 100,
) -> dict:
	"""
	Website-safe Project list query for Smart Board.

	Why:
	- `Project.customer` stores Customer.name (ID/docname). In some sites this is a naming series
	  (e.g. CUST-0001) and is not user-friendly.
	- This API returns the same Project rows as `frappe.client.get_list('Project')` but also
	  attaches `customer_name` for UI display.

	Notes:
	- This is a READ path only.
	- It is designed to be a drop-in replacement for the frontend's get_list call.
	- Best-effort: on mapping failure we keep returning the base Project rows.

	Returns:
	- { items: [ {field: value, ..., customer_name?}, ... ] }
	"""
	_ensure_logged_in()

	# Normalize inputs (frappe.call may send JSON strings)
	fields = _parse_json_if_string(fields)
	filters = _parse_json_if_string(filters)
	or_filters = _parse_json_if_string(or_filters)

	req_fields = _sanitize_project_list_fields(fields)
	req_filters = filters if isinstance(filters, (list, dict)) else []
	req_or_filters = _normalize_list(or_filters)

	try:
		limit_start = int(limit_start or 0)
	except Exception:
		limit_start = 0
	try:
		limit_page_length = int(limit_page_length or 100)
	except Exception:
		limit_page_length = 100
	limit_start = max(0, limit_start)
	limit_page_length = max(1, min(1000, limit_page_length))

	try:
		rows = frappe.get_list(
			"Project",
			fields=req_fields or ["name"],
			filters=req_filters,
			or_filters=req_or_filters,
			order_by=str(order_by or "project_name asc, name asc"),
			limit_start=limit_start,
			limit_page_length=limit_page_length,
		)
	except frappe.PermissionError:
		# Keep old behavior: return empty if user cannot read Project.
		return {"items": []}

	return {"items": _enrich_project_rows(rows, req_fields)}


@frappe.whitelist()
def get_board_fiscal_start_month(projects: Any) -> dict:
	"""
	Return board-level fiscal start month (1-12) based on projects' primary year_end.
	We choose the most common start_month across the provided projects.

	Returns:
	- start_month: int | None
	- counts: { start_month: n }
	- by_project: { project_name: start_month }
	"""
	_ensure_logged_in()
	allowed, prows = _get_readable_project_rows(
		projects,
		fields=["name", "customer", "custom_customer_entity"],
		active_only=False,
	)
	if not allowed:
		return {"start_month": None, "counts": {}, "by_project": {}}
	by_project, counts = _get_project_fy_start_months(prows or [])
	start_month = None
	if counts:
		start_month = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
	return {"start_month": start_month, "counts": counts, "by_project": by_project}


@frappe.whitelist()
def set_monthly_status(reference_doctype: str, reference_name: str, fiscal_year: str, month_index: int, status: str) -> dict:
	"""
	Upsert a Monthly Status cell.
	- reference_doctype: Task (today) or Project (future)
	- fiscal_year: Link to Fiscal Year
	- month_index: 1-12 (board fiscal order)
	- status: Not Started / Working On It / Stuck / Done
	"""
	_ensure_logged_in()
	reference_doctype = str(reference_doctype or "").strip()
	reference_name = str(reference_name or "").strip()
	fiscal_year = str(fiscal_year or "").strip()
	status = str(status or "").strip()
	try:
		month_index = int(month_index or 0)
	except Exception:
		month_index = 0

	if not reference_doctype or not reference_name:
		frappe.throw("Missing reference")
	if not fiscal_year:
		frappe.throw("Missing fiscal_year")
	if month_index < 1 or month_index > 12:
		frappe.throw("Invalid month_index")
	if status not in {"Not Started", "Working On It", "Stuck", "Done"}:
		frappe.throw("Invalid status")

	# Permission boundary: user must be able to WRITE the referenced doc.
	ref = frappe.get_doc(reference_doctype, reference_name)
	_ensure_write_permission(ref)

	project = ""
	if reference_doctype == "Task":
		project = str(getattr(ref, "project", "") or "").strip()
	elif reference_doctype == "Project":
		project = reference_name

	# Upsert Monthly Status (ignore perms on this helper doctype; bounded by ref permission above)
	filters = {
		"reference_doctype": reference_doctype,
		"reference_name": reference_name,
		"fiscal_year": fiscal_year,
		"month_index": month_index,
	}
	existing = frappe.get_all("Monthly Status", filters=filters, pluck="name", limit_page_length=1, ignore_permissions=True)
	if existing:
		ms = frappe.get_doc("Monthly Status", existing[0])
		ms.status = status
		if project:
			ms.project = project
		ms.save(ignore_permissions=True)
	else:
		ms = frappe.new_doc("Monthly Status")
		ms.reference_doctype = reference_doctype
		ms.reference_name = reference_name
		if project:
			ms.project = project
		ms.fiscal_year = fiscal_year
		ms.month_index = month_index
		ms.status = status
		ms.insert(ignore_permissions=True)

	return {"ok": True, "name": ms.name, "project": project, "reference_name": reference_name, "month_index": month_index, "status": status}


@frappe.whitelist()
def get_monthly_status_bundle(
	projects: Any,
	include_tasks: int = 1,
	include_matrix: int = 1,
	include_summary: int = 1,
	limit_per_project: int = 500,
	task_fields: Any = None,
) -> dict:
	"""
	Bulk load Monthly Status for a list of Projects.

	Returns:
	- start_month: int | None (board-level, mode of projects)
	- tasks: { project_name: [ {name, subject, project}, ... ] }  (optional)
	- matrix: { task_name: { month_index: status } } (optional)
	- summary: { project_name: { month_index: {done,total,percent} } } (optional)
	- fiscal_year: { project_name: fiscal_year } (best-effort)
	"""
	_ensure_logged_in()
	allowed_projects, prows = _get_readable_project_rows(
		projects,
		fields=["name", "customer", "custom_customer_entity", "custom_fiscal_year"],
		active_only=False,
	)
	if not allowed_projects:
		return {"start_month": None, "tasks": {}, "matrix": {}, "summary": {}, "fiscal_year": {}}
	by_project_start, counts = _get_project_fy_start_months(prows or [])
	start_month = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if counts else None

	# fiscal year per project (best-effort)
	by_fy = {str(r.get("name")): str(r.get("custom_fiscal_year") or "").strip() for r in (prows or []) if r.get("name")}

	# Task fields (allowlist). Always include name+project+subject.
	allowed_task_fields = {
		"name",
		"subject",
		"status",
		"priority",
		"exp_start_date",
		"exp_end_date",
		"modified",
		"creation",
		"owner",
		"project",
		"parent_task",
		"custom_team_members",
	}
	req_task_fields = _normalize_list(task_fields)
	req_task_fields = [str(x).strip() for x in req_task_fields if str(x).strip()]
	final_task_fields = ["name", "project"]
	need_team = False
	for f in req_task_fields:
		if f == "custom_team_members":
			need_team = True
			continue
		if f in allowed_task_fields and f not in final_task_fields:
			final_task_fields.append(f)
	if "subject" not in final_task_fields:
		final_task_fields.append("subject")

	# Load tasks in one query; cut per-project to limit_per_project.
	limit_per_project = int(limit_per_project or 500)
	limit_per_project = max(1, min(limit_per_project, 2000))

	# Total tasks per project (for summary). Prefer an aggregated query so summary isn't affected by per-project limits.
	task_total_by_project: dict[str, int] = {p: 0 for p in allowed_projects}
	try:
		total_rows = frappe.get_all(
			"Task",
			filters=[["project", "in", allowed_projects]],
			fields=["project", "count(name) as total"],
			group_by="project",
			limit_page_length=100000,
		)
		for r in (total_rows or []):
			p = str(r.get("project") or "").strip()
			if not p:
				continue
			try:
				task_total_by_project[p] = int(r.get("total") or 0)
			except Exception:
				task_total_by_project[p] = int(task_total_by_project.get(p, 0))
	except frappe.PermissionError:
		# Fallback: if Task permissions block counts, we will compute totals from the visible task list later.
		task_total_by_project = {p: 0 for p in allowed_projects}

	tasks_by_project: dict[str, list[dict]] = {p: [] for p in allowed_projects}
	all_tasks: list[dict] = []
	if int(include_tasks or 0) or int(include_matrix or 0) or int(include_summary or 0):
		try:
			rows = frappe.get_all(
				"Task",
				filters=[["project", "in", allowed_projects]],
				fields=final_task_fields,
				order_by="subject asc, name asc",
				limit_page_length=100000,
			)
		except frappe.PermissionError:
			rows = []

		# Keep per-project limited list (stable order: subject asc, name asc)
		per_count: dict[str, int] = {}
		for t in (rows or []):
			p = str(t.get("project") or "").strip()
			if not p or p not in tasks_by_project:
				continue
			n = int(per_count.get(p, 0))
			if n >= limit_per_project:
				continue
			per_count[p] = n + 1
			row = dict(t)
			row["project"] = p
			tasks_by_project[p].append(row)
			all_tasks.append(row)

		# Attach Task.custom_team_members (child table) if requested
		if need_team and rows:
			fieldname = _get_task_team_fieldname()
			task_names = [r.get("name") for r in rows if r.get("name")]
			if fieldname and task_names:
				try:
					members = frappe.get_all(
						"Project Team Member",
						filters={"parenttype": "Task", "parent": ["in", task_names], "parentfield": fieldname},
						fields=["parent", "user", "role", "assigned_date"],
						limit_page_length=100000,
					)
				except frappe.PermissionError:
					members = []
				by_task = {}
				for m in (members or []):
					parent = m.get("parent")
					if not parent:
						continue
					by_task.setdefault(parent, []).append(m)
				by_name = {r.get("name"): r for r in (all_tasks or []) if r.get("name")}
				for tn, members_list in by_task.items():
					if tn in by_name:
						if fieldname:
							by_name[tn][fieldname] = members_list
						if fieldname != "custom_team_members":
							by_name[tn]["custom_team_members"] = members_list

		# Fallback total counts when we couldn't read aggregated totals.
		if not any(task_total_by_project.values()):
			for p in allowed_projects:
				task_total_by_project[p] = len(tasks_by_project.get(p) or [])

	matrix: dict[str, dict[int, str]] = {}
	status_counts: dict[str, dict[int, dict[str, int]]] = {}  # project -> mi -> {done, working_on_it, stuck}
	if int(include_matrix or 0) or int(include_summary or 0):
		task_names = [str(t.get("name") or "").strip() for t in all_tasks if str(t.get("name") or "").strip()]
		task_names = list(dict.fromkeys(task_names))
		fys = list({fy for fy in by_fy.values() if fy})

		# If caller needs the full matrix (expanded task table), fetch detailed rows for those tasks.
		if int(include_matrix or 0) and task_names and fys:
			ms_rows = frappe.get_all(
				"Monthly Status",
				filters=[
					["reference_doctype", "=", "Task"],
					["reference_name", "in", task_names],
					["fiscal_year", "in", fys],
					["month_index", ">=", 1],
					["month_index", "<=", 12],
				],
				fields=["reference_name", "fiscal_year", "month_index", "status", "project"],
				ignore_permissions=True,
				limit_page_length=200000,
			)
			for r in (ms_rows or []):
				tn = str(r.get("reference_name") or "").strip()
				p = str(r.get("project") or "").strip()
				fy = str(r.get("fiscal_year") or "").strip()
				try:
					mi = int(r.get("month_index") or 0)
				except Exception:
					mi = 0
				st = str(r.get("status") or "").strip()
				if not tn or mi < 1 or mi > 12 or not st:
					continue
				# Only count rows matching the project's FY (best-effort)
				if p and by_fy.get(p) and fy and fy != by_fy.get(p):
					continue
				matrix.setdefault(tn, {})[mi] = st
				if p:
					bucket = status_counts.setdefault(p, {}).setdefault(mi, {"done": 0, "working_on_it": 0, "stuck": 0})
					if st == "Done":
						bucket["done"] = int(bucket.get("done") or 0) + 1
					elif st == "Working On It":
						bucket["working_on_it"] = int(bucket.get("working_on_it") or 0) + 1
					elif st == "Stuck":
						bucket["stuck"] = int(bucket.get("stuck") or 0) + 1

		# For summary, fetch aggregated status counts on ALL tasks (not limited by include_matrix rows).
		if int(include_summary or 0) and fys:
			try:
				agg_rows = frappe.get_all(
					"Monthly Status",
					filters=[
						["reference_doctype", "=", "Task"],
						["project", "in", allowed_projects],
						["fiscal_year", "in", fys],
						["month_index", ">=", 1],
						["month_index", "<=", 12],
						["status", "in", ["Done", "Working On It", "Stuck"]],
					],
					fields=["project", "fiscal_year", "month_index", "status", "count(name) as cnt"],
					group_by="project, fiscal_year, month_index, status",
					ignore_permissions=True,
					limit_page_length=200000,
				)
			except Exception:
				agg_rows = []
			# Use aggregated rows as source of truth for summary status segments.
			status_counts = {}
			for r in (agg_rows or []):
				p = str(r.get("project") or "").strip()
				fy = str(r.get("fiscal_year") or "").strip()
				try:
					mi = int(r.get("month_index") or 0)
				except Exception:
					mi = 0
				st = str(r.get("status") or "").strip()
				try:
					cnt = int(r.get("cnt") or 0)
				except Exception:
					cnt = 0
				if not p or mi < 1 or mi > 12 or cnt <= 0:
					continue
				if by_fy.get(p) and fy and fy != by_fy.get(p):
					continue
				bucket = status_counts.setdefault(p, {}).setdefault(mi, {"done": 0, "working_on_it": 0, "stuck": 0})
				if st == "Done":
					bucket["done"] = int(bucket.get("done") or 0) + cnt
				elif st == "Working On It":
					bucket["working_on_it"] = int(bucket.get("working_on_it") or 0) + cnt
				elif st == "Stuck":
					bucket["stuck"] = int(bucket.get("stuck") or 0) + cnt

	# Summary per project
	summary: dict[str, dict[int, dict]] = {}
	if int(include_summary or 0):
		for p in allowed_projects:
			total = int(task_total_by_project.get(p, 0) or 0)
			months = {}
			for mi in range(1, 13):
				s = (status_counts.get(p) or {}).get(mi) or {}
				done = int(s.get("done") or 0)
				working_on_it = int(s.get("working_on_it") or 0)
				stuck = int(s.get("stuck") or 0)
				percent = float(done) / float(total) * 100.0 if total else 0.0
				months[mi] = {
					"done": done,
					"working_on_it": working_on_it,
					"stuck": stuck,
					"total": total,
					"percent": percent,
				}
			summary[p] = months

	out = {
		"start_month": start_month,
		"start_month_by_project": by_project_start,
		"start_month_counts": counts,
		"fiscal_year": by_fy,
	}
	if int(include_tasks or 0):
		out["tasks"] = tasks_by_project
	if int(include_matrix or 0):
		out["matrix"] = matrix
	if int(include_summary or 0):
		out["summary"] = summary
	return out


@frappe.whitelist()
def set_project_team_members(project: str, members: Any) -> dict:
	"""
	Replace Project.custom_team_members (child table: Project Team Member).

	Payload members:
	- list of { user: str, role: str } OR JSON string of that list

	We store:
	- user (Link/User)
	- role (Select options from Project Team Member meta)
	- assigned_date (today)
	"""
	if not project:
		frappe.throw("Missing project")

	doc = frappe.get_doc("Project", project)
	_ensure_write_permission(doc)

	rows = _normalize_list(members)
	normalized = []
	for m in rows:
		if not isinstance(m, dict):
			continue
		user = (m.get("user") or "").strip()
		role = (m.get("role") or "").strip() or "Preparer"
		if not user:
			continue
		normalized.append((user, role))

	normalized = _uniq_preserve_order(normalized)

	# Replace table
	doc.set("custom_team_members", [])
	for user, role in normalized:
		doc.append(
			"custom_team_members",
			{
				"user": user,
				"role": role,
				"assigned_date": today(),
			},
		)

	doc.save()

	out_rows = []
	for m in (doc.get("custom_team_members") or []):
		u = str(getattr(m, "user", "") or "").strip()
		r = str(getattr(m, "role", "") or "").strip()
		if not u or not r:
			continue
		out_rows.append(
			{
				"user": u,
				"role": r,
				"assigned_date": getattr(m, "assigned_date", None),
			}
		)
	_attach_user_image(out_rows)

	return {
		"project": doc.name,
		"custom_team_members": out_rows,
	}


@frappe.whitelist()
def set_project_softwares(project: str, softwares: Any) -> dict:
	"""
	Replace Project.custom_softwares (Table MultiSelect -> child doctype: Project Software).

	Payload softwares:
	- list of strings (Software name) OR list of { software: str } OR JSON string
	"""
	if not project:
		frappe.throw("Missing project")

	doc = frappe.get_doc("Project", project)
	_ensure_write_permission(doc)

	rows = _normalize_list(softwares)
	values: list[str] = []

	for x in rows:
		if isinstance(x, str):
			v = x.strip()
		elif isinstance(x, dict):
			v = str(x.get("software") or "").strip()
		else:
			v = ""
		if not v:
			continue
		values.append(v)

	values = [v for (v,) in _uniq_preserve_order([(v,) for v in values])]

	# Replace table. For Table MultiSelect, child rows usually store link in `software`.
	doc.set("custom_softwares", [])
	for v in values:
		doc.append("custom_softwares", {"software": v})

	doc.save()

	return {
		"project": doc.name,
		"custom_softwares": doc.get("custom_softwares") or [],
	}


@frappe.whitelist()
def bulk_set_project_field(projects: Any, field: str, value: Any) -> dict:
	"""
	Bulk update a single field across many Projects (single request).

	- Permission-aware: checks write permission per Project.
	- Field must exist on Project; otherwise save() will raise.

	Returns:
	- updated: list of project names updated
	"""
	_ensure_logged_in()
	names = _normalize_list(projects)
	names = [str(x).strip() for x in names if str(x).strip()]
	field = (field or "").strip()
	if not names:
		return {"updated": []}
	if not field:
		frappe.throw("Missing field")

	updated: list[str] = []
	for name in names:
		doc = frappe.get_doc("Project", name)
		_ensure_write_permission(doc)
		doc.set(field, value)
		doc.save()
		updated.append(doc.name)

	return {"updated": updated}


@frappe.whitelist()
def bulk_set_project_softwares(projects: Any, softwares: Any) -> dict:
	"""
	Bulk replace Project.custom_softwares (Table MultiSelect) for many Projects.
	Same softwares list is applied to all selected Projects.

	Returns:
	- softwares: { project_name: [ {software: str}, ... ] }
	"""
	_ensure_logged_in()
	names = _normalize_list(projects)
	names = [str(x).strip() for x in names if str(x).strip()]
	if not names:
		return {"softwares": {}}

	rows = _normalize_list(softwares)
	values: list[str] = []
	for x in rows:
		if isinstance(x, str):
			v = x.strip()
		elif isinstance(x, dict):
			v = str(x.get("software") or "").strip()
		else:
			v = ""
		if v:
			values.append(v)
	values = [v for (v,) in _uniq_preserve_order([(v,) for v in values])]
	# canonical child row shape for UI
	child_rows = [{"software": v} for v in values]

	out = {}
	for name in names:
		doc = frappe.get_doc("Project", name)
		_ensure_write_permission(doc)
		doc.set("custom_softwares", [])
		for v in values:
			doc.append("custom_softwares", {"software": v})
		doc.save()
		out[doc.name] = doc.get("custom_softwares") or child_rows

	return {"softwares": out}


@frappe.whitelist()
def bulk_set_project_team_role(projects: Any, role: str, users: Any) -> dict:
	"""
	Bulk update ONE role column (team:<Role>) across many Projects.
	We replace only rows where custom_team_members.role == role, and keep other roles.

	Returns:
	- team: { project_name: [ {user, role, assigned_date}, ... ] }
	"""
	_ensure_logged_in()
	names = _normalize_list(projects)
	names = [str(x).strip() for x in names if str(x).strip()]
	role = (role or "").strip()
	if not names:
		return {"team": {}}
	if not role:
		frappe.throw("Missing role")

	rows = _normalize_list(users)
	users_clean = [str(x).strip() for x in rows if str(x).strip()]
	users_clean = [u for (u,) in _uniq_preserve_order([(u,) for u in users_clean])]

	out = {}
	for name in names:
		doc = frappe.get_doc("Project", name)
		_ensure_write_permission(doc)

		existing = doc.get("custom_team_members") or []
		kept = []
		for m in existing:
			if str(getattr(m, "role", "") or "").strip() != role:
				kept.append({"user": getattr(m, "user", None), "role": getattr(m, "role", None), "assigned_date": getattr(m, "assigned_date", None)})

		doc.set("custom_team_members", [])
		# re-add kept (preserve assigned_date where possible)
		for m in kept:
			if not m.get("user") or not m.get("role"):
				continue
			doc.append("custom_team_members", m)

		# set role users
		for u in users_clean:
			doc.append("custom_team_members", {"user": u, "role": role, "assigned_date": today()})

		doc.save()
		rows_out = []
		for m in (doc.get("custom_team_members") or []):
			u = str(getattr(m, "user", "") or "").strip()
			r = str(getattr(m, "role", "") or "").strip()
			if not u or not r:
				continue
			rows_out.append({"user": u, "role": r, "assigned_date": getattr(m, "assigned_date", None)})
		_attach_user_image(rows_out)
		out[doc.name] = rows_out

	return {"team": out}


@frappe.whitelist()
def get_task_counts(projects: Any) -> dict:
	"""
	Return Task counts per Project for Smart Board expand button.

	Permission model:
	- Only considers Projects the current user can READ.
	- Task query uses standard permissions (no ignore_permissions).

	Returns:
	- counts: { project_name: int }
	"""
	_ensure_logged_in()
	names = _normalize_list(projects)
	names = [str(x).strip() for x in names if str(x).strip()]
	if not names:
		return {"counts": {}}

	allowed = _project_names_with_read_permission(names)
	if not allowed:
		return {"counts": {}}

	try:
		rows = frappe.get_all(
			"Task",
			filters=[["project", "in", allowed]],
			fields=["project"],
			limit_page_length=100000,
		)
	except frappe.PermissionError:
		return {"counts": {}}

	counts = {}
	for r in (rows or []):
		p = r.get("project")
		if not p:
			continue
		counts[p] = int(counts.get(p, 0)) + 1
	return {"counts": counts}


@frappe.whitelist()
def get_tasks_for_projects(projects: Any, fields: Any = None, limit_per_project: int = 200) -> dict:
	"""
	Bulk fetch Tasks for a list of Projects.

	- Website-safe
	- Permission-aware:
	  - only Projects user can read are considered
	  - Task query uses standard permission checks (no ignore_permissions)

	Args:
	- projects: list of Project names (or JSON string)
	- fields: list of Task fields (or JSON string). Will be filtered by allowlist.
	- limit_per_project: max tasks returned per project (best-effort)

	Returns:
	- tasks: { project_name: [ {field: value, ...}, ... ] }
	"""
	_ensure_logged_in()
	names = _normalize_list(projects)
	names = [str(x).strip() for x in names if str(x).strip()]
	if not names:
		return {"tasks": {}}

	allowed_projects = _project_names_with_read_permission(names)
	if not allowed_projects:
		return {"tasks": {}}

	allowed_fields = {
		"name",
		"subject",
		"status",
		"priority",
		"exp_start_date",
		"exp_end_date",
		"modified",
		"creation",
		"owner",
		"project",
		"parent_task",
		"custom_team_members",
	}
	req_fields = _normalize_list(fields)
	req_fields = [str(x).strip() for x in req_fields if str(x).strip()]
	# Always include name + project so we can group reliably
	final_fields = ["name", "project"]
	need_team = False
	for f in req_fields:
		if f == "custom_team_members":
			need_team = True
			continue
		if f in allowed_fields and f not in final_fields:
			final_fields.append(f)
	if "subject" not in final_fields:
		final_fields.append("subject")

	limit_per_project = int(limit_per_project or 200)
	limit_per_project = max(1, min(limit_per_project, 1000))

	try:
		rows = frappe.get_all(
			"Task",
			filters=[["project", "in", allowed_projects]],
			fields=final_fields,
			order_by="subject asc, name asc",
			limit_page_length=min(100000, limit_per_project * max(1, len(allowed_projects))),
		)
	except frappe.PermissionError:
		return {"tasks": {}}

	out = {p: [] for p in allowed_projects}
	for r in (rows or []):
		p = r.get("project")
		if not p or p not in out:
			continue
		# Best-effort per-project limit
		if len(out[p]) >= limit_per_project:
			continue
		out[p].append(r)

	# Attach Task.custom_team_members (child table) if requested
	if need_team and rows:
		fieldname = _get_task_team_fieldname()
		task_names = [r.get("name") for r in rows if r.get("name")]
		if fieldname and task_names:
			try:
				members = frappe.get_all(
					"Project Team Member",
					filters={"parenttype": "Task", "parent": ["in", task_names], "parentfield": fieldname},
					fields=["parent", "user", "role", "assigned_date"],
					limit_page_length=100000,
				)
			except frappe.PermissionError:
				members = []
			# Attach user_image for UI avatars (permission-aware)
			try:
				_attach_user_image(members)
			except Exception:
				pass
			by_task = {}
			for m in (members or []):
				parent = m.get("parent")
				if not parent:
					continue
				by_task.setdefault(parent, []).append(m)
			for r in (rows or []):
				tn = r.get("name")
				if not tn:
					continue
				if fieldname:
					r[fieldname] = by_task.get(tn, [])
				if fieldname != "custom_team_members":
					r["custom_team_members"] = by_task.get(tn, [])

	# Only return keys requested (preserve input order)
	result = {}
	for p in names:
		if p in out:
			result[p] = out[p]
	return {"tasks": result}


@frappe.whitelist()
def create_task_for_project(project: str, subject: str | None = None) -> dict:
	"""
	Create a new Task under a Project (Smart Board "Add New Task").

	- Permission-aware (no ignore_permissions)
	- Requires logged-in user
	"""
	_ensure_logged_in()
	project = str(project or "").strip()
	if not project:
		frappe.throw("Missing project")

	allowed = _project_names_with_read_permission([project])
	if project not in set(allowed or []):
		frappe.throw("Not permitted")

	subject = str(subject or "").strip() or "New Task"

	doc = frappe.new_doc("Task")
	doc.project = project
	doc.subject = subject
	doc.insert()

	return {"task": {"name": doc.name, "project": doc.project, "subject": doc.subject}}


@frappe.whitelist()
def bulk_create_task_for_projects(projects: Any, subject: str | None = None) -> dict:
	"""
	Create one Task with the same subject for many Projects.

	Returns:
	- created: list[{name, project, subject}]
	- failed: list[{project, error}]
	"""
	_ensure_logged_in()
	names = _normalize_list(projects)
	names = [str(x).strip() for x in names if str(x).strip()]
	if not names:
		return {"created": [], "failed": []}

	subj = str(subject or "").strip() or "New Task"
	allowed = set(_project_names_with_read_permission(names) or [])
	created = []
	failed = []
	for project in names:
		if project not in allowed:
			failed.append({"project": project, "error": "Not permitted"})
			continue
		try:
			doc = frappe.new_doc("Task")
			doc.project = project
			doc.subject = subj
			doc.insert(ignore_permissions=False)
			created.append({"name": doc.name, "project": doc.project, "subject": doc.subject})
		except Exception as e:
			failed.append({"project": project, "error": str(e)})
	return {"created": created, "failed": failed}


@frappe.whitelist()
def set_task_team_members(task: str, members: Any, role: str | None = None) -> dict:
	"""
	Update ONE role within Task team members (child table: Project Team Member).
	We replace only rows where role == role_val, and keep other roles.
	Role will default to "Assigned Person".
	"""
	_ensure_logged_in()
	name = str(task or "").strip()
	if not name:
		frappe.throw("Missing task")

	doc = frappe.get_doc("Task", name)
	doc.check_permission("write")

	fieldname = _get_task_team_fieldname()
	if not fieldname:
		return {"missing_field": True, "custom_team_members": []}

	role_val = str(role or "").strip() or "Assigned Person"
	users = _normalize_list(members)
	users = [str(x).strip() for x in users if str(x).strip()]
	users = [u for (u,) in _uniq_preserve_order([(u,) for u in users])]

	# Keep other roles; replace only this role
	existing = doc.get(fieldname) or []
	kept = []
	existing_role_dates: dict[str, Any] = {}
	for m in existing:
		u = str(getattr(m, "user", "") or "").strip()
		r = str(getattr(m, "role", "") or "").strip()
		if not u or not r:
			continue
		if r != role_val:
			kept.append(
				{
					"user": u,
					"role": r,
					"assigned_date": getattr(m, "assigned_date", None),
				}
			)
		else:
			# preserve assigned_date for users staying in the same role
			existing_role_dates[u] = getattr(m, "assigned_date", None)

	doc.set(fieldname, [])
	for m in kept:
		doc.append(fieldname, m)
	for u in users:
		doc.append(
			fieldname,
			{
				"user": u,
				"role": role_val,
				"assigned_date": existing_role_dates.get(u) or today(),
			},
		)
	doc.save(ignore_permissions=False)

	out = []
	for m in (doc.get(fieldname) or []):
		u = str(getattr(m, "user", "") or "").strip()
		r = str(getattr(m, "role", "") or "").strip()
		if not u or not r:
			continue
		out.append({"user": u, "role": r, "assigned_date": getattr(m, "assigned_date", None)})
	_attach_user_image(out)
	if fieldname != "custom_task_members":
		return {"custom_task_members": out, fieldname: out}
	return {"custom_task_members": out}


@frappe.whitelist()
def bulk_set_task_field(tasks: Any, field: str, value: Any) -> dict:
	"""
	Bulk update one editable Task field across many Tasks.

	Allowed fields:
	- subject
	- status
	- priority
	- exp_end_date
	"""
	_ensure_logged_in()
	names = _normalize_list(tasks)
	names = [str(x).strip() for x in names if str(x).strip()]
	field = str(field or "").strip()
	allowed = {"subject", "status", "priority", "exp_end_date"}
	if not names:
		return {"updated": [], "failed": []}
	if field not in allowed:
		frappe.throw("Unsupported task field")

	updated = []
	failed = []
	for name in names:
		try:
			doc = frappe.get_doc("Task", name)
			doc.check_permission("write")
			doc.set(field, value)
			doc.save(ignore_permissions=False)
			updated.append(doc.name)
		except Exception as e:
			failed.append({"name": name, "error": str(e)})
	return {"updated": updated, "failed": failed}


@frappe.whitelist()
def delete_tasks(tasks: Any, cascade_subtasks: int = 1) -> dict:
	"""
	Delete Tasks (optionally including all descendant subtasks).

	Why custom API:
	- Website-safe (consistent errors + single call for bulk delete)
	- Allows cascading delete for parent_task trees (Monday-like behavior)

	Args:
	- tasks: list[str] (or JSON string)
	- cascade_subtasks: 1/0 (default 1). If enabled, also deletes all tasks where parent_task is within the selection (recursive).

	Returns:
	- deleted: list[str]
	- failed: list[{name, error}]
	- requested: list[str]
	- cascade_subtasks: bool
	- total_planned: int
	"""
	_ensure_logged_in()

	req = _normalize_list(tasks)
	req = [str(x).strip() for x in req if str(x).strip()]
	if not req:
		return {"deleted": [], "failed": [], "requested": [], "cascade_subtasks": bool(int(cascade_subtasks or 0)), "total_planned": 0}

	# Expand to include descendants (best-effort; permission-aware)
	all_names: set[str] = set(req)
	if int(cascade_subtasks or 0):
		frontier = set(req)
		try:
			while frontier:
				children = frappe.get_all(
					"Task",
					filters=[["parent_task", "in", list(frontier)]],
					pluck="name",
					limit_page_length=100000,
				)
				children = [str(x).strip() for x in (children or []) if str(x).strip()]
				new = set(children) - all_names
				if not new:
					break
				all_names |= new
				frontier = new
		except Exception:
			# If we can't expand, still try to delete requested tasks
			pass

	# Build parent->children map for post-order deletion (children first, then parents).
	try:
		rows = frappe.get_all(
			"Task",
			filters=[["name", "in", list(all_names)]],
			fields=["name", "parent_task"],
			limit_page_length=100000,
		)
	except Exception:
		rows = []

	children_map: dict[str, list[str]] = {}
	for r in (rows or []):
		name = str(r.get("name") or "").strip()
		parent = str(r.get("parent_task") or "").strip()
		if name and parent:
			children_map.setdefault(parent, []).append(name)

	# DFS post-order from each requested root; avoids deleting parent before its children.
	ordered: list[str] = []
	visited: set[str] = set()
	stack_guard: set[str] = set()  # cycle guard

	def visit(n: str) -> None:
		if not n or n in visited:
			return
		if n in stack_guard:
			# Cycle (unexpected). Still mark visited to avoid infinite recursion.
			visited.add(n)
			ordered.append(n)
			return
		stack_guard.add(n)
		for ch in children_map.get(n, []) or []:
			visit(str(ch))
		stack_guard.discard(n)
		visited.add(n)
		ordered.append(n)

	for n in req:
		visit(n)

	# Ensure any expanded descendants not reachable from req (edge cases) are included too.
	for n in all_names:
		if n not in visited:
			visit(n)

	# Delete linked Monthly Status rows first (otherwise Task deletion can be blocked by LinkValidationError).
	# Monthly Status is a helper doctype; we bound this by Task delete permissions below.
	try:
		if ordered:
			frappe.db.delete(
				"Monthly Status",
				{"reference_doctype": "Task", "reference_name": ["in", ordered]},
			)
	except Exception:
		# Best-effort; if deletion still fails later, we'll surface the blocking link error.
		pass

	deleted: list[str] = []
	failed: list[dict] = []
	for name in ordered:
		try:
			doc = frappe.get_doc("Task", name)
			doc.check_permission("delete")
			frappe.delete_doc("Task", name, ignore_permissions=False)
			deleted.append(name)
		except Exception as e:
			failed.append({"name": name, "error": str(e)})

	return {
		"deleted": deleted,
		"failed": failed,
		"requested": req,
		"cascade_subtasks": bool(int(cascade_subtasks or 0)),
		"total_planned": len(ordered),
	}


@frappe.whitelist()
def delete_project_cascade(
	project: str,
	*,
	dry_run: int = 0,
	delete_tasks_first: int = 1,
	delete_auto_repeat: int = 1,
	cascade_subtasks: int = 1,
) -> dict:
	"""
	Delete a Project from Smart Board, handling common blocking links:
	- Linked Tasks (Task.project)
	- Linked Auto Repeat (Auto Repeat.reference_doctype/reference_document)

	We intentionally do NOT force-delete unknown linked docs. If deletion is blocked by other links,
	we return a clear error so the UI can guide the user to archive or resolve links first.

	Args:
	- project: Project name
	- dry_run: 1/0. If 1, only returns a plan (counts + linked docs), does not delete.
	- delete_tasks_first: 1/0. If 1, delete Tasks linked to this Project before deleting Project.
	- delete_auto_repeat: 1/0. If 1, delete Auto Repeat rows referencing this Project before deleting Project.
	- cascade_subtasks: 1/0. If 1, deleting Tasks will also delete their descendant subtasks (parent_task tree).
	"""
	_ensure_logged_in()

	name = str(project or "").strip()
	if not name:
		frappe.throw("Missing project")

	# Permission gate: deleting is destructive; require Project delete permission.
	doc = frappe.get_doc("Project", name)
	doc.check_permission("delete")

	# Build plan (best-effort; permission-aware)
	task_names: list[str] = []
	auto_repeats: list[str] = []

	if int(delete_tasks_first or 0):
		try:
			task_names = frappe.get_all(
				"Task",
				filters={"project": name},
				pluck="name",
				limit_page_length=100000,
			) or []
			task_names = [str(x).strip() for x in task_names if str(x).strip()]
		except Exception:
			task_names = []

	if int(delete_auto_repeat or 0):
		try:
			auto_repeats = frappe.get_all(
				"Auto Repeat",
				filters={"reference_doctype": "Project", "reference_document": name},
				pluck="name",
				limit_page_length=1000,
			) or []
			auto_repeats = [str(x).strip() for x in auto_repeats if str(x).strip()]
		except Exception:
			auto_repeats = []

	# Also include direct link field as a hint (may be empty)
	try:
		ar_link = str(getattr(doc, "auto_repeat", "") or "").strip()
	except Exception:
		ar_link = ""
	if ar_link and ar_link not in auto_repeats:
		auto_repeats.append(ar_link)

	plan = {
		"project": name,
		"tasks_count": len(task_names),
		"auto_repeats": auto_repeats,
		"cascade_subtasks": bool(int(cascade_subtasks or 0)),
	}

	if int(dry_run or 0):
		return {"dry_run": True, "plan": plan}

	# Execute deletions
	deleted_auto_repeats: list[str] = []
	failed_auto_repeats: list[dict] = []
	task_result: dict | None = None

	# 1) Delete tasks (if any)
	if int(delete_tasks_first or 0) and task_names:
		task_result = delete_tasks(task_names, cascade_subtasks=int(cascade_subtasks or 0))
		if task_result and task_result.get("failed"):
			# If tasks couldn't be deleted, Project delete will still fail; abort early with details.
			return {"ok": False, "reason": "tasks_delete_failed", "plan": plan, "tasks": task_result}

	# 2) Delete auto repeats
	if int(delete_auto_repeat or 0) and auto_repeats:
		for ar in auto_repeats:
			try:
				ar_doc = frappe.get_doc("Auto Repeat", ar)
				ar_doc.check_permission("delete")
				frappe.delete_doc("Auto Repeat", ar, ignore_permissions=False)
				deleted_auto_repeats.append(ar)
			except Exception as e:
				failed_auto_repeats.append({"name": ar, "error": str(e)})

		if failed_auto_repeats:
			return {
				"ok": False,
				"reason": "auto_repeat_delete_failed",
				"plan": plan,
				"auto_repeat": {"deleted": deleted_auto_repeats, "failed": failed_auto_repeats},
				"tasks": task_result or {"deleted": [], "failed": []},
			}

	# 3) Delete project
	# Also delete any Monthly Status rows directly referencing this Project (future-proof).
	try:
		frappe.db.delete("Monthly Status", {"reference_doctype": "Project", "reference_name": name})
	except Exception:
		pass
	try:
		frappe.db.delete("Monthly Status", {"project": name})
	except Exception:
		pass
	try:
		frappe.delete_doc("Project", name, ignore_permissions=False)
	except Exception as e:
		return {
			"ok": False,
			"reason": "project_delete_failed",
			"error": str(e),
			"plan": plan,
			"auto_repeat": {"deleted": deleted_auto_repeats, "failed": failed_auto_repeats},
			"tasks": task_result or {"deleted": [], "failed": []},
		}

	return {
		"ok": True,
		"project": name,
		"plan": plan,
		"auto_repeat": {"deleted": deleted_auto_repeats, "failed": failed_auto_repeats},
		"tasks": task_result or {"deleted": [], "failed": []},
	}


# ============================================================
# Admin utilities (bench-only; NOT whitelisted)
# ============================================================

def debug_project_type_refs(project_types: Any) -> dict:
	"""
	Bench helper: list Saved View / Project rows referencing given Project Type(s).
	Usage:
	  bench --site <site> execute smart_accounting.smart_accounting.api.project_board.debug_project_type_refs --kwargs "{'project_types':['External','Internal']}"
	"""
	from .project_board_admin import debug_project_type_refs as _impl

	return _impl(project_types)


def cleanup_project_types(
	project_types: Any,
	*,
	reassign_to: str | None = None,
	delete_saved_views: bool = True,
	dry_run: bool = True,
) -> dict:
	"""
	Bench helper: remove placeholder Project Types safely.
	- If any Project still uses them, you must pass reassign_to.
	- Saved Views referencing them will be deleted by default (or reassigned if delete_saved_views=False).

	Usage (dry-run first):
	  bench --site <site> execute smart_accounting.smart_accounting.api.project_board.cleanup_project_types --kwargs "{'project_types':['External','Internal'],'reassign_to':'<YourRealType>','delete_saved_views':true,'dry_run':true}"

	Then run again with dry_run=false.
	"""
	from .project_board_admin import cleanup_project_types as _impl

	return _impl(
		project_types,
		reassign_to=reassign_to,
		delete_saved_views=delete_saved_views,
		dry_run=dry_run,
	)


def migrate_saved_views_v2(*, dry_run: bool = True) -> dict:
	"""
	Bench helper: normalize Saved View filters schema and backfill new fields.
	- Ensure reference_doctype / is_active / scope / sidebar_order exist (if fields exist on DocType)
	- Normalize Saved View.filters to object: {filters:[], or_filters:[], search:'', ui:{...}}
	- If legacy Saved View.project_type (Data, hidden) has a value, ensure a matching project_type filter exists.

	Usage:
	  bench --site <site> execute smart_accounting.api.project_board.migrate_saved_views_v2 --kwargs "{'dry_run':True}"
	  bench --site <site> execute smart_accounting.api.project_board.migrate_saved_views_v2 --kwargs "{'dry_run':False}"
	"""
	from .project_board_admin import migrate_saved_views_v2 as _impl

	return _impl(dry_run=bool(dry_run))


def find_project_type_link_refs(project_type: str) -> dict:
	"""
	Bench helper (kept here for convenience):
	find Link-field references that would block deleting a Project Type.
	"""
	from .project_board_admin import find_project_type_link_refs as _impl

	return _impl(project_type)


@frappe.whitelist()
def get_my_projects_with_roles(limit_start: int = 0, limit_page_length: int = 50) -> dict:
	"""
	Dashboard: list Projects related to current user via Project.custom_team_members.

	Returns:
	- projects: [
		{ name, project_name, project_type, status, roles: [..], role_text: "..." }
	  ]
	"""
	_ensure_logged_in()
	user = frappe.session.user
	user = str(user or "").strip()
	limit_start = max(0, _normalize_int(limit_start, 0))
	limit_page_length = max(1, min(100, _normalize_int(limit_page_length, 50)))
	if not user or user == "Guest":
		return {"projects": [], "meta": {"total_count": 0, "limit_start": limit_start, "limit_page_length": limit_page_length, "status_counts": {}}}

	# Child table may be permission-guarded by parent; read only rows for current user.
	try:
		team_rows = frappe.get_all(
			"Project Team Member",
			filters={"user": user},
			fields=["parent", "role"],
			ignore_permissions=True,
			limit_page_length=100000,
		)
	except Exception:
		team_rows = []

	parent_to_roles: dict[str, list[str]] = {}
	for r in (team_rows or []):
		p = str(r.get("parent") or "").strip()
		role = str(r.get("role") or "").strip()
		if not p:
			continue
		parent_to_roles.setdefault(p, [])
		if role and role not in parent_to_roles[p]:
			parent_to_roles[p].append(role)

	if not parent_to_roles:
		return {"projects": [], "meta": {"total_count": 0, "limit_start": limit_start, "limit_page_length": limit_page_length, "status_counts": {}}}

	# Respect Project permissions and only keep active Projects for Dashboard.
	allowed, prows = _get_readable_project_rows(
		list(parent_to_roles.keys()),
		fields=["name", "project_name", "project_type", "status"],
		active_only=True,
		limit_page_length=10000,
	)
	if not allowed:
		return {"projects": [], "meta": {"total_count": 0, "limit_start": limit_start, "limit_page_length": limit_page_length, "status_counts": {}}}

	by_name = {p.get("name"): p for p in (prows or []) if p.get("name")}
	out = []
	for name in allowed:
		p = by_name.get(name) or {}
		if not p:
			# Dashboard should only show active projects. Archived projects are intentionally
			# excluded here so Home cards and counts stay aligned with active-only views.
			continue
		roles = parent_to_roles.get(name, [])
		out.append(
			{
				"name": name,
				"project_name": p.get("project_name") or name,
				"project_type": p.get("project_type") or "",
				"status": p.get("status") or "",
				"roles": roles,
				"role_text": " / ".join([x for x in roles if x]) if roles else "",
			}
		)

	out.sort(key=lambda x: (str(x.get("project_name") or "").lower(), str(x.get("name") or "").lower()))
	status_counts: dict[str, int] = {}
	for row in out:
		status = str(row.get("status") or "Unknown").strip() or "Unknown"
		status_counts[status] = int(status_counts.get(status) or 0) + 1
	page = out[limit_start : limit_start + limit_page_length]
	return {
		"projects": page,
		"meta": {
			"total_count": len(out),
			"limit_start": limit_start,
			"limit_page_length": limit_page_length,
			"status_counts": status_counts,
		},
	}

@frappe.whitelist()
def hydrate_project_children(projects: Any) -> dict:
	"""
	Website-safe bulk fetch for Project child tables needed by Smart Board.

	Why:
	- frappe.client.get_list on child tables may raise PermissionError due to parent permission checks.
	- We first compute the list of Projects the current user can read (permission-aware),
	  then query child tables with ignore_permissions=True but only for those allowed parents.
	"""
	_ensure_logged_in()

	names = _normalize_list(projects)
	names = [str(x).strip() for x in names if str(x).strip()]
	if not names:
		return {"team": {}, "softwares": {}}

	# Respect Project permissions
	allowed = frappe.get_all("Project", filters=[["name", "in", names]], pluck="name")
	allowed = [str(x) for x in (allowed or [])]
	if not allowed:
		return {"team": {}, "softwares": {}}

	team_rows = frappe.get_all(
		"Project Team Member",
		filters=[["parent", "in", allowed]],
		fields=["parent", "user", "role", "assigned_date"],
		limit_page_length=10000,
		ignore_permissions=True,
	)
	# Attach user_image for UI avatars (permission-aware)
	try:
		_attach_user_image(team_rows)
	except Exception:
		pass
	soft_rows = frappe.get_all(
		"Project Software",
		filters=[["parent", "in", allowed]],
		fields=["parent", "software"],
		limit_page_length=10000,
		ignore_permissions=True,
	)

	team = {}
	for r in (team_rows or []):
		p = r.get("parent")
		if not p:
			continue
		team.setdefault(p, []).append(r)

	softwares = {}
	for r in (soft_rows or []):
		p = r.get("parent")
		if not p:
			continue
		softwares.setdefault(p, []).append(r)

	return {"team": team, "softwares": softwares}


@frappe.whitelist()
def get_user_meta(users: Any) -> dict:
	"""
	Return lightweight user metadata for UI display (full_name + user_image).
	Website-safe for /smart, avoids frappe.client.get_list('User') permission issues.

	Only returns:
	- name
	- full_name (fallback to name)
	- user_image
	"""
	_ensure_logged_in()

	names = _normalize_list(users)
	names = [str(x).strip() for x in names if str(x).strip()]
	if not names:
		return {}

	try:
		rows = frappe.get_all(
			"User",
			filters=[["name", "in", names], ["enabled", "=", 1]],
			fields=["name", "full_name", "user_image"],
			limit_page_length=min(500, len(names)),
		)
	except frappe.PermissionError:
		# Safe fallback for product shell:
		# - still requires login
		# - returns ONLY {name, full_name, user_image} for enabled users
		# This avoids forcing global "User read" permissions for all product users.
		try:
			rows = frappe.get_all(
				"User",
				filters=[["name", "in", names], ["enabled", "=", 1]],
				fields=["name", "full_name", "user_image"],
				limit_page_length=min(500, len(names)),
				ignore_permissions=True,
			)
		except Exception:
			rows = []

	out = {}
	for u in (rows or []):
		key = u.get("name")
		if not key:
			continue
		out[key] = {
			"label": u.get("full_name") or key,
			"image": u.get("user_image") or "",
		}
	# Ensure deterministic fallback for any missing
	for n in names:
		out.setdefault(n, {"label": n, "image": ""})
	return out


def _append_project_type_scope_filters(
	base_filters: list,
	project_type: str | None = None,
	project_types: Any = None,
	excluded_project_types: Any = None,
) -> list:
	pt = str(project_type or "").strip()
	pts = [str(x).strip() for x in _normalize_list(project_types) if str(x).strip()]
	excluded = [str(x).strip() for x in _normalize_list(excluded_project_types) if str(x).strip()]
	if pt:
		base_filters.append(["project_type", "=", pt])
	elif pts:
		base_filters.append(["project_type", "in", pts])
	if excluded:
		base_filters.append(["project_type", "not in", excluded])
	return base_filters


@frappe.whitelist()
def query_project_names_advanced(
	project_type: str | None = None,
	project_types: Any = None,
	excluded_project_types: Any = None,
	groups: Any = None,
	limit: int = 2000,
	is_active_only: int = 1,
	search: str | None = None,
) -> dict:
	"""
	Resolve advanced filter groups to a list of Project names.

	groups payload:
	- list of { join: "where"|"and"|"or", rules: [{ field, condition, value }] }

	We evaluate by running one DB query per group (AND inside group),
	then combine group result sets by group.join (AND => intersect, OR => union).
	This supports expressions like: (A AND B) OR (C AND D) safely.
	"""
	limit = int(limit or 2000)
	limit = max(1, min(limit, 10000))

	parsed_groups = _normalize_list(groups)
	if not parsed_groups:
		# No groups => no restriction
		return {"no_restriction": 1, "names": []}

	def rule_to_triple(r: dict) -> list | None:
		field = (r.get("field") or "").strip()
		cond = (r.get("condition") or "").strip()
		val = r.get("value")
		if not field or not cond:
			return None
		needs = cond not in ("is_empty", "is_not_empty")
		v = "" if val is None else str(val)
		if needs and not v:
			return None
		if cond == "equals":
			return [field, "=", v]
		if cond == "not_equals":
			return [field, "!=", v]
		if cond == "contains":
			return [field, "like", f"%{v}%"]
		if cond == "not_contains":
			return [field, "not like", f"%{v}%"]
		if cond == "starts_with":
			return [field, "like", f"{v}%"]
		if cond == "before":
			return [field, "<", v]
		if cond == "after":
			return [field, ">", v]
		if cond == "on_or_before":
			return [field, "<=", v]
		if cond == "on_or_after":
			return [field, ">=", v]
		if cond == "is_empty":
			return [field, "=", ""]
		if cond == "is_not_empty":
			return [field, "!=", ""]
		return None

	def base_filters() -> list:
		f = []
		_append_project_type_scope_filters(
			f,
			project_type=project_type,
			project_types=project_types,
			excluded_project_types=excluded_project_types,
		)
		if is_active_only:
			f.append(["is_active", "=", "Yes"])
		if search:
			f.append(["project_name", "like", f"%{search}%"])
		return f

	def _is_team_field(fn: str) -> bool:
		return str(fn or "").strip().startswith("team:")

	def _is_effective_entity_field(fn: str) -> bool:
		s = str(fn or "").strip().lower()
		return s in {"custom_entity_type", "entity_type", "entity"}

	def _team_role(fn: str) -> str:
		s = str(fn or "").strip()
		if ":" not in s:
			return ""
		return s.split(":", 1)[1].strip()

	_base_names: set[str] | None = None
	_base_project_rows: list[dict] | None = None

	def _get_base_names() -> set[str]:
		"""
		Base universe for special/derived filters (team:Role).
		Permission-aware (Project read perms).
		"""
		nonlocal _base_names
		if _base_names is not None:
			return _base_names
		try:
			rows = frappe.get_all("Project", filters=base_filters(), pluck="name", limit_page_length=limit)
		except Exception:
			rows = []
		_base_names = set([str(x).strip() for x in (rows or []) if str(x).strip()])
		return _base_names

	def _get_base_project_rows() -> list[dict]:
		"""
		Base projects with effective entity_type attached.
		Used by derived rule custom_entity_type so filtering semantics match what users see in table.
		"""
		nonlocal _base_project_rows
		if _base_project_rows is not None:
			return _base_project_rows
		try:
			rows = frappe.get_all(
				"Project",
				filters=base_filters(),
				fields=["name", "customer", "custom_customer_entity", "custom_entity_type"],
				limit_page_length=limit,
			)
		except Exception:
			rows = []
		try:
			# Keep filter semantics consistent with list display enrichment.
			rows = _attach_effective_entity_type(rows or [])
		except Exception:
			pass
		_base_project_rows = rows or []
		return _base_project_rows

	def _entity_rule_names(cond: str, v: str | None) -> set[str]:
		"""
		Resolve derived field rule: custom_entity_type (effective display value).
		Supported conditions mirror select/text where sensible.
		"""
		cond = str(cond or "").strip()
		val = str(v or "").strip()
		rows = _get_base_project_rows()
		if not rows:
			return set()

		base_names = set()
		matched = set()
		for r in rows:
			pn = str(r.get("name") or "").strip()
			if not pn:
				continue
			base_names.add(pn)
			et = str(r.get("custom_entity_type") or "").strip()
			ok = False
			if cond == "equals":
				ok = bool(val) and et == val
			elif cond == "not_equals":
				ok = bool(val) and et != val
			elif cond == "is_empty":
				ok = not et
			elif cond == "is_not_empty":
				ok = bool(et)
			elif cond == "contains":
				ok = bool(val) and (val in et)
			elif cond == "not_contains":
				ok = bool(val) and (val not in et)
			elif cond == "starts_with":
				ok = bool(val) and et.startswith(val)
			if ok:
				matched.add(pn)

		# Keep semantics stable with other derived filters.
		if cond == "not_equals" and val:
			return set(base_names) & matched
		return matched

	def _team_rule_names(role: str, cond: str, v: str | None) -> set[str]:
		"""
		Resolve a single derived rule team:<Role> to a set of Project names.
		- equals: has (role,user)
		- not_equals: does NOT have (role,user)  (includes empty)
		- is_not_empty: has any user for role
		- is_empty: has no user for role
		"""
		role = str(role or "").strip()
		cond = str(cond or "").strip()
		val = str(v or "").strip()
		base_names = _get_base_names()
		if not role or not base_names:
			return set()

		filters: dict[str, Any] = {
			"parenttype": "Project",
			"parentfield": "custom_team_members",
			"role": role,
			"parent": ["in", list(base_names)],
		}
		if cond in ("equals", "not_equals") and val:
			filters["user"] = val

		try:
			rows = frappe.get_all(
				"Project Team Member",
				filters=filters,
				pluck="parent",
				ignore_permissions=True,
				limit_page_length=min(100000, max(1, len(base_names))),
			)
		except Exception:
			rows = []
		matched = set([str(x).strip() for x in (rows or []) if str(x).strip()])

		if cond == "equals":
			return matched
		if cond == "not_equals":
			return set(base_names) - matched
		if cond == "is_not_empty":
			# NOTE: for this condition we query by role only (no user filter)
			return matched
		if cond == "is_empty":
			return set(base_names) - matched
		return set()

	combined: set[str] | None = None
	for idx, g in enumerate(parsed_groups):
		if not isinstance(g, dict):
			continue
		join = (g.get("join") or ("where" if idx == 0 else "and")).lower()
		rules = _normalize_list(g.get("rules"))
		group_filters = base_filters()
		derived_name_in: set[str] | None = None
		for r in rules:
			if not isinstance(r, dict):
				continue
			field = (r.get("field") or "").strip()
			cond = (r.get("condition") or "").strip()
			val = r.get("value")
			needs = cond not in ("is_empty", "is_not_empty")
			v = "" if val is None else str(val)
			if needs and not v:
				continue

			# Derived columns: team:<Role>
			if _is_team_field(field):
				role = _team_role(field)
				names_for_rule = _team_rule_names(role, cond, v)
				if derived_name_in is None:
					derived_name_in = names_for_rule
				else:
					derived_name_in &= names_for_rule
				# Short-circuit: impossible group
				if derived_name_in is not None and not derived_name_in:
					break
				continue

			# Derived/virtual: effective Entity (display-level value)
			if _is_effective_entity_field(field):
				names_for_rule = _entity_rule_names(cond, v)
				if derived_name_in is None:
					derived_name_in = names_for_rule
				else:
					derived_name_in &= names_for_rule
				if derived_name_in is not None and not derived_name_in:
					break
				continue

			t = rule_to_triple(r)
			if t:
				group_filters.append(t)

		# If group has no valid rules beyond base, skip it.
		# NOTE: derived team:Role rules don't add to group_filters until we apply name_in below.
		if len(group_filters) == len(base_filters()) and derived_name_in is None:
			continue

		# Apply derived rules restriction (AND)
		if derived_name_in is not None:
			# Empty intersection => no results for this group
			if not derived_name_in:
				names = set()
			else:
				group_filters.append(["name", "in", list(derived_name_in)])
				rows = frappe.get_all("Project", filters=group_filters, pluck="name", limit_page_length=limit)
				names = set(rows or [])
		else:
			rows = frappe.get_all("Project", filters=group_filters, pluck="name", limit_page_length=limit)
			names = set(rows or [])

		if combined is None:
			combined = names
			continue
		if join == "or":
			combined |= names
		else:
			combined &= names

	final = list(combined or [])
	final.sort()
	# If no group had any effective rule, treat as "no restriction" (do not filter everything out).
	if combined is None:
		return {"no_restriction": 1, "names": []}
	return {"names": final[:limit]}


@frappe.whitelist()
def search_project_names(
	search: str | None = None,
	fields: Any = None,
	*,
	project_type: str | None = None,
	project_types: Any = None,
	excluded_project_types: Any = None,
	is_active_only: int = 1,
	limit: int = 5000,
) -> dict:
	"""
	Resolve a multi-field search to a list of Project names (website-safe).

	Used by the frontend when it cannot express "advanced OR rules" AND "search OR across columns"
	in a single frappe.get_list call (because get_list only supports one OR group).

	Args:
	- search: search text (empty => no restriction)
	- fields: list[str] of candidate Project fields (frontend-visible columns); backend will filter to safe searchable fields
	- project_type: optional Project Type filter (narrows query)
	- is_active_only: 1/0
	- limit: max names returned (capped)
	"""
	_ensure_logged_in()

	q = str(search or "").strip()
	if not q:
		return {"no_restriction": 1, "names": []}

	try:
		limit = int(limit or 5000)
	except Exception:
		limit = 5000
	limit = max(1, min(limit, 20000))

	req = _normalize_list(fields)
	req = [str(x).strip() for x in req if str(x).strip()]
	req_set = set(req)

	# Backend safety: only search in fields that are real Project fields and text-like.
	allowed_types = {"Data", "Text", "Text Editor", "Small Text", "Long Text", "Link", "Select", "Read Only"}
	meta = None
	try:
		meta = frappe.get_meta("Project")
	except Exception:
		meta = None

	out_fields: list[str] = []
	seen = set()

	def _add(fn: str) -> None:
		f = str(fn or "").strip()
		if not f or f in seen:
			return
		out_fields.append(f)
		seen.add(f)

	for f in req:
		# Skip virtual/derived columns and child tables
		if f.startswith("__"):
			continue
		if ":" in f:
			continue
		if f in {"custom_team_members", "custom_softwares"}:
			continue
		if f == "name":
			_add("name")
			continue
		try:
			df = meta.get_field(f) if meta else None
		except Exception:
			df = None
		if not df:
			continue
		ft = str(getattr(df, "fieldtype", "") or "")
		if ft in allowed_types:
			_add(f)

	# Ensure a minimal useful default
	if "project_name" not in seen:
		_add("project_name")
	if "customer" not in seen:
		_add("customer")

	# customer_name is not a Project field. If caller includes customer/customer_name,
	# also match Customer.customer_name and map back to Project.customer IDs.
	need_customer_name_lookup = ("customer" in req_set) or ("customer_name" in req_set)
	need_software_lookup = ("custom_softwares" in req_set) or ("software" in req_set)

	base = []
	_append_project_type_scope_filters(
		base,
		project_type=project_type,
		project_types=project_types,
		excluded_project_types=excluded_project_types,
	)
	if int(is_active_only or 0):
		base.append(["is_active", "=", "Yes"])

	or_filters = [[f, "like", f"%{q}%"] for f in out_fields]

	names: set[str] = set()
	try:
		rows = frappe.get_all(
			"Project",
			filters=base,
			or_filters=or_filters,
			pluck="name",
			order_by="modified desc",
			limit_page_length=limit,
		)
		names |= {str(x).strip() for x in (rows or []) if str(x).strip()}
	except frappe.PermissionError:
		pass

	if need_customer_name_lookup:
		try:
			cids = frappe.get_all(
				"Customer",
				filters=[["customer_name", "like", f"%{q}%"]],
				pluck="name",
				limit_page_length=limit,
			)
		except Exception:
			cids = []
		cids = [str(x).strip() for x in (cids or []) if str(x).strip()]
		if cids:
			cfilters = list(base) + [["customer", "in", cids]]
			try:
				rows2 = frappe.get_all(
					"Project",
					filters=cfilters,
					pluck="name",
					order_by="modified desc",
					limit_page_length=limit,
				)
				names |= {str(x).strip() for x in (rows2 or []) if str(x).strip()}
			except frappe.PermissionError:
				pass

	if need_software_lookup:
		try:
			ps_rows = frappe.get_all(
				"Project Software",
				filters=[["software", "like", f"%{q}%"]],
				fields=["parent"],
				ignore_permissions=True,
				limit_page_length=limit,
			)
		except Exception:
			ps_rows = []
		pnames = [str(r.get("parent") or "").strip() for r in (ps_rows or []) if str(r.get("parent") or "").strip()]
		if pnames:
			pnames = list(dict.fromkeys(pnames))
			pfilters = list(base) + [["name", "in", pnames]]
			try:
				rows3 = frappe.get_all(
					"Project",
					filters=pfilters,
					pluck="name",
					order_by="modified desc",
					limit_page_length=limit,
				)
				names |= {str(x).strip() for x in (rows3 or []) if str(x).strip()}
			except frappe.PermissionError:
				pass

	out = list(names)
	out.sort()
	return {"names": out[:limit]}


