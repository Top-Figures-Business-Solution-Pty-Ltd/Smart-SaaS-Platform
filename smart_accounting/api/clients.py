"""
Clients APIs (website-safe)

Source of truth:
- Customer (ERPNext)
- Customer Entity (child table; stored as its own DocType rows with parent linkage)
"""

from __future__ import annotations

from typing import Any

import frappe
from frappe.exceptions import DuplicateEntryError


def _ensure_logged_in() -> None:
	if frappe.session.user in (None, "", "Guest"):
		frappe.throw("Not permitted", frappe.PermissionError)


def _normalize_int(v: Any, default: int) -> int:
	try:
		return int(v)
	except Exception:
		return int(default)


def _parse_json_if_string(value: Any) -> Any:
	if not isinstance(value, str):
		return value
	text = value.strip()
	if not text:
		return value
	try:
		return frappe.parse_json(text)
	except Exception:
		return value


def _normalize_str_list(value: Any) -> list[str]:
	parsed = _parse_json_if_string(value)
	if parsed is None:
		return []
	if isinstance(parsed, (list, tuple, set)):
		return [str(x).strip() for x in parsed if str(x).strip()]
	text = str(parsed or "").strip()
	return [text] if text else []


def _append_project_scope_filters(
	filters: list[list[Any]],
	*,
	project_types: Any = None,
	excluded_project_types: Any = None,
) -> list[list[Any]]:
	allowed = _normalize_str_list(project_types)
	excluded = _normalize_str_list(excluded_project_types)
	if allowed:
		filters.append(["project_type", "in", allowed])
	if excluded:
		filters.append(["project_type", "not in", excluded])
	return filters


def _group_project_counts(filters: list[list[Any]]) -> dict[str, int]:
	try:
		rows = frappe.get_all(
			"Project",
			filters=filters,
			fields=["customer", "count(name) as project_count"],
			group_by="customer",
			limit_page_length=100000,
		)
	except Exception:
		rows = []
	out: dict[str, int] = {}
	for row in rows or []:
		customer = str(row.get("customer") or "").strip()
		if not customer:
			continue
		out[customer] = int(row.get("project_count") or 0)
	return out


def _pick_default(doctype: str, preferred_name: str) -> str | None:
	"""Best-effort pick a default value for Link fields like Customer Group / Territory."""
	try:
		if preferred_name and frappe.db.exists(doctype, preferred_name):
			return preferred_name
	except Exception:
		pass
	try:
		rows = frappe.get_all(doctype, fields=["name"], limit_page_length=1)
		if rows:
			return rows[0].get("name")
	except Exception:
		pass
	return None


def _get_select_options(doctype: str, fieldname: str) -> list[str]:
	try:
		meta = frappe.get_meta(doctype)
		field = meta.get_field(fieldname) if meta else None
		raw = str(field.options or "") if field else ""
		opts = [o.strip() for o in raw.split("\n") if o.strip()]
		return opts
	except Exception:
		return []


def _normalize_customer_type_for_customer(customer_type: str) -> str:
	"""
	Normalize input customer_type against Customer.customer_type options.
	Fallback strategy:
	- If input exists in options: keep it.
	- If input is Trust but Customer doesn't support Trust: fallback to Company.
	- Else fallback to first available option, then 'Individual'.
	"""
	ct = str(customer_type or "").strip()
	opts = [str(x or "").strip() for x in (_get_select_options("Customer", "customer_type") or []) if str(x or "").strip()]
	if not opts:
		return ct or "Individual"
	if ct in opts:
		return ct
	if ct.lower() == "trust":
		for cand in ("Company", "Individual"):
			if cand in opts:
				return cand
	return opts[0]


def _find_client_name_conflicts(name: str | None = None, exclude_name: str | None = None) -> list[dict]:
	q = str(name or "").strip()
	if not q:
		return []
	excl = str(exclude_name or "").strip()

	rows = frappe.get_all(
		"Customer",
		fields=["name", "customer_name"],
		filters={"customer_name": q},
		limit_page_length=20,
	)
	rows2 = frappe.get_all(
		"Customer",
		fields=["name", "customer_name"],
		filters={"name": q},
		limit_page_length=20,
	)
	merged = {r.get("name"): r for r in (rows or []) if r.get("name")}
	for r in rows2 or []:
		if r.get("name"):
			merged[r.get("name")] = r
	items = list(merged.values())
	if excl:
		items = [r for r in items if str(r.get("name") or "").strip() != excl]
	return items


