"""
Smart Board - Admin / bench-only helpers

Why this module exists:
- Keep `project_board.py` focused on website-safe API endpoints.
- Move one-off maintenance / migration helpers out of the main API file.

NOTE:
- These helpers are intended to be executed via `bench execute`.
- They may use ignore_permissions / force deletes. Use with care.
"""

from __future__ import annotations

from typing import Any

import frappe


def _normalize_list(v: Any) -> list:
	"""Best-effort normalize input into a list (JSON string / tuple / set / scalar)."""
	if v is None:
		return []
	if isinstance(v, list):
		return v
	if isinstance(v, (tuple, set)):
		return list(v)
	if isinstance(v, str):
		s = v.strip()
		if not s:
			return []
		try:
			obj = frappe.parse_json(s)
			if isinstance(obj, list):
				return obj
			return [obj]
		except Exception:
			# fallback: treat as single scalar
			return [s]
	return [v]


def debug_project_type_refs(project_types: Any) -> dict:
	"""
	Bench helper: report references to Project Types in Saved View + Project.
	"""
	names = _normalize_list(project_types)
	names = [str(x).strip() for x in names if str(x).strip()]
	if not names:
		return {"project_types": [], "saved_views": [], "projects": []}

	saved_views = frappe.get_all(
		"Saved View",
		filters={"project_type": ["in", names]},
		fields=["name", "title", "project_type", "modified"],
		limit_page_length=10000,
	)
	projects = frappe.get_all(
		"Project",
		filters={"project_type": ["in", names]},
		fields=["name", "project_name", "project_type", "modified"],
		limit_page_length=10000,
	)
	return {
		"project_types": names,
		"saved_views": saved_views or [],
		"projects": projects or [],
	}


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
	names = _normalize_list(project_types)
	names = [str(x).strip() for x in names if str(x).strip()]
	reassign = str(reassign_to).strip() if reassign_to else ""

	ref = debug_project_type_refs(names)
	projects = ref.get("projects") or []
	saved_views = ref.get("saved_views") or []

	if projects and not reassign:
		return {
			"ok": False,
			"reason": "projects_exist",
			"message": "Some Project records still use these Project Types. Provide reassign_to first.",
			**ref,
		}

	out = {
		"ok": True,
		"dry_run": bool(dry_run),
		"project_types": names,
		"reassign_to": reassign or None,
		"delete_saved_views": bool(delete_saved_views),
		"will_delete_saved_views": [x.get("name") for x in (saved_views or [])],
		"will_update_projects": [x.get("name") for x in (projects or [])],
		"will_delete_project_types": names,
	}
	if dry_run:
		return out

	failures = {"delete_saved_views": [], "update_saved_views": [], "update_projects": [], "delete_project_types": []}

	# 1) Saved Views
	if delete_saved_views:
		for sv in (saved_views or []):
			try:
				frappe.delete_doc("Saved View", sv.get("name"), force=True, ignore_permissions=True)
			except Exception:
				failures["delete_saved_views"].append({"name": sv.get("name"), "error": frappe.get_traceback()})
	else:
		for sv in (saved_views or []):
			try:
				frappe.db.set_value("Saved View", sv.get("name"), "project_type", reassign or None)
			except Exception:
				failures["update_saved_views"].append({"name": sv.get("name"), "error": frappe.get_traceback()})

	# 2) Projects
	if projects and reassign:
		for p in (projects or []):
			try:
				frappe.db.set_value("Project", p.get("name"), "project_type", reassign)
			except Exception:
				failures["update_projects"].append({"name": p.get("name"), "error": frappe.get_traceback()})

	# 3) Delete Project Type docs
	for pt in names:
		try:
			frappe.delete_doc("Project Type", pt, force=True, ignore_permissions=True)
		except Exception:
			failures["delete_project_types"].append({"name": pt, "error": frappe.get_traceback()})

	frappe.db.commit()
	ok = not any(len(v) for v in failures.values())
	return {**out, "ok": ok, "committed": True, "failures": failures}


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

	def _has_field(dt: str, fieldname: str) -> bool:
		try:
			meta = frappe.get_meta(dt)
			return bool(meta and meta.has_field(fieldname))
		except Exception:
			return False

	def _parse_json(v: Any) -> Any:
		if v is None:
			return None
		if isinstance(v, (dict, list)):
			return v
		if isinstance(v, str):
			s = v.strip()
			if not s:
				return None
			try:
				return frappe.parse_json(s)
			except Exception:
				return None
		return None

	def _normalize_filters_payload(raw: Any) -> dict:
		"""
		Accept:
		- null/'' -> {}
		- list -> treated as AND filters
		- dict -> if already has 'filters'/'or_filters' keep; else treat keys as UI only
		"""
		obj = _parse_json(raw)
		if obj is None:
			return {"filters": [], "or_filters": [], "search": "", "ui": {}}
		if isinstance(obj, list):
			return {"filters": obj, "or_filters": [], "search": "", "ui": {}}
		if isinstance(obj, dict):
			if "filters" in obj or "or_filters" in obj or "search" in obj or "ui" in obj:
				return {
					"filters": obj.get("filters") or [],
					"or_filters": obj.get("or_filters") or [],
					"search": obj.get("search") or "",
					"ui": obj.get("ui") or {},
				}
			return {"filters": [], "or_filters": [], "search": "", "ui": obj}
		return {"filters": [], "or_filters": [], "search": "", "ui": {}}

	def _ensure_project_type_filter(payload: dict, project_type_val: str) -> dict:
		pt = str(project_type_val or "").strip()
		if not pt:
			return payload
		fl = payload.get("filters") or []
		# avoid duplicates
		for t in fl:
			try:
				if len(t) >= 3 and str(t[0]) == "project_type" and str(t[1]) in ("=", "in") and (
					(str(t[1]) == "=" and str(t[2]) == pt) or (str(t[1]) == "in" and pt in (t[2] or []))
				):
					return payload
			except Exception:
				continue
		fl.append(["project_type", "=", pt])
		payload["filters"] = fl
		payload.setdefault("ui", {})
		payload["ui"]["pinned_project_type"] = pt
		return payload

	has_reference = _has_field("Saved View", "reference_doctype")
	has_active = _has_field("Saved View", "is_active")
	has_scope = _has_field("Saved View", "scope")
	has_order = _has_field("Saved View", "sidebar_order")

	rows = frappe.get_all(
		"Saved View",
		fields=["name", "title", "reference_doctype", "project_type", "filters", "is_active", "scope", "sidebar_order", "modified"],
		ignore_permissions=True,
		limit_page_length=10000,
	)

	updated = []
	skipped = []
	errors = []

	for r in (rows or []):
		name = r.get("name")
		try:
			next_vals = {}
			changed = False

			# reference_doctype default
			if has_reference:
				cur = str(r.get("reference_doctype") or "").strip()
				if not cur:
					next_vals["reference_doctype"] = "Project"
					changed = True

			# is_active default
			if has_active:
				if r.get("is_active") in (None, ""):
					next_vals["is_active"] = 1
					changed = True

			# scope default
			if has_scope:
				cur = str(r.get("scope") or "").strip()
				if not cur:
					next_vals["scope"] = "Shared"
					changed = True

			# sidebar_order default
			if has_order:
				if r.get("sidebar_order") in (None, ""):
					next_vals["sidebar_order"] = 0
					changed = True

			# filters normalization
			payload = _normalize_filters_payload(r.get("filters"))
			payload = _ensure_project_type_filter(payload, r.get("project_type"))
			normalized_json = frappe.as_json(payload)
			# Compare object forms best-effort
			cur_obj = _parse_json(r.get("filters"))
			if cur_obj != payload:
				next_vals["filters"] = normalized_json
				changed = True

			if not changed:
				skipped.append(name)
				continue

			updated.append({"name": name, "title": r.get("title"), "set": next_vals})
			if not dry_run:
				frappe.db.set_value("Saved View", name, next_vals, update_modified=False)
		except Exception as e:
			errors.append({"name": name, "error": str(e)})

	if (not dry_run) and updated:
		frappe.db.commit()

	return {"dry_run": bool(dry_run), "updated": updated, "skipped": skipped, "errors": errors}


