/**
 * EditClientModal (Website-safe)
 * - UI-only: edit core client fields.
 */
import { Modal } from '../Common/Modal.js';
import { MultiLinkPicker } from '../Common/MultiLinkPicker.js';
import { escapeHtml } from '../../utils/dom.js';
import { DoctypeMetaService } from '../../services/doctypeMetaService.js';
import { formatClientName } from '../../utils/clientNameFormat.js';
import { ClientsService } from '../../services/clientsService.js';
import { UserPickerService } from '../../services/userPickerService.js';

export class EditClientModal {
  constructor({ title = 'Edit Client', initial = {}, onSubmit, onClose } = {}) {
    this.title = title;
    this.initial = initial || {};
    this.onSubmit = onSubmit || (async () => {});
    this.onClose = onClose || (() => {});
    this._modal = null;
    this._root = null;
    this._partnerInput = null;
  }

  async open() {
    this.close();

    const content = document.createElement('div');
    content.innerHTML = `
      <div class="sb-newclient">
        <div class="sb-newproj__row">
          <label class="sb-newproj__label">Client Name *</label>
          <input class="form-control" id="sbEditClientName" type="text" placeholder="e.g. David Tao" />
        </div>

        <div style="display:flex; gap:12px; flex-wrap: wrap;">
          <div class="sb-newproj__row" style="min-width:220px; flex:1;">
            <label class="sb-newproj__label">Entity Type *</label>
            <select class="form-control" id="sbEditClientEntityType">
              <option value="" disabled selected>Loading...</option>
            </select>
          </div>
          <div class="sb-newproj__row" style="min-width:220px; flex:1;">
            <label class="sb-newproj__label">Year End *</label>
            <select class="form-control" id="sbEditClientYearEnd">
              <option value="" disabled selected>Loading...</option>
            </select>
          </div>
        </div>

        <div class="sb-newproj__row">
          <label class="sb-newproj__label">Partner (optional)</label>
          <div id="sbEditClientPartner"></div>
        </div>

        <div class="sb-newproj__error text-danger" id="sbEditClientError" style="display:none;"></div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';
    footer.innerHTML = `
      <button class="btn btn-default" type="button" id="sbEditClientCancel">Cancel</button>
      <button class="btn btn-primary" type="button" id="sbEditClientSave">Save</button>
    `;

    this._modal = new Modal({
      title: this.title,
      contentEl: content,
      footerEl: footer,
      onClose: () => this.onClose(),
    });
    this._modal.open();
    this._root = content;

    // Init fields
    const nameEl = content.querySelector('#sbEditClientName');
    if (nameEl) nameEl.value = this.initial.customer_name || this.initial.name || '';

    await this._loadSelectOptions();
    this._mountPartnerInput();

    // Apply initial selects after options load
    const typeSel = content.querySelector('#sbEditClientEntityType');
    const yearSel = content.querySelector('#sbEditClientYearEnd');
    if (typeSel && this.initial.entity_type) typeSel.value = String(this.initial.entity_type);
    if (yearSel && this.initial.year_end) yearSel.value = String(this.initial.year_end);

    // Bind
    footer.querySelector('#sbEditClientCancel')?.addEventListener('click', () => this.close());
    footer.querySelector('#sbEditClientSave')?.addEventListener('click', () => this._handleSubmit());
    nameEl?.addEventListener?.('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._handleSubmit();
      }
    });
  }

  close() {
    try { this._partnerInput?.destroy?.(); } catch (e) {}
    this._partnerInput = null;
    this._modal?.close?.();
    this._modal = null;
    this._root = null;
  }

  _setError(msg) {
    const el = this._root?.querySelector?.('#sbEditClientError');
    if (!el) return;
    const m = String(msg || '').trim();
    el.textContent = m;
    el.style.display = m ? 'block' : 'none';
  }

  async _loadSelectOptions() {
    const typeSel = this._root?.querySelector?.('#sbEditClientEntityType');
    const yearSel = this._root?.querySelector?.('#sbEditClientYearEnd');
    if (!typeSel || !yearSel) return;

    // Customer Entity.entity_type options
    const types = await DoctypeMetaService.getSelectOptions('Customer Entity', 'entity_type', { force: true });
    const safeTypes = (types || []).filter(Boolean);
    const fallbackType = this.initial.entity_type ? [String(this.initial.entity_type)] : [];
    const typeOptions = safeTypes.length ? safeTypes : fallbackType;
    typeSel.innerHTML = typeOptions.length
      ? typeOptions.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')
      : `<option value="" disabled selected>No options</option>`;

    // Customer Entity.year_end options
    const yearEnds = await DoctypeMetaService.getSelectOptions('Customer Entity', 'year_end', { force: true });
    const safeYears = (yearEnds || []).filter(Boolean);
    const fallbackYear = this.initial.year_end ? [String(this.initial.year_end)] : [];
    const yearOptions = safeYears.length ? safeYears : fallbackYear;
    yearSel.innerHTML = `
      <option value="" disabled selected>Select year end</option>
      ${yearOptions.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')}
    `;
  }

  _mountPartnerInput() {
    const mount = this._root?.querySelector?.('#sbEditClientPartner');
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

  async _handleSubmit() {
    this._setError('');
    const customer_name = String(this._root?.querySelector?.('#sbEditClientName')?.value || '').trim();
    const entity_type = String(this._root?.querySelector?.('#sbEditClientEntityType')?.value || '').trim();
    const year_end = String(this._root?.querySelector?.('#sbEditClientYearEnd')?.value || '').trim();
    const custom_partner = String((this._partnerInput?.getValue?.() || [])[0] || '').trim();

    if (!customer_name) {
      this._setError('Client Name is required');
      return;
    }
    if (!entity_type) {
      this._setError('Entity Type is required');
      return;
    }
    if (!year_end) {
      this._setError('Year End is required');
      return;
    }

    const suggested = formatClientName(customer_name, entity_type || 'Company');
    if (suggested && suggested !== customer_name) {
      return this._chooseNameAndSubmit({
        rawName: customer_name,
        suggested,
        entity_type,
        year_end,
        custom_partner,
      });
    }

    return this._submitUpdate({ customer_name, entity_type, year_end, custom_partner });
  }

  async _submitUpdate({ customer_name, entity_type, year_end, custom_partner }) {
    const btn = this._modal?._overlay?.querySelector?.('#sbEditClientSave');
    if (btn) btn.disabled = true;
    try {
      const existsResp = await ClientsService.checkClientNameExists(customer_name, {
        excludeName: this.initial.name,
      });
      if (existsResp?.exists) {
        this._setError('Client name already exists. Please use a unique name.');
        return;
      }
      await this.onSubmit({ name: this.initial.name, customer_name, entity_type, year_end, custom_partner: custom_partner || null });
      this.close();
    } catch (e) {
      this._setError(e?.message || String(e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async _chooseNameAndSubmit({ rawName, suggested, entity_type, year_end, custom_partner }) {
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
        <button class="btn btn-default" type="button" id="sbEditNameUseRaw">Use my input</button>
        <button class="btn btn-primary" type="button" id="sbEditNameUseSuggested">Use suggested</button>
      `;

      const modal = new Modal({
        title: 'Confirm Client Name',
        contentEl: content,
        footerEl: footer,
        onClose: () => resolve(null),
      });
      modal.open();

      footer.querySelector('#sbEditNameUseRaw')?.addEventListener('click', () => {
        modal.close();
        this._submitUpdate({ customer_name: rawName, entity_type, year_end, custom_partner });
        resolve(rawName);
      });
      footer.querySelector('#sbEditNameUseSuggested')?.addEventListener('click', () => {
        modal.close();
        this._submitUpdate({ customer_name: suggested, entity_type, year_end, custom_partner });
        resolve(suggested);
      });
    });
  }
}