def _get_user_meta_map(usernames: list[str] | None = None) -> dict[str, dict[str, str]]:
	names = [str(x or "").strip() for x in (usernames or []) if str(x or "").strip()]
	if not names:
		return {}
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
	out: dict[str, dict[str, str]] = {}
	for row in rows or []:
		key = str(row.get("name") or "").strip()
		if not key:
			continue
		out[key] = {
			"label": str(row.get("full_name") or key).strip() or key,
			"image": str(row.get("user_image") or "").strip(),
		}
	for name in names:
		out.setdefault(name, {"label": name, "image": ""})
	return out


def _build_client_summary(customer: dict, primary_entity: dict | None = None) -> dict:
	"""Return a minimal item shape compatible with ClientsTable rows."""
	return {
		"name": customer.get("name"),
		"customer_name": customer.get("customer_name") or customer.get("name"),
		"custom_partner": customer.get("custom_partner"),
		"custom_partner_label": customer.get("custom_partner_label") or customer.get("custom_partner") or "",
		"custom_partner_image": customer.get("custom_partner_image") or "",
		"customer_group": customer.get("customer_group"),
		"territory": customer.get("territory"),
		"disabled": int(customer.get("disabled") or 0),
		"modified": customer.get("modified"),
		"entities_count": 1 if primary_entity else 0,
		"project_count": 0,
		"active_project_count": 0,
		"last_project_type": "",
		"primary_entity": primary_entity,
	}


