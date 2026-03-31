/**
 * NewClientModal (Website-safe)
 * - UI-only: minimal customer creation form.
 */
import { Modal } from '../Common/Modal.js';
import { MultiLinkPicker } from '../Common/MultiLinkPicker.js';
import { escapeHtml } from '../../utils/dom.js';
import { DoctypeMetaService } from '../../services/doctypeMetaService.js';
import { formatClientName } from '../../utils/clientNameFormat.js';
import { ClientsService } from '../../services/clientsService.js';
import { confirmDialog } from '../../services/uiAdapter.js';
import { UserPickerService } from '../../services/userPickerService.js';

function mapEntityTypeFromCustomerType(customerType) {
  const t = String(customerType || '').trim().toLowerCase();
  if (t === 'company') return 'Company';
  if (t === 'trust') return 'Trust';
  if (t === 'partner' || t === 'partnership') return 'Partnership';
  return 'Individual';
}

export class NewClientModal {
  constructor({ title = 'New Client', initial = {}, onSubmit, onClose } = {}) {
    this.title = title;
    this.initial = initial || {};
    this.onSubmit = onSubmit || (async () => {});
    this.onClose = onClose || (() => {});
    this._modal = null;
    this._root = null;
    this._nameChoice = null;
    this._initialSnapshot = null;
    this._partnerInput = null;
  }

