# -*- coding: utf-8 -*-
"""
Project DocType Override
扩展ERPNext原生Project，支持Smart Board工作流和Board Automation
"""

import json
import frappe
from frappe.utils import getdate, add_months, add_days, get_last_day
from erpnext.projects.doctype.project.project import Project
from smart_accounting.api.notification_delivery import (
    create_in_app_notifications,
    get_enabled_notification_recipients,
    send_notification_emails_safe,
)


class CustomProject(Project):
    """
    自定义Project类
    - before_insert: 确保status在合法选项内
    - validate: 实体同步 + Board Automation 执行
    - update_percent_complete: 阻止ERPNext自动覆盖status
    """

    def before_insert(self):
        """
        Ensure Project.status is valid against current DocType options.

        Why:
        - ERPNext standard Project.status default is "Open".
        - Smart Accounting overrides the status pool via Property Setter (removing "Open").
        - When inserting via API (/smart), status may be missing and defaults to "Open",
          causing validation errors.
        """
        # Normalize customer as early as possible.
        # Frappe runs link validation during insert before validate(), so this must happen here.
        self._normalize_customer_link()
        # Auto-sync Project Year End on creation when empty:
        # source of truth is Customer Entity.year_end.
        self._sync_year_end_from_customer_entity_on_create()
        # Auto-fill Partner role from Customer.custom_partner when absent.
        self._sync_partner_from_customer_on_create()

        try:
            f = self.meta.get_field("status") if getattr(self, "meta", None) else None
            raw = str(getattr(f, "options", "") or "")
            opts = [x.strip() for x in raw.split("\n") if str(x).strip()]
        except Exception:
            opts = []

        if not opts:
            return

        cur = str(getattr(self, "status", "") or "").strip()
        if cur in opts:
            return

        # Prefer our canonical default if present
        preferred = "Not started"
        self.status = preferred if preferred in opts else opts[0]

    def _sync_year_end_from_customer_entity_on_create(self):
        """
        If Project.custom_year_end is empty on insert, pull from:
        1) linked Customer Entity (custom_customer_entity), else
        2) customer's primary Customer Entity.
        """
        try:
            cur = str(getattr(self, "custom_year_end", "") or "").strip()
        except Exception:
            cur = ""
        # Important:
        # Some sites set a default (e.g. January) on Project.custom_year_end.
        # Treat default-filled value as "empty" for create-time auto-sync.
        # Only preserve when user provided a non-default explicit value.
        default_val = ""
        try:
            f = self.meta.get_field("custom_year_end") if getattr(self, "meta", None) else None
            default_val = str(getattr(f, "default", "") or "").strip()
        except Exception:
            default_val = ""
        if cur and (not default_val or cur != default_val):
            return

        customer = str(getattr(self, "customer", "") or "").strip()
        if not customer:
            return

        entity_name = str(getattr(self, "custom_customer_entity", "") or "").strip()
        year_end = ""
        if entity_name:
            try:
                year_end = str(frappe.db.get_value("Customer Entity", entity_name, "year_end") or "").strip()
            except Exception:
                year_end = ""

        if not year_end:
            try:
                rows = frappe.get_all(
                    "Customer Entity",
                    filters={
                        "parenttype": "Customer",
                        "parentfield": "custom_entities",
                        "parent": customer,
                        "is_primary": 1,
                    },
                    fields=["name", "year_end"],
                    order_by="modified desc",
                    limit_page_length=1,
                )
            except Exception:
                rows = []
            if rows:
                entity_name = str(rows[0].get("name") or "").strip()
                year_end = str(rows[0].get("year_end") or "").strip()
                if entity_name and not str(getattr(self, "custom_customer_entity", "") or "").strip():
                    self.custom_customer_entity = entity_name

        if year_end:
            self.custom_year_end = year_end

    def _sync_partner_from_customer_on_create(self):
        """
        If the selected Client has a default partner, seed Project.custom_team_members
        with role=Partner on create, but never overwrite an explicitly provided partner.
        """
        customer = str(getattr(self, "customer", "") or "").strip()
        if not customer:
            return
        if not getattr(self, "meta", None) or not self.meta.get_field("custom_team_members"):
            return
        if not frappe.db.has_column("Customer", "custom_partner"):
            return

        try:
            members = list(getattr(self, "custom_team_members", None) or [])
        except Exception:
            members = []

        try:
            partner = str(frappe.db.get_value("Customer", customer, "custom_partner") or "").strip()
        except Exception:
            partner = ""
        if not partner:
            return

        for row in members:
            try:
                role = str(getattr(row, "role", None) or (row.get("role") if isinstance(row, dict) else "") or "").strip()
                user = str(getattr(row, "user", None) or (row.get("user") if isinstance(row, dict) else "") or "").strip()
            except Exception:
                role = ""
                user = ""
            if role == "Partner":
                if user:
                    return
                try:
                    row.user = partner
                    if not getattr(row, "assigned_date", None):
                        row.assigned_date = frappe.utils.today()
                except Exception:
                    pass
                return

        self.append(
            "custom_team_members",
            {
                "user": partner,
                "role": "Partner",
                "assigned_date": frappe.utils.today(),
            },
        )

    def update_percent_complete(self):
        """
        ERPNext 默认会在 update_percent_complete 里把 Project.status 强制设为：
        - percent_complete == 100 -> "Completed"
        - else -> "Open"

        Smart Accounting 将 Project.status 作为自定义工作流状态池（不包含 Open）。
        因此必须阻止 ERPNext 自动覆盖 status，否则会触发 Select options 校验失败。
        """
        previous_status = (self.status or "").strip()

        # Keep ERPNext percent calculation behavior
        super().update_percent_complete()

        # Restore / normalize status to a valid option in current status pool
        try:
            f = self.meta.get_field("status") if getattr(self, "meta", None) else None
            raw = str(getattr(f, "options", "") or "")
            options = [x.strip() for x in raw.split("\n") if str(x).strip()]
        except Exception:
            options = []

        if not options:
            return

        options_lower = {o.lower(): o for o in options}

        def pick(opt: str) -> str | None:
            if not opt:
                return None
            opt = opt.strip()
            if opt in options:
                return opt
            return options_lower.get(opt.lower())

        # 1) If user had a valid status before, keep it (do not auto-overwrite)
        kept = pick(previous_status)
        if kept:
            self.status = kept
            return

        # 2) If current status happens to be valid, keep it
        kept = pick(self.status)
        if kept:
            self.status = kept
            return

        # 3) Map ERPNext legacy statuses -> nearest equivalents (best-effort)
        legacy_map = {
            "open": "Not started",
            # Project terminal status is "Completed".
            "completed": "Completed",
            "done": "Completed",
            "lodged": "Completed",
            "cancelled": "Hold",
            "not started": "Not started",
        }
        mapped = legacy_map.get(previous_status.lower()) if previous_status else None
        kept = pick(mapped) if mapped else None
        if kept:
            self.status = kept
            return

        # 4) Default fallback
        self.status = pick("Not started") or options[0]
    
    def validate(self):
        """Project validation hooks for Smart Board flows."""
        # Normalize customer link for /smart create flows:
        # allow passing Customer.customer_name, but persist Customer.name.
        self._normalize_customer_link()
        # Capture "before" snapshot once per request so we can build full audit rows
        # later in on_update (works even when Version/track_changes is disabled).
        if not self.is_new():
            self._capture_activity_before_state()
        super().validate()
        # Keep derived entity display in sync for non-desk flows (/smart).
        # Desk fetch_from is client-side; API updates need server-side alignment.
        self._sync_entity_type_from_customer_entity()

        # Board Automation: run automations on existing projects
        if not self.is_new():
            if not getattr(getattr(self, "flags", None), "skip_board_automation", False):
                self._run_board_automations({"event": "validate"})

        # Keep archive source fields consistent with the current archive action.
        if not self.is_new():
            self._sync_archive_source_fields()

        # Compute diffs after all business rules (including automations) settle.
        if not self.is_new():
            self._prepare_activity_changes()

    def on_update(self):
        """Persist project field-level activity rows."""
        self._write_activity_comments()
        self._write_automation_run_logs()

    def _sync_entity_type_from_customer_entity(self):
        """If Project.custom_customer_entity is set, keep Project.custom_entity_type aligned."""
        try:
            en = str(getattr(self, "custom_customer_entity", "") or "").strip()
        except Exception:
            en = ""
        if not en:
            return
        try:
            t = frappe.db.get_value("Customer Entity", en, "entity_type", cache=False)
        except Exception:
            t = None
        t = str(t or "").strip()
        if not t:
            return
        cur = str(getattr(self, "custom_entity_type", "") or "").strip()
        if cur != t:
            self.custom_entity_type = t

    def _normalize_customer_link(self):
        """
        Ensure Project.customer is always a valid Customer.name.

        If caller submits Customer.customer_name instead of Customer.name,
        resolve it here before Link validation runs.
        """
        raw = str(getattr(self, "customer", "") or "").strip()
        if not raw:
            return
        try:
            if frappe.db.exists("Customer", raw):
                return
        except Exception:
            # Keep original behavior if meta/db is not ready.
            return
        try:
            rows = frappe.get_all(
                "Customer",
                fields=["name"],
                filters={"customer_name": raw},
                limit_page_length=2,
            )
        except Exception:
            rows = []
        if len(rows or []) == 1:
            resolved = str(rows[0].get("name") or "").strip()
            if resolved:
                self.customer = resolved
                return
        if len(rows or []) > 1:
            frappe.throw(f"Multiple Customers found for name: {raw}. Please choose a unique Client.")
    
    # =========================================================================
    # Board Automation Engine
    # =========================================================================

    def _run_board_automations(self, context=None):
        """
        Execute all enabled Board Automation rules that match the current change.
        Called during validate() so changes are saved in a single DB write.

        Guards:
        1. frappe.flags (request-level): prevents re-firing even if doc.save() is
           called multiple times within the same HTTP request (different doc instances).
        2. Per-document instance flag: prevents re-entrance within the same instance.
        3. Snapshot: captures user's original status before any automation modifies it.
        """
        # Request-level guard: one automation execution per project per request
        flag_key = f'_sb_automation_done_{self.name}'
        if frappe.flags.get(flag_key):
            return
        frappe.flags[flag_key] = True

        # Per-document instance guard (belt + suspenders)
        if getattr(self, '_sb_automation_done', False):
            return
        self._sb_automation_done = True

        ev = str((context or {}).get("event") or "validate").strip()
        # Snapshot the user's original status change BEFORE any automation modifies it.
        # In daily scheduler context there is no "before-save" doc, so force changed=False.
        self._sb_original_status = str(self.status or "").strip()
        self._sb_status_changed = False if ev == "daily" else self.has_value_changed("status")
        try:
            automations = frappe.get_all(
                "Board Automation",
                filters={"enabled": 1},
                fields=["name", "automation_name", "trigger_type", "trigger_config", "actions",
                         "execution_count"],
            )
        except Exception:
            # DocType may not exist yet during migration
            return

        changed_any = False
        ev = str((context or {}).get("event") or "validate").strip()
        for auto in automations:
            run_ctx = None
            try:
                if ev in {"daily", "hourly"} and self._scheduler_rule_already_fired_today(auto):
                    continue
                if self._trigger_matches(auto, context=context):
                    run_ctx = self._start_automation_run_log(auto, context=context)
                    exec_result = self._execute_actions(auto, run_ctx=run_ctx)
                    changed_any = bool((exec_result or {}).get("changed_any")) or changed_any
                    if ev in {"daily", "hourly"}:
                        self._mark_scheduler_rule_fired_today(auto)
                    self._finish_automation_run_log(run_ctx, exec_result=exec_result)
            except Exception as e:
                self._finish_automation_run_log(run_ctx, exec_result=None, failed=True, error_details=str(e))
                frappe.log_error(
                    f"Board Automation {auto.get('name')} failed for Project {self.name}: {str(e)}",
                    "Board Automation Error",
                )
        return changed_any

    def _trigger_matches(self, auto, context=None):
        """Check if this automation's trigger matches the current document change.
        Uses the snapshot taken before any automation modified fields."""
        config = _parse_json(auto.get("trigger_config"))
        triggers = config.get("triggers") if isinstance(config, dict) else None
        if not isinstance(triggers, list) or not triggers:
            triggers = [{
                "trigger_type": str(auto.get("trigger_type") or "").strip(),
                "config": config if isinstance(config, dict) else {},
            }]
        for tr in triggers:
            if not isinstance(tr, dict):
                return False
            tt = str(tr.get("trigger_type") or "").strip()
            tc = tr.get("config") or {}
            if isinstance(tc, str):
                tc = _parse_json(tc)
            if not isinstance(tc, dict):
                tc = {}
            if not self._single_trigger_matches(tt, tc, context=context):
                return False
        return True

    def _single_trigger_matches(self, trigger_type: str, config: dict, context=None) -> bool:
        ev = str((context or {}).get("event") or "validate").strip()

        if trigger_type == "status_change":
            to_value = str(config.get("to_value") or "").strip()
            if not to_value:
                return False
            # Use snapshot to avoid interference from prior action resets
            if not getattr(self, '_sb_status_changed', False):
                return False
            return getattr(self, '_sb_original_status', '') == to_value

        if trigger_type == "status_is":
            want = str(config.get("value") or "").strip()
            if not want:
                return False
            return str(getattr(self, "status", "") or "").strip() == want

        if trigger_type == "project_type_is":
            want = str(config.get("project_type") or "").strip()
            if not want:
                return False
            return str(getattr(self, "project_type", "") or "").strip() == want

        if trigger_type == "date_reaches":
            field = str(config.get("date_field") or "").strip()
            mode = str(config.get("mode") or "on").strip() or "on"
            if not field:
                return False
            val = getattr(self, field, None)
            if not val:
                return False
            d = getdate(val)
            today_d = getdate(frappe.utils.today())
            if ev == "daily":
                # Daily runner should fire once on the exact date.
                return d == today_d
            if ev == "hourly":
                # Hourly catch-up uses the same exact-date rule; repetition is controlled by cache guard.
                return d == today_d
            # validate/manual save path
            try:
                changed = self.has_value_changed(field)
            except Exception:
                changed = False
            if not changed:
                return False
            if mode == "on_or_after":
                return d <= today_d
            return d == today_d

        return False

    def _execute_actions(self, auto, run_ctx=None):
        """Execute all actions in the automation's actions array."""
        actions_raw = auto.get("actions")
        actions = _parse_json_array(actions_raw)
        if not actions:
                return {"changed_any": False}

        changed_any = False
        self._sb_active_automation_run = run_ctx if isinstance(run_ctx, dict) else None
        try:
            for action in actions:
                action_type = str(action.get("action_type") or "").strip()
                config = action.get("config") or {}
                if isinstance(config, str):
                    config = _parse_json(config)

                if action_type == "roll_due_date":
                    prev = getattr(self, "custom_lodgement_due_date", None)
                    self._action_roll_due_date(config, auto)
                    changed_any = (getattr(self, "custom_lodgement_due_date", None) != prev) or changed_any
                elif action_type == "reset_status":
                    prev = str(getattr(self, "status", "") or "").strip()
                    self._action_reset_status(config, auto)
                    changed_any = (str(getattr(self, "status", "") or "").strip() != prev) or changed_any
                elif action_type == "notify_someone":
                    self._action_notify_someone(config, auto)
                elif action_type == "archive_project":
                    prev = str(getattr(self, "is_active", "") or "").strip()
                    self._action_archive_project(config, auto)
                    changed_any = (str(getattr(self, "is_active", "") or "").strip() != prev) or changed_any
                elif action_type == "push_date":
                    prev_field = str((config or {}).get("date_field") or "").strip()
                    prev_val = getattr(self, prev_field, None) if prev_field else None
                    self._action_push_date(config, auto)
                    next_val = getattr(self, prev_field, None) if prev_field else None
                    changed_any = (next_val != prev_val) or changed_any
                else:
                    frappe.logger("smart_accounting").warning(
                        "Board Automation %s: unknown action_type '%s'", auto.get("name"), action_type
                    )
                    self._record_automation_note(action_type, f"Unknown action type: {action_type}")
        finally:
            self._sb_active_automation_run = None

        # Update execution stats (once per automation, not per action)
        try:
            frappe.db.set_value(
                "Board Automation",
                auto.get("name"),
                {
                    "execution_count": (auto.get("execution_count") or 0) + 1,
                    "last_triggered": frappe.utils.now_datetime(),
                },
                update_modified=False,
            )
        except Exception:
            pass
        return {"changed_any": changed_any}

    def _action_roll_due_date(self, config, auto):
        """Action: Roll Lodgement Due forward by the project's frequency."""
        target_field = "custom_lodgement_due_date"

        freq = str(getattr(self, "custom_project_frequency", "") or "").strip()
        current_date = getattr(self, target_field, None)

        if not freq or freq in ("One-off", "One off", ""):
            return
        if not current_date:
                return

        current_date = getdate(current_date)
        new_date = _roll_date_by_frequency(current_date, freq)

        if new_date and new_date != current_date:
            self.set(target_field, new_date)
            self._record_automation_field_change(auto, "roll_due_date", target_field, current_date, new_date)
            frappe.logger("smart_accounting").info(
                "Board Automation %s: rolled %s from %s to %s for Project %s",
                auto.get("name"), target_field, current_date, new_date, self.name,
            )
    
    def _action_reset_status(self, config, auto):
        """Action: Reset project status to a configured value."""
        prev = str(getattr(self, "status", "") or "").strip()
        reset_to = str(config.get("reset_to") or "Not started").strip()
        if not reset_to:
            return

        try:
            f = self.meta.get_field("status") if getattr(self, "meta", None) else None
            raw = str(getattr(f, "options", "") or "")
            pool = [x.strip() for x in raw.split("\n") if str(x).strip()]
        except Exception:
            pool = []

        if pool and reset_to in pool:
            self.status = reset_to
        elif pool:
            self.status = pool[0]
        next_v = str(getattr(self, "status", "") or "").strip()
        if next_v != prev:
            self._record_automation_field_change(auto, "reset_status", "status", prev, next_v)

    def _action_notify_someone(self, config, auto):
        """Action: notify all users under the selected project role."""
        role = str((config or {}).get("role") or "").strip()
        if not role:
            return

        members = getattr(self, "custom_team_members", None) or []
        recipients: list[str] = []
        for row in members:
            if not isinstance(row, dict):
                try:
                    row = row.as_dict()
                except Exception:
                    row = {}
            member_role = str((row or {}).get("role") or "").strip()
            user = str((row or {}).get("user") or "").strip()
            if not user or user == "Guest":
                continue
            if member_role != role:
                continue
            recipients.append(user)

        if not recipients:
            return

        # De-dupe, preserve order.
        recipients = list(dict.fromkeys(recipients))

        # De-dupe across this document save cycle so repeated actions don't spam the same user.
        sent = getattr(self, "_sb_notified_users", None)
        if not isinstance(sent, set):
            sent = set()
            setattr(self, "_sb_notified_users", sent)
        pending = [u for u in recipients if u not in sent]
        if not pending:
            return

        _send_automation_in_app_notifications(
            project_name=self.name,
            project_title=(self.project_name or self.name),
            recipients=pending,
            role=role,
            automation_name=str(auto.get("automation_name") or auto.get("name") or "").strip(),
        )
        sent.update(pending)
        self._record_automation_note("notify_someone", f"Notified {len(pending)} recipient(s) in role {role}")

    def _action_archive_project(self, config, auto):
        """Action: archive current project by setting is_active = No."""
        cur = str(getattr(self, "is_active", "") or "").strip()
        if cur == "No":
            return
        self.is_active = "No"
        self._record_automation_field_change(auto, "archive_project", "is_active", cur, "No")
        # Keep source context for activity log formatting in this save cycle.
        self._sb_archive_source = "automation"
        self._sb_archive_rule = str((auto or {}).get("automation_name") or (auto or {}).get("name") or "").strip()

    def _action_push_date(self, config, auto):
        """Action: push selected Project date field by selected period."""
        cfg = config or {}
        fieldname = str(cfg.get("date_field") or "").strip()
        period = str(cfg.get("period") or "1_month").strip().lower()
        if not fieldname:
            return
        # Special-case Target Month (Select field): push forward by N months (1..12).
        if fieldname == "custom_target_month":
            if period == "frequency":
                freq = str(getattr(self, "custom_project_frequency", "") or "").strip()
                step = _target_month_step_by_frequency(freq)
            else:
                try:
                    step = int(period)
                except Exception:
                    step = 0
            months = [
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December",
            ]
            if step < 1:
                return
            cur = str(getattr(self, fieldname, "") or "").strip()
            # If current target month is empty/invalid, use current calendar month as base.
            if cur in months:
                base_idx = months.index(cur)
            else:
                base_idx = int(frappe.utils.now_datetime().month) - 1
            next_idx = (base_idx + step) % 12
            next_month = months[next_idx]
            self.set(fieldname, next_month)
            self._record_automation_field_change(auto, "push_date", fieldname, cur, next_month)
            return
        current_val = getattr(self, fieldname, None)
        if not current_val:
            return

        d = getdate(current_val)
        next_d = None
        if period == "frequency":
            freq = str(getattr(self, "custom_project_frequency", "") or "").strip()
            if not freq or freq in ("One-off", "One off", ""):
                return
            next_d = _roll_date_by_frequency(d, freq)
        elif period == "1_week":
            next_d = add_days(d, 7)
        elif period == "1_fortnight":
            next_d = add_days(d, 14)
        elif period == "1_month":
            nd = add_months(d, 1)
            next_d = get_last_day(nd) if d == get_last_day(d) else nd
        elif period == "1_quarter":
            nd = add_months(d, 3)
            next_d = get_last_day(nd) if d == get_last_day(d) else nd
        elif period == "1_year":
            nd = add_months(d, 12)
            next_d = get_last_day(nd) if d == get_last_day(d) else nd

        if next_d and next_d != d:
            self.set(fieldname, next_d)
            self._record_automation_field_change(auto, "push_date", fieldname, d, next_d)

    def _scheduler_rule_guard_key(self, auto) -> str:
        rule_name = str((auto or {}).get("name") or "").strip()
        day_key = str(frappe.utils.today() or "").strip()
        return f"sb:auto:date-trigger:{day_key}:{self.name}:{rule_name}"

    def _scheduler_rule_already_fired_today(self, auto) -> bool:
        try:
            key = self._scheduler_rule_guard_key(auto)
            return bool(frappe.cache().get_value(key))
        except Exception:
            return False

    def _mark_scheduler_rule_fired_today(self, auto):
        try:
            key = self._scheduler_rule_guard_key(auto)
            # Keep slightly over one day to cover delayed workers around midnight.
            frappe.cache().set_value(key, 1, expires_in_sec=60 * 60 * 30)
        except Exception:
            pass

    # =========================================================================
    # Activity audit (field-level)
    # =========================================================================

    def _sync_archive_source_fields(self):
        try:
            changed = self.has_value_changed("is_active")
        except Exception:
            changed = False
        if not changed:
            return
        try:
            meta = self.meta if getattr(self, "meta", None) else None
            has_source = bool(meta and meta.has_field("custom_archive_source"))
            has_ref = bool(meta and meta.has_field("custom_archive_source_ref"))
        except Exception:
            has_source = False
            has_ref = False
        if not has_source and not has_ref:
            return

        new_state = str(getattr(self, "is_active", "") or "").strip()
        if new_state == "No":
            source_key = str(getattr(self, "_sb_archive_source", "") or "manual").strip().lower()
            source_label = "Manual"
            source_ref = ""
            if source_key == "automation":
                source_label = "Automation"
                source_ref = str(getattr(self, "_sb_archive_rule", "") or "").strip()
            elif source_key == "client_archive":
                source_label = "Client Archive"
                source_ref = str(getattr(self, "_sb_archive_client_ref", "") or "").strip()
            if has_source:
                self.set("custom_archive_source", source_label)
            if has_ref:
                self.set("custom_archive_source_ref", source_ref or "")
            return

        if new_state == "Yes":
            if has_source:
                self.set("custom_archive_source", "")
            if has_ref:
                self.set("custom_archive_source_ref", "")

    def _capture_activity_before_state(self):
        if getattr(self, "_sb_activity_before", None) is not None:
            return
        try:
            prev = self.get_doc_before_save()
            self._sb_activity_before = prev.as_dict() if prev else {}
        except Exception:
            self._sb_activity_before = {}

    def _prepare_activity_changes(self):
        before = getattr(self, "_sb_activity_before", None) or {}
        if not isinstance(before, dict):
            before = {}
        out = []
        for f in (self.meta.fields or []):
            fieldname = str(getattr(f, "fieldname", "") or "").strip()
            fieldtype = str(getattr(f, "fieldtype", "") or "").strip()
            if not fieldname or fieldname in _AUDIT_SKIP_FIELDS:
                continue
            # Product rule: activity popup should focus on board-relevant columns only.
            if fieldname not in _AUDIT_TRACK_FIELDS:
                continue
            try:
                if not self.has_value_changed(fieldname):
                    continue
            except Exception:
                pass
            if fieldtype in _AUDIT_SKIP_FIELDTYPES:
                continue
            label = str(getattr(f, "label", "") or fieldname)

            old_raw = before.get(fieldname)
            new_raw = self.get(fieldname)
            if fieldtype in {"Table", "Table MultiSelect"}:
                old_v = _table_summary(fieldname, old_raw)
                new_v = _table_summary(fieldname, new_raw)
            else:
                old_v = _short_text(_value_to_text(old_raw))
                new_v = _short_text(_value_to_text(new_raw))
            if old_v == new_v:
                continue
            row = {
                "field": fieldname,
                "field_label": label,
                "from_value": old_v,
                "to_value": new_v,
            }
            if fieldname == "is_active":
                old_s = str(old_v or "").strip().lower()
                new_s = str(new_v or "").strip().lower()
                if old_s == "yes" and new_s == "no":
                    source = str(getattr(self, "_sb_archive_source", "") or "manual").strip() or "manual"
                    row["archive_source"] = source
                    if source == "automation":
                        row["archive_rule"] = str(getattr(self, "_sb_archive_rule", "") or "").strip()
                elif old_s == "no" and new_s == "yes":
                    row["archive_source"] = "restore"
            field_meta = (getattr(self, "_sb_automation_field_meta", None) or {}).get(fieldname)
            if isinstance(field_meta, dict):
                row["change_source"] = "automation"
                row["automation_name"] = str(field_meta.get("automation_name") or "").strip()
                row["automation_run_id"] = str(field_meta.get("automation_run_id") or "").strip()
                row["automation_action_type"] = str(field_meta.get("automation_action_type") or "").strip()
            out.append(row)
        self._sb_activity_changes = out

    def _write_activity_comments(self):
        changes = getattr(self, "_sb_activity_changes", None)
        if not isinstance(changes, list) or not changes:
            return
        # Avoid flooding in pathological updates.
        for ch in changes[:80]:
            try:
                payload = json.dumps(ch, ensure_ascii=False)
                c = frappe.new_doc("Comment")
                c.comment_type = "Info"
                c.reference_doctype = "Project"
                c.reference_name = self.name
                c.content = f"SB_ACTIVITY::{payload}"
                c.insert(ignore_permissions=True)
            except Exception:
                continue

    def _start_automation_run_log(self, auto, context=None):
        return {
            "run_id": frappe.generate_hash(length=12),
            "automation": str((auto or {}).get("name") or "").strip(),
            "automation_name": str((auto or {}).get("automation_name") or (auto or {}).get("name") or "").strip(),
            "project": self.name,
            "project_title": str(getattr(self, "project_name", "") or self.name).strip(),
            "project_type": str(getattr(self, "project_type", "") or "").strip(),
            "triggered_at": frappe.utils.now_datetime(),
            "execution_source": _normalize_automation_execution_source((context or {}).get("event")),
            "matched_triggers": _describe_automation_triggers(auto),
            "actions_attempted": _describe_automation_actions(auto),
            "changes": [],
            "notes": [],
        }

    def _record_automation_field_change(self, auto, action_type, fieldname, from_value, to_value):
        if not fieldname:
            return
        label = fieldname
        try:
            mf = self.meta.get_field(fieldname) if getattr(self, "meta", None) else None
            label = str(getattr(mf, "label", "") or fieldname)
        except Exception:
            label = fieldname
        from_text = _short_text(_value_to_text(from_value))
        to_text = _short_text(_value_to_text(to_value))
        ctx = getattr(self, "_sb_active_automation_run", None)
        if isinstance(ctx, dict):
            ctx.setdefault("changes", []).append({
                "fieldname": fieldname,
                "field_label": label,
                "action_type": str(action_type or "").strip(),
                "from_value": from_text,
                "to_value": to_text,
            })
        field_meta = getattr(self, "_sb_automation_field_meta", None)
        if not isinstance(field_meta, dict):
            field_meta = {}
            self._sb_automation_field_meta = field_meta
        field_meta[fieldname] = {
            "automation_name": str((auto or {}).get("automation_name") or (auto or {}).get("name") or "").strip(),
            "automation_run_id": str((ctx or {}).get("run_id") or "").strip(),
            "automation_action_type": str(action_type or "").strip(),
        }

    def _record_automation_note(self, action_type, message):
        ctx = getattr(self, "_sb_active_automation_run", None)
        if not isinstance(ctx, dict):
            return
        msg = str(message or "").strip()
        if not msg:
            return
        ctx.setdefault("notes", []).append({
            "action_type": str(action_type or "").strip(),
            "message": msg,
        })

    def _finish_automation_run_log(self, run_ctx, exec_result=None, failed=False, error_details=""):
        if not isinstance(run_ctx, dict):
            return
        changes = list(run_ctx.get("changes") or [])
        notes = list(run_ctx.get("notes") or [])
        changed_field_count = len({str(ch.get("fieldname") or "").strip() for ch in changes if str(ch.get("fieldname") or "").strip()})
        has_effect = bool(changes or notes or ((exec_result or {}).get("changed_any")))
        if failed:
            result = "Failed"
            message = str(error_details or "Automation failed").strip()
        elif has_effect:
            result = "Success"
            labels = [str(ch.get("field_label") or ch.get("fieldname") or "").strip() for ch in changes if str(ch.get("field_label") or ch.get("fieldname") or "").strip()]
            labels = list(dict.fromkeys(labels))
            if labels:
                preview = ", ".join(labels[:3])
                if len(labels) > 3:
                    preview += ", ..."
                message = f"Updated {preview}"
            elif notes:
                message = "; ".join([str(n.get("message") or "").strip() for n in notes if str(n.get("message") or "").strip()][:2])
            else:
                message = "Automation executed successfully"
        else:
            result = "No Change"
            message = "Automation matched but did not change anything"
        run_ctx["result"] = result
        run_ctx["message"] = message
        run_ctx["error_details"] = str(error_details or "").strip()
        run_ctx["changed_field_count"] = changed_field_count
        logs = getattr(self, "_sb_automation_run_logs", None)
        if not isinstance(logs, list):
            logs = []
            self._sb_automation_run_logs = logs
        logs.append(run_ctx)

    def _write_automation_run_logs(self):
        logs = getattr(self, "_sb_automation_run_logs", None)
        if not isinstance(logs, list) or not logs:
            return
        try:
            if not frappe.db.exists("DocType", "Automation Run Log"):
                return
        except Exception:
            return
        for log in logs[:80]:
            try:
                doc = frappe.get_doc({
                    "doctype": "Automation Run Log",
                    "run_id": log.get("run_id"),
                    "automation": log.get("automation"),
                    "automation_name": log.get("automation_name"),
                    "project": log.get("project"),
                    "project_title": log.get("project_title"),
                    "project_type": log.get("project_type"),
                    "triggered_at": log.get("triggered_at"),
                    "execution_source": log.get("execution_source"),
                    "result": log.get("result"),
                    "matched_triggers": log.get("matched_triggers"),
                    "actions_attempted": log.get("actions_attempted"),
                    "message": log.get("message"),
                    "error_details": log.get("error_details"),
                    "changed_field_count": int(log.get("changed_field_count") or 0),
                    "changes": list(log.get("changes") or []),
                })
                doc.insert(ignore_permissions=True)
            except Exception:
                continue
        self._sb_automation_run_logs = []