def sanitize_saved_view_columns(*, dry_run: bool = True, reference_doctype: str = "Project") -> dict:
	"""
	Bench helper: remove invalid column fieldnames from Saved View.columns safely.

	Design goals:
	- Never touch running behavior-critical virtual columns (team:* / __sb_*).
	- Remove only fields that are not known in DocType meta (Project/Task) and not virtual.
	- Keep schema shape unchanged: list OR {project:[], tasks:[]}.

	Usage:
	  bench --site <site> execute smart_accounting.api.project_board_admin.sanitize_saved_view_columns --kwargs "{'dry_run': true}"
	  bench --site <site> execute smart_accounting.api.project_board_admin.sanitize_saved_view_columns --kwargs "{'dry_run': false}"
	"""

	def _parse_json(v: Any) -> Any:
		if v is None:
			return None
		if isinstance(v, (dict, list)):
			return v
		if isinstance(v, str):
			s = v.strip()
			if not s:
				return None
			try:
				return frappe.parse_json(s)
			except Exception:
				return None
		return None

	def _meta_fieldset(dt: str) -> set[str]:
		try:
			meta = frappe.get_meta(dt)
			names = {str(getattr(df, "fieldname", "") or "").strip() for df in (meta.fields or [])}
			names.discard("")
			names |= {"name", "owner", "creation", "modified", "modified_by"}
			return names
		except Exception:
			return set()

	def _is_virtual(fieldname: str) -> bool:
		f = str(fieldname or "").strip()
		return bool(f) and (f.startswith("__sb_") or f.startswith("team:"))

	def _clean_cols(cols: Any, allow: set[str]) -> tuple[list[dict], list[str]]:
		arr = cols if isinstance(cols, list) else []
		out: list[dict] = []
		removed: list[str] = []
		for c in arr:
			if not isinstance(c, dict):
				continue
			f = str(c.get("field") or "").strip()
			if not f:
				continue
			if _is_virtual(f) or f in allow:
				out.append(c)
			else:
				removed.append(f)
		return out, removed

	ref = str(reference_doctype or "Project").strip() or "Project"
	proj_fields = _meta_fieldset("Project")
	task_fields = _meta_fieldset("Task")

	rows = frappe.get_all(
		"Saved View",
		filters={"reference_doctype": ref},
		fields=["name", "title", "columns", "modified"],
		ignore_permissions=True,
		limit_page_length=10000,
	)

	updated = []
	skipped = []
	errors = []

	for r in (rows or []):
		name = r.get("name")
		try:
			raw = _parse_json(r.get("columns"))
			if raw is None:
				skipped.append(name)
				continue

			removed_fields: list[str] = []
			next_obj: Any = raw

			if isinstance(raw, list):
				cleaned, removed = _clean_cols(raw, proj_fields)
				removed_fields.extend(removed)
				next_obj = cleaned
			elif isinstance(raw, dict):
				next_obj = dict(raw)
				if isinstance(raw.get("project"), list):
					cleaned_p, removed_p = _clean_cols(raw.get("project"), proj_fields)
					next_obj["project"] = cleaned_p
					removed_fields.extend(removed_p)
				if isinstance(raw.get("tasks"), list):
					cleaned_t, removed_t = _clean_cols(raw.get("tasks"), task_fields)
					next_obj["tasks"] = cleaned_t
					removed_fields.extend(removed_t)
			else:
				skipped.append(name)
				continue

			# de-dup removed report
			seen = set()
			removed_unique = []
			for f in removed_fields:
				if f in seen:
					continue
				seen.add(f)
				removed_unique.append(f)

			if not removed_unique:
				skipped.append(name)
				continue

			updated.append({
				"name": name,
				"title": r.get("title"),
				"removed_fields": removed_unique,
			})

			if not dry_run:
				frappe.db.set_value("Saved View", name, "columns", frappe.as_json(next_obj), update_modified=False)
		except Exception as e:
			errors.append({"name": name, "error": str(e)})

	if (not dry_run) and updated:
		frappe.db.commit()

	return {"dry_run": bool(dry_run), "reference_doctype": ref, "updated": updated, "skipped": skipped, "errors": errors}