  async open() {
    this.close();

    const content = document.createElement('div');
    content.innerHTML = `
      <div class="sb-newclient">
        <div class="sb-newproj__row">
          <label class="sb-newproj__label">Client Name *</label>
          <input class="form-control" id="sbNewClientName" type="text" placeholder="e.g. David Tao" />
        </div>

        <div style="display:flex; gap:12px; flex-wrap: wrap;">
          <div class="sb-newproj__row" style="min-width:220px; flex:1;">
            <label class="sb-newproj__label">Client Type</label>
            <select class="form-control" id="sbNewClientType">
              <option value="" disabled selected>Loading...</option>
            </select>
          </div>
          <div class="sb-newproj__row" style="min-width:220px; flex:1;">
            <label class="sb-newproj__label">Year End *</label>
            <select class="form-control" id="sbNewClientYearEnd">
              <option value="" disabled selected>Loading...</option>
            </select>
          </div>
        </div>

        <div style="display:flex; gap:12px; flex-wrap: wrap;">
          <div class="sb-newproj__row" style="min-width:220px; flex:1;">
            <label class="sb-newproj__label">ABN (optional)</label>
            <input class="form-control" id="sbNewClientAbn" type="text" placeholder="(optional)" />
          </div>
          <div class="sb-newproj__row" style="min-width:220px; flex:1;">
            <label class="sb-newproj__label">Partner (optional)</label>
            <div id="sbNewClientPartner"></div>
          </div>
        </div>

        <div class="sb-newproj__error text-danger" id="sbNewClientError" style="display:none;"></div>
        <div class="text-muted" style="font-size:12px; margin-top:6px;">
          Note: Group / Territory will use system defaults. You can refine later in ERPNext if needed.
        </div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';
    footer.innerHTML = `
      <button class="btn btn-default" type="button" id="sbNewClientCancel">Cancel</button>
      <button class="btn btn-primary" type="button" id="sbNewClientCreate">Create</button>
    `;

    this._modal = new Modal({
      title: this.title,
      contentEl: content,
      footerEl: footer,
      closeOnOverlayClick: false,
      beforeClose: async () => this._confirmDiscardIfDirty(),
      onClose: () => this.onClose(),
    });
    this._modal.open();
    this._root = content;

    // Init
    const nameEl = content.querySelector('#sbNewClientName');
    if (nameEl) nameEl.value = this.initial.customer_name || '';

    // Load select options from backend meta (single source of truth)
    await this._loadSelectOptions();
    this._mountPartnerInput();
    this._initialSnapshot = this._snapshotForm();

    // Bind
    footer.querySelector('#sbNewClientCancel')?.addEventListener('click', () => this._modal?.requestClose?.('cancel'));
    footer.querySelector('#sbNewClientCreate')?.addEventListener('click', () => this._handleSubmit());
    const typeSel = content.querySelector('#sbNewClientType');
    nameEl?.addEventListener?.('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._handleSubmit();
      }
    });
    nameEl?.addEventListener?.('input', () => {
      // Clear previous choice if user edits the name
      this._nameChoice = null;
    });
    typeSel?.addEventListener?.('change', () => {
      // Reset choice when type changes (rules differ)
      this._nameChoice = null;
    });
  }

  close() {
    try { this._partnerInput?.destroy?.(); } catch (e) {}
    this._partnerInput = null;
    this._modal?.close?.();
    this._modal = null;
    this._root = null;
    this._initialSnapshot = null;
  }

  _setError(msg) {
    const el = this._root?.querySelector?.('#sbNewClientError');
    if (!el) return;
    const m = String(msg || '').trim();
    el.textContent = m;
    el.style.display = m ? 'block' : 'none';
  }

  async _loadSelectOptions() {
    const typeSel = this._root?.querySelector?.('#sbNewClientType');
    const yearSel = this._root?.querySelector?.('#sbNewClientYearEnd');
    if (!typeSel || !yearSel) return;

    // Customer.customer_type options
    const types = await DoctypeMetaService.getSelectOptions('Customer', 'customer_type');
    const safeTypes = (types || []).filter(Boolean);
    if (!safeTypes.some((t) => String(t || '').trim().toLowerCase() === 'trust')) {
      safeTypes.push('Trust');
    }
    typeSel.innerHTML = safeTypes.length
      ? safeTypes.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')
      : `<option value="Individual">Individual</option><option value="Company">Company</option><option value="Partnership">Partnership</option><option value="Trust">Trust</option>`;

    // Customer Entity.year_end options (configured in ERPNext)
    const yearEnds = await DoctypeMetaService.getSelectOptions('Customer Entity', 'year_end', { force: true });
    const safeYears = (yearEnds || []).filter(Boolean);
    yearSel.innerHTML = `
      <option value="" disabled selected>Select year end</option>
      ${safeYears.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')}
    `;
  }

  _mountPartnerInput() {
    const mount = this._root?.querySelector?.('#sbNewClientPartner');
    if (!mount) return;
    try { this._partnerInput?.destroy?.(); } catch (e) {}
    this._partnerInput = new MultiLinkPicker(mount, {
      doctype: 'User',
      placeholder: 'Search partner...',
      initialValues: this.initial.custom_partner ? [this.initial.custom_partner] : [],
      defaultList: () => UserPickerService.defaultUserList(),
      searchProvider: (txt) => UserPickerService.searchUserNames(txt),
      resolveMeta: (values) => UserPickerService.resolveUserMeta(values),
      max: 1,
    });
  }

  _snapshotForm() {
    return {
      customer_name: String(this._root?.querySelector?.('#sbNewClientName')?.value || '').trim(),
      customer_type: String(this._root?.querySelector?.('#sbNewClientType')?.value || '').trim(),
      year_end: String(this._root?.querySelector?.('#sbNewClientYearEnd')?.value || '').trim(),
      abn: String(this._root?.querySelector?.('#sbNewClientAbn')?.value || '').trim(),
      custom_partner: String((this._partnerInput?.getValue?.() || [])[0] || '').trim(),
    };
  }

  _isDirty() {
    const initial = this._initialSnapshot || {};
    const current = this._snapshotForm();
    return Object.keys(current).some((key) => String(current[key] || '').trim() !== String(initial[key] || '').trim());
  }

  async _confirmDiscardIfDirty() {
    if (!this._isDirty()) return true;
    return await confirmDialog('You have unsaved client details. Discard them?');
  }

  async _handleSubmit() {
    this._setError('');
    const customer_type = String(this._root?.querySelector?.('#sbNewClientType')?.value || '').trim() || 'Individual';
    const rawName = String(this._root?.querySelector?.('#sbNewClientName')?.value || '').trim();
    let customer_name = rawName;
    const suggested = formatClientName(rawName, customer_type);

    const year_end = String(this._root?.querySelector?.('#sbNewClientYearEnd')?.value || '').trim();
    const abn = String(this._root?.querySelector?.('#sbNewClientAbn')?.value || '').trim();
    const custom_partner = String((this._partnerInput?.getValue?.() || [])[0] || '').trim();

    if (!customer_name) {
      this._setError('Client Name is required');
      return;
    }
    if (!year_end) {
      this._setError('Year End is required');
      return;
    }

    if (suggested && suggested !== rawName) {
      const cached = this._nameChoice;
      if (cached && cached.raw === rawName && cached.type === customer_type && cached.choice) {
        customer_name = cached.choice;
      } else {
        // Let user pick a name and submit immediately (no extra Create click)
        return this._chooseNameAndSubmit({
          rawName,
          suggested,
          customer_type,
          year_end,
          abn,
          custom_partner,
        });
      }
    }

    // Current phase: customer itself is treated as the primary entity.
    // We keep the backend interface ready for future multi-entity expansion.
    const primary_entity = {
      entity_name: customer_name,
      entity_type: mapEntityTypeFromCustomerType(customer_type),
      year_end: year_end,
      abn: abn || null,
    };

    const btn = this._modal?._overlay?.querySelector?.('#sbNewClientCreate');
    if (btn) btn.disabled = true;
    return this._submitClient({ customer_name, customer_type, primary_entity, custom_partner, btn });
  }

  async _submitClient({ customer_name, customer_type, primary_entity, custom_partner, btn }) {
    try {
      // Name must be unique; do not allow duplicate create.
      const existsResp = await ClientsService.checkClientNameExists(customer_name);
      if (existsResp?.exists) {
        this._setError('Client name already exists. Please use a unique name.');
        return;
      }
      await this.onSubmit({ customer_name, customer_type, primary_entity, custom_partner: custom_partner || null });
      this.close();
    } catch (e) {
      this._setError(e?.message || String(e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async _chooseNameAndSubmit({ rawName, suggested, customer_type, year_end, abn, custom_partner }) {
    return await new Promise((resolve) => {
      const content = document.createElement('div');
      content.innerHTML = `
        <div style="font-size:14px; line-height:1.5;">
          <div style="margin-bottom:8px;">We generated a standard name based on your input.</div>
          <div style="margin-bottom:6px;"><strong>Suggested:</strong> ${escapeHtml(suggested)}</div>
          <div style="margin-bottom:12px;"><strong>Your input:</strong> ${escapeHtml(rawName)}</div>
          <div class="text-muted" style="font-size:12px;">Choose which name to use.</div>
        </div>
      `;

      const footer = document.createElement('div');
      footer.style.display = 'flex';
      footer.style.justifyContent = 'flex-end';
      footer.style.gap = '10px';
      footer.innerHTML = `
        <button class="btn btn-default" type="button" id="sbNameUseRaw">Use my input</button>
        <button class="btn btn-primary" type="button" id="sbNameUseSuggested">Use suggested</button>
      `;

      const modal = new Modal({
        title: 'Confirm Client Name',
        contentEl: content,
        footerEl: footer,
        onClose: () => resolve(null),
      });
      modal.open();

      footer.querySelector('#sbNameUseRaw')?.addEventListener('click', () => {
        modal.close();
        const choice = String(rawName || '').trim();
        this._nameChoice = { raw: rawName, type: customer_type, choice };
        this._submitClient({
          customer_name: choice,
          customer_type,
          primary_entity: {
            entity_name: choice,
            entity_type: mapEntityTypeFromCustomerType(customer_type),
            year_end: year_end,
            abn: abn || null,
          },
          custom_partner,
          btn: this._modal?._overlay?.querySelector?.('#sbNewClientCreate'),
        });
        resolve(choice);
      });
      footer.querySelector('#sbNameUseSuggested')?.addEventListener('click', () => {
        modal.close();
        const choice = String(suggested || '').trim();
        this._nameChoice = { raw: rawName, type: customer_type, choice };
        this._submitClient({
          customer_name: choice,
          customer_type,
          primary_entity: {
            entity_name: choice,
            entity_type: mapEntityTypeFromCustomerType(customer_type),
            year_end: year_end,
            abn: abn || null,
          },
          custom_partner,
          btn: this._modal?._overlay?.querySelector?.('#sbNewClientCreate'),
        });
        resolve(choice);
      });
    });
  }
}