# =========================================================================
# Module-level helpers
# =========================================================================

def _parse_json(val):
    """Safely parse a JSON string or return dict as-is."""
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return {}
    return {}


def _parse_json_array(val):
    """Safely parse a JSON string as a list, or return list as-is."""
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        try:
            parsed = json.loads(val)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


def _send_automation_in_app_notifications(
    project_name: str,
    project_title: str,
    recipients: list[str],
    role: str,
    automation_name: str = "",
) -> None:
    """
    Deliver automation notifications with in-app first, email second.
    Both paths are fail-open so automation itself never breaks because of notification delivery.
    """
    actor = str(getattr(frappe.session, "user", "") or "").strip() or "Administrator"
    users = get_enabled_notification_recipients(
        recipients,
        exclude_user=None if actor == "Administrator" else actor,
    )
    if not users:
        return

    title = str(project_title or project_name or "").strip() or project_name
    auto_suffix = f" ({automation_name})" if automation_name else ""
    subject = f"Automation{auto_suffix} notified you in {title}"
    preview = f"Role: {role}"
    create_in_app_notifications(
        users,
        actor=actor,
        document_type="Project",
        document_name=project_name,
        subject=subject,
        preview=preview,
        notification_type="Alert",
    )
    message_html = (
        f"<p><b>{frappe.utils.escape_html(subject)}</b></p>"
        f"<p>{frappe.utils.escape_html(preview or '(no preview)')}</p>"
    )
    send_notification_emails_safe(
        users,
        subject=subject,
        message_html=message_html,
        context_label=f"automation_notify:{project_name}",
    )