@frappe.whitelist()
def get_clients(
	search: str | None = None,
	limit_start: int = 0,
	limit_page_length: int = 50,
	include_disabled: int = 0,
	disabled_only: int = 0,
	project_type: str | None = None,
	project_types: Any = None,
	excluded_project_types: Any = None,
) -> dict:
	"""
	List Customers with an entity summary (from Customer Entity child table).

	Returns:
	- items: [
	    {
	      name, customer_name, customer_group, territory, disabled, modified,
	      entities_count,
	      primary_entity: { entity_name, entity_type, abn, year_end, is_primary } | None
	    }, ...
	  ]
	"""
	_ensure_logged_in()

	q = (search or "").strip()
	limit_start = max(0, _normalize_int(limit_start, 0))
	limit_page_length = max(1, min(200, _normalize_int(limit_page_length, 50)))
	project_types = _normalize_str_list(project_types)
	if not project_types and str(project_type or "").strip():
		project_types = [str(project_type or "").strip()]
	excluded_project_types = _normalize_str_list(excluded_project_types)

	relevant_project_filters: list[list[Any]] = []
	_append_project_scope_filters(
		relevant_project_filters,
		project_types=project_types,
		excluded_project_types=excluded_project_types,
	)
	if int(disabled_only or 0):
		relevant_project_filters.extend([
			["is_active", "=", "No"],
			["custom_archive_source", "=", "Client Archive"],
		])
		relevant_customer_names = _group_project_counts(relevant_project_filters)
	else:
		relevant_project_filters.append(["is_active", "=", "Yes"])
		relevant_customer_names = _group_project_counts(relevant_project_filters)

	fields = [
		"name",
		"customer_name",
		"customer_group",
		"territory",
		"disabled",
		"modified",
	]
	if frappe.db.has_column("Customer", "custom_partner"):
		fields.append("custom_partner")
	filters: dict[str, Any] = {}
	if int(disabled_only or 0):
		filters["disabled"] = 1
	elif not int(include_disabled or 0):
		filters["disabled"] = 0
	or_filters = []
	if q:
		like = f"%{q}%"
		or_filters = [["name", "like", like], ["customer_name", "like", like]]
		if frappe.db.has_column("Customer", "custom_partner"):
			try:
				user_rows = frappe.get_all(
					"User",
					filters={"enabled": 1},
					or_filters=[
						["name", "like", like],
						["email", "like", like],
						["full_name", "like", like],
					],
					fields=["name"],
					limit_page_length=100,
					ignore_permissions=True,
				)
			except Exception:
				user_rows = []
			partner_names = [str(r.get("name") or "").strip() for r in (user_rows or []) if str(r.get("name") or "").strip()]
			if partner_names:
				or_filters.append(["custom_partner", "in", partner_names])

	customers = frappe.get_all(
		"Customer",
		fields=fields,
		filters=filters,
		or_filters=or_filters,
		order_by="customer_name asc, name asc",
		limit_start=limit_start,
		limit_page_length=limit_page_length,
	)

	# Total count for UI ("Showing X / total")
	# Note: get_all respects permissions; we use an aggregate query to match the same permission scope.
	total_count = None
	try:
		cnt_rows = frappe.get_all(
			"Customer",
			fields=["count(name) as cnt"],
			filters=filters,
			or_filters=or_filters,
			limit_page_length=1,
		)
		if cnt_rows and isinstance(cnt_rows, list):
			total_count = int((cnt_rows[0] or {}).get("cnt") or 0)
	except Exception:
		total_count = None

	names = [c.get("name") for c in (customers or []) if c.get("name")]
	by_customer: dict[str, list[dict]] = {n: [] for n in names}
	project_counts: dict[str, int] = {n: 0 for n in names}
	total_project_counts: dict[str, int] = {n: 0 for n in names}
	active_project_counts: dict[str, int] = {n: 0 for n in names}
	client_archived_project_counts: dict[str, int] = {n: 0 for n in names}
	last_project_type: dict[str, str] = {n: "" for n in names}

	if names:
		base_project_filters = [["customer", "in", names]]
		_append_project_scope_filters(
			base_project_filters,
			project_types=project_types,
			excluded_project_types=excluded_project_types,
		)

		rows_all = _group_project_counts(list(base_project_filters))
		for cn, count in rows_all.items():
			if cn in total_project_counts:
				total_project_counts[cn] = int(count or 0)

		rows2 = _group_project_counts(list(base_project_filters) + [["is_active", "=", "Yes"]])
		for cn, count in rows2.items():
			if cn in active_project_counts:
				active_project_counts[cn] = int(count or 0)

		if frappe.db.has_column("Project", "custom_archive_source") and frappe.db.has_column("Project", "custom_archive_source_ref"):
			rows_archived = _group_project_counts(
				list(base_project_filters)
				+ [["is_active", "=", "No"], ["custom_archive_source", "=", "Client Archive"]]
			)
			for cn, count in rows_archived.items():
				if cn in client_archived_project_counts:
					client_archived_project_counts[cn] = int(count or 0)

		# Product rule:
		# - Normal Clients table: show active-only project count
		# - Archived Clients table: show only projects archived together with the client
		project_counts = dict(client_archived_project_counts if int(disabled_only or 0) else active_project_counts)

		# Last project type (most recently modified project) per customer
		try:
			last_type_filters = list(base_project_filters)
			rows3 = frappe.get_all(
				"Project",
				filters=last_type_filters,
				fields=["customer", "project_type", "modified"],
				order_by="modified desc",
				limit_page_length=5000,
			)
			seen = set()
			for r in rows3 or []:
				cn = r.get("customer")
				if not cn or cn in seen or cn not in last_project_type:
					continue
				last_project_type[cn] = str(r.get("project_type") or "").strip()
				seen.add(cn)
		except Exception:
			pass

		# Fetch child entities (best-effort; will respect perms based on parent linkage in most setups)
		try:
			entities = frappe.get_all(
				"Customer Entity",
				filters={
					"parenttype": "Customer",
					"parentfield": "custom_entities",
					"parent": ["in", names],
				},
				fields=["parent", "entity_name", "entity_type", "abn", "year_end", "is_primary"],
				order_by="is_primary desc, modified desc",
				limit_page_length=100000,
			)
		except Exception:
			entities = []

		for e in (entities or []):
			p = e.get("parent")
			if p and p in by_customer:
				by_customer[p].append(e)

	items = []
	partner_meta = _get_user_meta_map([c.get("custom_partner") for c in (customers or []) if c.get("custom_partner")])
	for c in (customers or []):
		name = c.get("name")
		es = by_customer.get(name) or []
		primary = None
		if es:
			primary = es[0]
		items.append(
			{
				**c,
				"custom_partner_label": partner_meta.get(str(c.get("custom_partner") or "").strip(), {}).get("label", str(c.get("custom_partner") or "").strip()),
				"custom_partner_image": partner_meta.get(str(c.get("custom_partner") or "").strip(), {}).get("image", ""),
				"entities_count": len(es),
				"project_count": int(project_counts.get(name) or 0),
				"total_project_count": int(total_project_counts.get(name) or 0),
				"active_project_count": int(active_project_counts.get(name) or 0),
				"client_archived_project_count": int(client_archived_project_counts.get(name) or 0),
				"last_project_type": str(last_project_type.get(name) or ""),
				"primary_entity": (
					{
						"entity_name": primary.get("entity_name"),
						"entity_type": primary.get("entity_type"),
						"abn": primary.get("abn"),
						"year_end": primary.get("year_end"),
						"is_primary": primary.get("is_primary"),
					}
					if primary
					else None
				),
			}
		)

	return {
		"items": items,
		"meta": {
			"total_count": total_count,
			"returned_count": len(items),
			"limit_start": limit_start,
			"limit_page_length": limit_page_length,
		},
	}