def ensure_smart_grants_columns(*, dry_run: bool = True) -> dict:
	"""
	Bench helper: ensure Smart Grants saved views contain required grants columns
	in the expected order right after ABN.

	Usage:
	  bench --site <site> execute smart_accounting.api.project_board_admin.ensure_smart_grants_columns --kwargs "{'dry_run':True}"
	  bench --site <site> execute smart_accounting.api.project_board_admin.ensure_smart_grants_columns --kwargs "{'dry_run':False}"
	"""

	required_after_abn = [
		{"field": "custom_grants_state", "label": "State", "width": 120},
		{"field": "custom_grants_industry_category", "label": "Industry", "width": 180},
	]
	address_col = {"field": "custom_grants_address_snapshot", "label": "Address", "width": 220}

	def _parse_json(v: Any) -> Any:
		if v is None:
			return None
		if isinstance(v, (dict, list)):
			return v
		if isinstance(v, str):
			s = v.strip()
			if not s:
				return None
			try:
				return frappe.parse_json(s)
			except Exception:
				return None
		return None

	def _ensure_cols(cols: Any) -> list[dict]:
		items = [c for c in (cols if isinstance(cols, list) else []) if isinstance(c, dict) and str(c.get("field") or "").strip()]
		out = [dict(c) for c in items]
		has_abn = any(str(c.get("field") or "").strip() == "custom_grants_abn_snapshot" for c in out)
		insert_idx = next((i for i, c in enumerate(out) if str(c.get("field") or "").strip() == "custom_grants_abn_snapshot"), len(out) - 1)
		for offset, col in enumerate(required_after_abn, start=1):
			field = str(col.get("field") or "").strip()
			existing_idx = next((i for i, c in enumerate(out) if str(c.get("field") or "").strip() == field), -1)
			target_idx = (insert_idx + offset) if has_abn else min(len(out), offset - 1)
			if existing_idx >= 0:
				existing = out.pop(existing_idx)
				normalized = {**col, **existing}
			else:
				normalized = dict(col)
			out.insert(min(target_idx, len(out)), normalized)

		has_address = any(str(c.get("field") or "").strip() == "custom_grants_address_snapshot" for c in out)
		if not has_address:
			contact_idx = next((i for i, c in enumerate(out) if str(c.get("field") or "").strip() == "custom_grants_contact_name"), -1)
			if contact_idx >= 0:
				out.insert(contact_idx, dict(address_col))
			else:
				out.append(dict(address_col))
		return out

	rows = frappe.get_all(
		"Saved View",
		filters={"project_type": "Smart Grants"},
		fields=["name", "title", "columns", "modified"],
		ignore_permissions=True,
		limit_page_length=10000,
	)

	updated = []
	skipped = []
	errors = []

	for row in (rows or []):
		name = str(row.get("name") or "").strip()
		try:
			raw = _parse_json(row.get("columns"))
			if isinstance(raw, list):
				next_obj = _ensure_cols(raw)
			elif isinstance(raw, dict):
				next_obj = {
					**raw,
					"project": _ensure_cols(raw.get("project")),
					"tasks": raw.get("tasks") if isinstance(raw.get("tasks"), list) else [],
				}
			else:
				next_obj = {"project": _ensure_cols([]), "tasks": []}

			if raw == next_obj:
				skipped.append(name)
				continue

			updated.append({"name": name, "title": row.get("title"), "columns": next_obj})
			if not dry_run:
				frappe.db.set_value("Saved View", name, "columns", frappe.as_json(next_obj), update_modified=False)
		except Exception as e:
			errors.append({"name": name, "error": str(e)})

	if (not dry_run) and updated:
		frappe.db.commit()

	return {"dry_run": bool(dry_run), "updated": updated, "skipped": skipped, "errors": errors}