def _roll_date_by_frequency(current_date, frequency: str):
    """Calculate the next date based on frequency.

    EOM rule:
    - If current_date is the last day of its month, keep result at target month-end
      for month-based frequencies (monthly/quarterly/half-yearly/yearly).
    """
    freq = str(frequency or "").strip().lower()
    d = getdate(current_date)
    is_eom = d == get_last_day(d)

    if freq in ("weekly",):
        return add_days(d, 7)
    if freq in ("fortnightly", "fortnight", "biweekly", "bi-weekly", "bi weekly"):
        return add_days(d, 14)
    if freq in ("monthly",):
        nd = add_months(d, 1)
        return get_last_day(nd) if is_eom else nd
    if freq in ("quarterly",):
        nd = add_months(d, 3)
        return get_last_day(nd) if is_eom else nd
    if freq in ("half-yearly", "half yearly", "halfyearly"):
        nd = add_months(d, 6)
        return get_last_day(nd) if is_eom else nd
    if freq in ("yearly",):
        nd = add_months(d, 12)
        return get_last_day(nd) if is_eom else nd

    return None


def _target_month_step_by_frequency(frequency: str) -> int:
    freq = str(frequency or "").strip().lower()
    if freq in ("monthly",):
        return 1
    if freq in ("quarterly",):
        return 3
    if freq in ("half-yearly", "half yearly", "halfyearly"):
        return 6
    if freq in ("yearly",):
        return 12
    return 0