@frappe.whitelist()
def archive_client(name: str | None = None) -> dict:
	"""
	Archive a client by setting Customer.disabled = 1 and archiving all related active projects.
	"""
	_ensure_logged_in()
	docname = str(name or "").strip()
	if not docname:
		frappe.throw("name is required")
	if not frappe.db.exists("Customer", docname):
		frappe.throw("Client not found")

	customer_name = frappe.db.get_value("Customer", docname, "customer_name") or docname
	frappe.db.set_value("Customer", docname, "disabled", 1, update_modified=True)

	project_rows = frappe.get_all(
		"Project",
		filters={"customer": docname, "is_active": "Yes"},
		fields=["name"],
		limit_page_length=100000,
	)
	archived_projects = 0
	for row in (project_rows or []):
		project_name = str(row.get("name") or "").strip()
		if not project_name:
			continue
		try:
			doc = frappe.get_doc("Project", project_name)
			doc.is_active = "No"
			doc._sb_archive_source = "client_archive"
			doc._sb_archive_client_ref = docname
			doc._sb_archive_rule = customer_name
			if doc.meta.has_field("custom_archive_source"):
				doc.custom_archive_source = "Client Archive"
			if doc.meta.has_field("custom_archive_source_ref"):
				doc.custom_archive_source_ref = docname
			doc.flags.skip_board_automation = True
			doc.save(ignore_permissions=True)
			archived_projects += 1
		except Exception:
			continue

	return {
		"ok": True,
		"name": docname,
		"disabled": 1,
		"archived_projects": archived_projects,
	}


@frappe.whitelist()
def restore_client(name: str | None = None) -> dict:
	"""
	Restore a client by setting Customer.disabled = 0 and restoring all related archived projects.
	"""
	_ensure_logged_in()
	docname = str(name or "").strip()
	if not docname:
		frappe.throw("name is required")
	if not frappe.db.exists("Customer", docname):
		frappe.throw("Client not found")

	frappe.db.set_value("Customer", docname, "disabled", 0, update_modified=True)

	project_filters: dict[str, Any] = {"customer": docname, "is_active": "No"}
	if frappe.db.has_column("Project", "custom_archive_source"):
		project_filters["custom_archive_source"] = "Client Archive"
	if frappe.db.has_column("Project", "custom_archive_source_ref"):
		project_filters["custom_archive_source_ref"] = docname
	project_rows = frappe.get_all(
		"Project",
		filters=project_filters,
		fields=["name"],
		limit_page_length=100000,
	)
	restored_projects = 0
	for row in (project_rows or []):
		project_name = str(row.get("name") or "").strip()
		if not project_name:
			continue
		try:
			doc = frappe.get_doc("Project", project_name)
			doc.is_active = "Yes"
			if doc.meta.has_field("custom_archive_source"):
				doc.custom_archive_source = ""
			if doc.meta.has_field("custom_archive_source_ref"):
				doc.custom_archive_source_ref = ""
			doc.flags.skip_board_automation = True
			doc.save(ignore_permissions=True)
			restored_projects += 1
		except Exception:
			continue

	return {
		"ok": True,
		"name": docname,
		"disabled": 0,
		"restored_projects": restored_projects,
	}