def find_project_type_link_refs(project_type: str) -> dict:
	"""
	Bench helper: find any Link-field references that would block deleting a Project Type.

	Returns:
	- link_fields: [{parent(doctype), fieldname, options}]
	- refs: [{doctype, fieldname, count, sample_names}]
	"""
	pt = str(project_type or "").strip()
	if not pt:
		return {"project_type": "", "link_fields": [], "refs": []}

	# Find all Link fields pointing to Project Type
	link_fields = frappe.get_all(
		"DocField",
		filters={"fieldtype": "Link", "options": "Project Type"},
		fields=["parent", "fieldname", "options"],
		ignore_permissions=True,
		limit_page_length=100000,
	)

	refs = []
	for f in (link_fields or []):
		dt = f.get("parent")
		fn = f.get("fieldname")
		if not dt or not fn:
			continue
		try:
			cnt = frappe.db.count(dt, filters={fn: pt})
		except Exception:
			continue
		if not cnt:
			continue
		try:
			samples = frappe.get_all(dt, filters={fn: pt}, pluck="name", limit_page_length=20) or []
		except Exception:
			samples = []
		refs.append({"doctype": dt, "fieldname": fn, "count": int(cnt), "sample_names": samples})

	refs.sort(key=lambda r: (-int(r.get("count") or 0), str(r.get("doctype") or ""), str(r.get("fieldname") or "")))
	return {"project_type": pt, "link_fields": link_fields or [], "refs": refs}