def _normalize_automation_execution_source(event: str | None) -> str:
    ev = str(event or "").strip().lower()
    if ev == "hourly":
        return "Hourly Scheduler"
    if ev == "daily":
        return "Daily Scheduler"
    if ev == "manual":
        return "Manual"
    if ev == "validate":
        return "Validate"
    return "Other"


def _describe_automation_triggers(auto) -> str:
    config = _parse_json((auto or {}).get("trigger_config"))
    triggers = config.get("triggers") if isinstance(config, dict) else None
    if not isinstance(triggers, list) or not triggers:
        triggers = [{"trigger_type": str((auto or {}).get("trigger_type") or "").strip()}]
    labels = []
    for tr in triggers:
        if not isinstance(tr, dict):
            continue
        labels.append(str(tr.get("trigger_type") or "").strip())
    labels = [x for x in labels if x]
    return ", ".join(labels[:10])


def _describe_automation_actions(auto) -> str:
    actions = _parse_json_array((auto or {}).get("actions"))
    labels = [str((a or {}).get("action_type") or "").strip() for a in (actions or []) if str((a or {}).get("action_type") or "").strip()]
    return ", ".join(labels[:10])


_AUDIT_SKIP_FIELDS = {
    "modified",
    "modified_by",
    "creation",
    "owner",
    "idx",
    "_user_tags",
    "_comments",
    "_assign",
    "_liked_by",
}