@frappe.whitelist()
def create_client(payload: dict | None = None) -> dict:
	"""
	Create a new Customer (and optional Primary Entity row).
	Website-safe: designed for /smart shell.

	payload:
	{
	  customer_name: str (required)
	  customer_type: "Company"|"Individual"|... (optional)
	  customer_group: str (optional)
	  territory: str (optional)
	  primary_entity: {
	    entity_name: str
	    entity_type: str
	    abn: str|None
	    year_end: str|None
	  } | null
	}
	"""
	_ensure_logged_in()

	# frappe.call may send nested objects as JSON strings; normalize here.
	if isinstance(payload, str):
		try:
			data = frappe.parse_json(payload) or {}
		except Exception:
			data = {}
	else:
		data = payload or {}
	if not isinstance(data, dict):
		data = {}
	customer_name = str(data.get("customer_name") or "").strip()
	if not customer_name:
		frappe.throw("customer_name is required")
	conflicts = _find_client_name_conflicts(customer_name)
	if conflicts:
		frappe.throw("Client name already exists. Please use a unique name.")

	raw_customer_type = str(data.get("customer_type") or "").strip() or "Individual"
	customer_type = _normalize_customer_type_for_customer(raw_customer_type)
	customer_group = str(data.get("customer_group") or "").strip() or (_pick_default("Customer Group", "All Customer Groups") or "")
	territory = str(data.get("territory") or "").strip() or (_pick_default("Territory", "All Territories") or "")
	custom_partner = str(data.get("custom_partner") or "").strip() or None

	primary = data.get("primary_entity") or None
	primary_entity_row = None
	if isinstance(primary, dict):
		entity_name = str(primary.get("entity_name") or "").strip()
		entity_type = str(primary.get("entity_type") or "").strip()
		abn = str(primary.get("abn") or "").strip() or None
		year_end = str(primary.get("year_end") or "").strip() or None
		if not year_end:
			frappe.throw("year_end is required")
		if entity_name and entity_type:
			primary_entity_row = {
				"doctype": "Customer Entity",
				"entity_name": entity_name,
				"entity_type": entity_type,
				"abn": abn,
				"year_end": year_end,
				"is_primary": 1,
			}

	try:
		doc_payload = {
			"doctype": "Customer",
			"customer_name": customer_name,
			"customer_type": customer_type,
			"customer_group": customer_group or None,
			"territory": territory or None,
			# Child table field may or may not exist; append only if present.
			"custom_entities": [primary_entity_row] if primary_entity_row else [],
		}
		if frappe.get_meta("Customer").get_field("custom_partner"):
			doc_payload["custom_partner"] = custom_partner
		doc = frappe.get_doc(doc_payload)
		doc.insert()
	except DuplicateEntryError:
		frappe.throw("Customer already exists")

	# Return a website-safe summary (avoid sending full doc blob)
	customer = doc.as_dict()
	pe = None
	if primary_entity_row:
		pe = {
			"entity_name": primary_entity_row.get("entity_name"),
			"entity_type": primary_entity_row.get("entity_type"),
			"abn": primary_entity_row.get("abn"),
			"year_end": primary_entity_row.get("year_end"),
			"is_primary": 1,
		}
	if customer.get("custom_partner"):
		meta = _get_user_meta_map([customer.get("custom_partner")]).get(str(customer.get("custom_partner") or "").strip(), {})
		customer["custom_partner_label"] = meta.get("label", str(customer.get("custom_partner") or "").strip())
		customer["custom_partner_image"] = meta.get("image", "")
	return {"item": _build_client_summary(customer, pe)}


@frappe.whitelist()
def update_client(payload: dict | None = None) -> dict:
	"""
	Update basic Client fields.
	Allowed:
	- customer_name
	- primary entity: entity_type, year_end (entity_name follows customer_name)
	"""
	_ensure_logged_in()

	# Normalize payload (may arrive as JSON string)
	if isinstance(payload, str):
		try:
			data = frappe.parse_json(payload) or {}
		except Exception:
			data = {}
	else:
		data = payload or {}
	if not isinstance(data, dict):
		data = {}

	name = str(data.get("name") or "").strip()
	if not name:
		frappe.throw("name is required")
	if not frappe.has_permission("Customer", "write", name):
		frappe.throw("Not permitted", frappe.PermissionError)

	doc = frappe.get_doc("Customer", name)

	customer_name = data.get("customer_name", None)
	if customer_name is not None:
		customer_name = str(customer_name or "").strip()
		if not customer_name:
			frappe.throw("customer_name is required")
		conflicts = _find_client_name_conflicts(customer_name, exclude_name=name)
		if conflicts:
			frappe.throw("Client name already exists. Please use a unique name.")
		doc.customer_name = customer_name

	entity_type = data.get("entity_type", None)
	year_end = data.get("year_end", None)
	custom_partner = data.get("custom_partner", None)

	if entity_type is not None:
		entity_type = str(entity_type or "").strip()
	if year_end is not None:
		year_end = str(year_end or "").strip()
	if custom_partner is not None:
		custom_partner = str(custom_partner or "").strip()

	if entity_type is not None or year_end is not None:
		if not doc.meta.get_field("custom_entities"):
			frappe.throw("Customer Entity table is not configured")
		allowed_year_ends = _get_select_options("Customer Entity", "year_end")
		# If legacy rows have invalid year_end, normalize them before validation.
		if year_end and allowed_year_ends:
			for row in (doc.get("custom_entities") or []):
				cur = str(row.get("year_end") or "").strip()
				if cur and cur not in allowed_year_ends:
					row.year_end = year_end
		primary = None
		for row in (doc.get("custom_entities") or []):
			if int(row.get("is_primary") or 0):
				primary = row
				break

		if primary:
			if entity_type:
				primary.entity_type = entity_type
			if year_end:
				primary.year_end = year_end
			# Keep primary entity aligned with customer name
			if customer_name:
				primary.entity_name = customer_name
		else:
			if not year_end:
				frappe.throw("year_end is required")
			new_entity_type = entity_type or str(doc.get("customer_type") or "")
			doc.append(
				"custom_entities",
				{
					"doctype": "Customer Entity",
					"entity_name": customer_name or doc.get("customer_name") or doc.get("name"),
					"entity_type": new_entity_type,
					"year_end": year_end,
					"abn": None,
					"is_primary": 1,
				},
			)

	if custom_partner is not None and doc.meta.get_field("custom_partner"):
		doc.custom_partner = custom_partner or None

	doc.save()

	primary_out = None
	for row in (doc.get("custom_entities") or []):
		if int(row.get("is_primary") or 0):
			primary_out = {
				"entity_name": row.get("entity_name"),
				"entity_type": row.get("entity_type"),
				"abn": row.get("abn"),
				"year_end": row.get("year_end"),
				"is_primary": row.get("is_primary"),
			}
			break

	return {
		"item": {
			"name": doc.get("name"),
			"customer_name": doc.get("customer_name") or doc.get("name"),
			"custom_partner": doc.get("custom_partner") if doc.meta.get_field("custom_partner") else None,
			"custom_partner_label": (
				_get_user_meta_map([doc.get("custom_partner")]).get(str(doc.get("custom_partner") or "").strip(), {}).get("label", str(doc.get("custom_partner") or "").strip())
				if doc.meta.get_field("custom_partner") and doc.get("custom_partner")
				else ""
			),
			"custom_partner_image": (
				_get_user_meta_map([doc.get("custom_partner")]).get(str(doc.get("custom_partner") or "").strip(), {}).get("image", "")
				if doc.meta.get_field("custom_partner") and doc.get("custom_partner")
				else ""
			),
			"primary_entity": primary_out,
		}
	}


@frappe.whitelist()
def check_client_name_exists(name: str | None = None, exclude_name: str | None = None) -> dict:
	"""
	Check if a Customer already exists with the same customer_name (or docname).
	Used by /smart New Client to prompt before creating duplicates.
	"""
	_ensure_logged_in()
	if not str(name or "").strip():
		return {"exists": False, "items": []}
	items = _find_client_name_conflicts(name, exclude_name)
	return {"exists": bool(items), "items": items}


@frappe.whitelist()
def delete_client(name: str | None = None) -> dict:
	"""
	Delete a Client (Customer) if no Projects reference it.
	Returns {deleted: bool, blocked: bool, project_count: int, message: str}
	"""
	_ensure_logged_in()
	docname = str(name or "").strip()
	if not docname:
		frappe.throw("name is required")
	if not frappe.has_permission("Customer", "delete", docname):
		frappe.throw("Not permitted", frappe.PermissionError)

	# Check project references
	count = 0
	try:
		count = frappe.db.count("Project", filters={"customer": docname})
	except Exception:
		count = 0
	if count and int(count) > 0:
		return {
			"deleted": False,
			"blocked": True,
			"project_count": int(count),
			"message": f"Client has {int(count)} linked project(s). Delete projects first.",
		}

	frappe.delete_doc("Customer", docname, ignore_permissions=False)
	return {"deleted": True, "blocked": False, "project_count": 0, "message": "Client deleted"}