_AUDIT_SKIP_FIELDTYPES = {
    "Section Break",
    "Column Break",
    "Tab Break",
    "Fold",
    "HTML",
    "Button",
}

# Restrict to board domain columns to avoid noisy ERPNext internal recalculation logs.
_AUDIT_TRACK_FIELDS = {
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


def _short_text(v: str, max_len: int = 180) -> str:
    s = str(v or "").strip()
    if len(s) <= max_len:
        return s
    return f"{s[: max_len - 3]}..."


def _value_to_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return ", ".join([_value_to_text(x) for x in v if _value_to_text(x)])
    if isinstance(v, dict):
        try:
            return json.dumps(v, ensure_ascii=False, sort_keys=True)
        except Exception:
            return str(v)
    return str(v).strip()


def _table_summary(fieldname: str, rows) -> str:
    arr = rows if isinstance(rows, list) else []
    if fieldname == "custom_team_members":
        # role:user list, stable order
        role_map = {}
        for r in arr:
            if not isinstance(r, dict):
                try:
                    r = r.as_dict()
                except Exception:
                    r = {}
            role = str(r.get("role") or "").strip()
            user = str(r.get("user") or "").strip()
            if not role and not user:
                continue
            key = role or "(no role)"
            role_map.setdefault(key, [])
            if user:
                role_map[key].append(user)
        parts = []
        for role in sorted(role_map.keys()):
            users = sorted(set([u for u in role_map[role] if u]))
            parts.append(f"{role}: {', '.join(users)}" if users else role)
        return " | ".join(parts)
    if fieldname == "custom_softwares":
        vals = []
        for r in arr:
            if not isinstance(r, dict):
                try:
                    r = r.as_dict()
                except Exception:
                    # Fallback for values already represented as strings.
                    v0 = str(r or "").strip()
                    if v0:
                        vals.append(v0)
                    continue
            v = str(r.get("software") or r.get("software_name") or r.get("name") or "").strip()
            if v:
                vals.append(v)
        vals = sorted(set(vals))
        return ", ".join(vals)
    # Generic table fallback: normalized row count + key data preview
    cleaned = []
    for r in arr:
        if not isinstance(r, dict):
            try:
                r = r.as_dict()
            except Exception:
                r = {}
        row = {}
        for k, v in (r or {}).items():
            key = str(k or "").strip()
            if not key or key in {"name", "parent", "parenttype", "parentfield", "idx", "owner", "creation", "modified", "modified_by", "docstatus", "doctype"}:
                continue
            txt = _value_to_text(v)
            if txt:
                row[key] = txt
        if row:
            cleaned.append(row)
    cleaned.sort(key=lambda x: json.dumps(x, sort_keys=True, ensure_ascii=False))
    if not cleaned:
        return ""
    try:
        return _short_text(json.dumps(cleaned, ensure_ascii=False, sort_keys=True), max_len=300)
    except Exception:
        return _short_text(str(cleaned), max_len=300)
