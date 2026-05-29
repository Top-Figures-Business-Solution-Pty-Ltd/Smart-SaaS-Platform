/**
 * NewProjectModal (Website-safe)
 * - UI-only: renders a small form in a Modal and returns user input on submit.
 * - Data access is performed by controllers/services.
 */
import { Modal } from '../Common/Modal.js';
import { LinkInput } from '../Common/LinkInput.js';
import { DoctypeMetaService } from '../../services/doctypeMetaService.js';
import { confirmDialog } from '../../services/uiAdapter.js';
import { getErrorMessage } from '../../utils/errorMessage.js';
import { escapeHtml } from '../../utils/dom.js';

export class NewProjectModal {
  constructor({ title = 'New Project', initial = {}, fixedCustomer = null, lockCustomer = false, formConfig = {}, onSubmit, onCreateClient, onClose } = {}) {
    this.title = title;
    this.initial = initial || {};
    this.fixedCustomer = String(fixedCustomer || '').trim();
    this.lockCustomer = !!lockCustomer;
    this.formConfig = formConfig || {};
    this.onSubmit = onSubmit || (async () => {});
    this.onCreateClient = onCreateClient || null;
    this.onClose = onClose || (() => {});

    this._modal = null;
    this._root = null;
    this._linkInputs = [];
    this._linkInputsByDoctype = new Map(); // key: doctype -> LinkInput
    this._initialSnapshot = null;
    this._autoFrequencyApplied = false;
  }

  async open() {
    this.close();
    const visibleFields = this.formConfig?.visibleFields || {};
    const showCompany = visibleFields.company !== false;
    const showFiscalYear = visibleFields.fiscalYear !== false;
    const showProjectType = visibleFields.projectType !== false;
    const showFrequency = visibleFields.frequency !== false;
    const showGrantFy = visibleFields.grantFy === true;

    // When formConfig provides a fixed list (e.g. Smart Grants year boards), render the
    // Project Type field as a constrained <select> instead of a free Link search.
    const projectTypeOptions = Array.isArray(this.formConfig?.projectTypeOptions)
      ? this.formConfig.projectTypeOptions.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    const useProjectTypeSelect = showProjectType && projectTypeOptions.length > 0;

    const content = document.createElement('div');
    const customerRowHTML = this.lockCustomer
      ? `
        <div class="sb-newproj__row">
          <label class="sb-newproj__label">Client</label>
          <div id="sbNewProjCustomer"></div>
          <div class="text-muted" style="font-size:12px; margin-top:6px;">Client is fixed from current client context.</div>
        </div>
      `
      : `
        <div class="sb-newproj__row">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <label class="sb-newproj__label" style="margin:0;">Client</label>
            <button class="btn btn-default" type="button" id="sbNewProjNewClient" style="padding:4px 10px; font-size:12px;">
              New Client
            </button>
          </div>
          <div id="sbNewProjCustomer"></div>
        </div>
      `;
    content.innerHTML = `
      <div class="sb-newproj">
        <div class="sb-newproj__row">
          <label class="sb-newproj__label">Project Name</label>
          <input class="form-control" id="sbNewProjName" type="text" placeholder="e.g. Client A - FY25 ITR" />
        </div>

        ${customerRowHTML}

        ${showCompany ? `
          <div class="sb-newproj__row">
            <label class="sb-newproj__label">Company</label>
            <div id="sbNewProjCompany"></div>
          </div>
        ` : '<div id="sbNewProjCompany" style="display:none;"></div>'}

        ${showFiscalYear ? `
          <div class="sb-newproj__row">
            <label class="sb-newproj__label">Fiscal Year</label>
            <div id="sbNewProjFiscalYear"></div>
          </div>
        ` : '<div id="sbNewProjFiscalYear" style="display:none;"></div>'}

        ${showGrantFy ? `
          <div class="sb-newproj__row">
            <label class="sb-newproj__label">FY/CY</label>
            <input class="form-control" id="sbNewProjGrantFy" type="text" placeholder="e.g. FY25 / CY2025" />
          </div>
        ` : ''}

        ${showProjectType ? `
          <div class="sb-newproj__row">
            <label class="sb-newproj__label">Project Type</label>
            ${useProjectTypeSelect
              ? `<select class="form-control" id="sbNewProjTypeSelect">${projectTypeOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}</select>`
              : '<div id="sbNewProjType"></div>'}
          </div>
        ` : '<div id="sbNewProjType" style="display:none;"></div>'}

        ${showFrequency ? `
          <div class="sb-newproj__row">
            <label class="sb-newproj__label">Frequency</label>
            <select class="form-control" id="sbNewProjFrequency">
              <option value="" disabled selected>Loading...</option>
            </select>
          </div>
        ` : '<select class="form-control" id="sbNewProjFrequency" style="display:none;"></select>'}

        <div class="sb-newproj__error text-danger" id="sbNewProjError" style="display:none;"></div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';
    footer.innerHTML = `
      <button class="btn btn-default" type="button" id="sbNewProjCancel">Cancel</button>
      <button class="btn btn-primary" type="button" id="sbNewProjCreate">Create</button>
    `;

    this._modal = new Modal({
      title: this.title,
      contentEl: content,
      footerEl: footer,
      closeOnOverlayClick: false,
      beforeClose: async () => this._confirmDiscardIfDirty(),
      onClose: () => {
        this._destroyInputs();
        this.onClose();
      }
    });
    this._modal.open();
    this._root = content;

    // Populate initial values
    const nameEl = content.querySelector('#sbNewProjName');
    if (nameEl) nameEl.value = this.initial.project_name || '';
    const grantFyEl = content.querySelector('#sbNewProjGrantFy');
    if (grantFyEl) grantFyEl.value = this.initial.custom_grants_fy_label || '';

    // Link inputs
    const customerInitial = this.fixedCustomer || this.initial.customer || null;
    this._mountLink('sbNewProjCustomer', 'Customer', customerInitial);
    this._mountLink('sbNewProjCompany', 'Company', this.initial.company || null);
    this._mountLink('sbNewProjFiscalYear', 'Fiscal Year', this.initial.custom_fiscal_year || this.initial.fiscal_year || null);
    if (useProjectTypeSelect) {
      const ptSel = content.querySelector('#sbNewProjTypeSelect');
      if (ptSel) {
        const init = String(this.initial.project_type || '').trim();
        if (init && projectTypeOptions.includes(init)) ptSel.value = init;
        ptSel.addEventListener('change', () => this._syncFrequencyForProjectType(ptSel.value, { emptyOnly: false }));
      }
    } else {
      this._mountLink('sbNewProjType', 'Project Type', this.initial.project_type || null);
    }

    // Load current Project metadata/options.
    try { await DoctypeMetaService.getMeta('Project', { force: true }); } catch (e) {}
    await this._loadSelectOptions();
    this._initialSnapshot = this._snapshotForm();

    // Bind
    footer.querySelector('#sbNewProjCancel')?.addEventListener('click', () => this._modal?.requestClose?.('cancel'));
    footer.querySelector('#sbNewProjCreate')?.addEventListener('click', () => this._handleSubmit());
    content.querySelector('#sbNewProjNewClient')?.addEventListener('click', () => this._handleCreateClient());
    if (!this.onCreateClient) {
      const btn = content.querySelector('#sbNewProjNewClient');
      if (btn) btn.style.display = 'none';
    }
    if (this.lockCustomer) {
      const customerMount = content.querySelector('#sbNewProjCustomer');
      const customerInput = customerMount?.querySelector?.('input');
      if (customerInput) {
        customerInput.readOnly = true;
        customerInput.disabled = true;
        customerInput.style.background = '#f8f9fa';
        customerInput.style.cursor = 'not-allowed';
      }
    }

    // Enter to submit when in Project Name field
    nameEl?.addEventListener?.('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._handleSubmit();
      }
    });
  }

  close() {
    this._modal?.close?.();
    this._modal = null;
    this._root = null;
    this._initialSnapshot = null;
    this._autoFrequencyApplied = false;
  }

  _destroyInputs() {
    for (const li of this._linkInputs) {
      try { li?.destroy?.(); } catch (e) {}
    }
    this._linkInputs = [];
  }

  _setError(msg) {
    const el = this._root?.querySelector?.('#sbNewProjError');
    if (!el) return;
    const m = String(msg || '').trim();
    el.textContent = m;
    el.style.display = m ? 'block' : 'none';
  }

  _mountLink(mountId, doctype, initialValue) {
    const mount = this._root?.querySelector?.(`#${CSS.escape(mountId)}`);
    if (!mount) return;
    mount.innerHTML = `<div class="sb-inline-editor sb-inline-editor--link"></div>`;
    const inner = mount.querySelector('.sb-inline-editor--link');
    if (!inner) return;
    const displayLabel = (doctype === 'Customer') ? 'Client' : doctype;
    const li = new LinkInput(inner, {
      doctype,
      placeholder: `Search ${displayLabel}...`,
      initialValue: initialValue || null,
      displayField: doctype === 'Customer' ? 'customer_name' : null,
      onChange: (value) => {
        if (doctype === 'Project Type') {
          this._syncFrequencyForProjectType(value, { emptyOnly: true });
        }
      },
    });
    this._linkInputs.push(li);
    this._linkInputsByDoctype.set(doctype, li);
  }

  _setValueForLinkInput(doctype, value) {
    const li = this._linkInputsByDoctype.get(doctype);
    if (li?.setValue) {
      li.setValue(value || null);
      return;
    }
    // fallback: best-effort DOM write
    const map = {
      'Customer': '#sbNewProjCustomer',
      'Company': '#sbNewProjCompany',
      'Fiscal Year': '#sbNewProjFiscalYear',
      'Project Type': '#sbNewProjType',
    };
    const sel = map[doctype];
    const mount = sel ? this._root?.querySelector?.(sel) : null;
    const input = mount?.querySelector?.('input');
    if (input) input.value = value || '';
  }

  _readValueFromLinkInput(doctype) {
    const li = this._linkInputsByDoctype.get(doctype);
    if (li?.getValue) {
      return String(li.getValue() || '').trim();
    }
    // Fallback for safety: read the visible input text.
    const map = {
      'Customer': '#sbNewProjCustomer',
      'Company': '#sbNewProjCompany',
      'Fiscal Year': '#sbNewProjFiscalYear',
      'Project Type': '#sbNewProjType',
    };
    const sel = map[doctype];
    const mount = sel ? this._root?.querySelector?.(sel) : null;
    const input = mount?.querySelector?.('input');
    return String(input?.value || '').trim();
  }

  _readProjectType() {
    const sel = this._root?.querySelector?.('#sbNewProjTypeSelect');
    if (sel) return String(sel.value || '').trim();
    return this._readValueFromLinkInput('Project Type');
  }

  _readDisplayTextFromLinkInput(doctype) {
    const map = {
      'Customer': '#sbNewProjCustomer',
      'Company': '#sbNewProjCompany',
      'Fiscal Year': '#sbNewProjFiscalYear',
      'Project Type': '#sbNewProjType',
    };
    const sel = map[doctype];
    const mount = sel ? this._root?.querySelector?.(sel) : null;
    const input = mount?.querySelector?.('input');
    return String(input?.value || '').trim();
  }

  _isAdHocProjectType(projectType) {
    return /\bad[\s-]?hoc\b/i.test(String(projectType || '').trim());
  }

  _syncFrequencyForProjectType(projectType, { emptyOnly = false } = {}) {
    const freqSel = this._root?.querySelector?.('#sbNewProjFrequency');
    if (!freqSel) return;
    const current = String(freqSel.value || '').trim();
    const shouldAutoOneOff = this._isAdHocProjectType(projectType);

    if (shouldAutoOneOff) {
      if (!current || !emptyOnly) {
        const hasOneOff = Array.from(freqSel.options || []).some((opt) => String(opt?.value || '').trim() === 'One-off');
        if (hasOneOff) {
          freqSel.value = 'One-off';
          this._autoFrequencyApplied = true;
        }
      }
      return;
    }

    if (this._autoFrequencyApplied && current === 'One-off') {
      freqSel.value = '';
    }
    this._autoFrequencyApplied = false;
  }

  _snapshotForm() {
    const freqSel = this._root?.querySelector?.('#sbNewProjFrequency');
    return {
      project_name: String(this._root?.querySelector?.('#sbNewProjName')?.value || '').trim(),
      customer: String(this.fixedCustomer || this._readValueFromLinkInput('Customer') || '').trim(),
      company: this._readValueFromLinkInput('Company'),
      custom_fiscal_year: this._readValueFromLinkInput('Fiscal Year'),
      custom_grants_fy_label: String(this._root?.querySelector?.('#sbNewProjGrantFy')?.value || '').trim(),
      project_type: this._readProjectType(),
      custom_project_frequency: String(freqSel?.value || '').trim(),
    };
  }

  _isDirty() {
    const initial = this._initialSnapshot || {};
    const current = this._snapshotForm();
    return Object.keys(current).some((key) => String(current[key] || '').trim() !== String(initial[key] || '').trim());
  }

  async _confirmDiscardIfDirty() {
    if (!this._isDirty()) return true;
    return await confirmDialog('You have unsaved project details. Discard them?');
  }

  async _loadSelectOptions() {
    const freqSel = this._root?.querySelector?.('#sbNewProjFrequency');
    if (!freqSel) return;
    const fallback = ['Yearly', 'Quarterly', 'Monthly', 'Fortnightly', 'One-off'];
    let safe = [];
    try {
      const opts = await DoctypeMetaService.getSelectOptions('Project', 'custom_project_frequency', { force: true });
      safe = (opts || []).filter(Boolean);
    } catch (e) {
      safe = [];
    }
    const list = safe.length ? safe : fallback;
    freqSel.innerHTML = [
      '<option value="">Select frequency...</option>',
      ...list.map((x) => {
        const v = String(x || '').trim();
        return `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`;
      })
    ].join('');
    const initial = String(this.initial.custom_project_frequency || this.initial.frequency || '').trim();
    const preferred = initial && list.includes(initial) ? initial : '';
    if (preferred) freqSel.value = preferred;
    else freqSel.value = '';
    this._syncFrequencyForProjectType(this._readProjectType(), { emptyOnly: true });
  }

  async _handleCreateClient() {
    if (!this.onCreateClient) return;
    const btn = this._root?.querySelector?.('#sbNewProjNewClient');
    if (btn) btn.disabled = true;
    try {
      const initialName = this._readDisplayTextFromLinkInput('Customer');
      await this.onCreateClient({
        initialName,
        onCreated: (item) => {
          const name = item?.name || item?.customer_name || item?.customer || null;
          if (name) this._setValueForLinkInput('Customer', name);
        }
      });
    } catch (e) {
      // Only show unexpected errors; validation is handled inside the New Client modal itself.
      const msg = getErrorMessage(e) || '';
      if (msg) this._setError(msg);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async _handleSubmit() {
    this._setError('');
    const required = new Set(Array.isArray(this.formConfig?.requiredFields) ? this.formConfig.requiredFields : []);
    const name = String(this._root?.querySelector?.('#sbNewProjName')?.value || '').trim();
    const customer = this.fixedCustomer || this._readValueFromLinkInput('Customer');
    const company = this._readValueFromLinkInput('Company');
    const custom_fiscal_year = this._readValueFromLinkInput('Fiscal Year');
    const custom_grants_fy_label = String(this._root?.querySelector?.('#sbNewProjGrantFy')?.value || '').trim();
    const project_type = this._readProjectType();
    const custom_project_frequency = String(this._root?.querySelector?.('#sbNewProjFrequency')?.value || '').trim();

    const missing = [];
    if (required.has('project_name') && !name) missing.push('Project Name');
    if (required.has('customer') && !customer) missing.push('Client');
    if (required.has('company') && !company) missing.push('Company');
    if (required.has('custom_fiscal_year') && !custom_fiscal_year) missing.push('Fiscal Year');
    if (required.has('project_type') && !project_type) missing.push('Project Type');
    if (required.has('custom_grants_fy_label') && !custom_grants_fy_label) missing.push('FY/CY');
    if (missing.length) {
      this._setError(`Please fill: ${missing.join(', ')}`);
      return;
    }

    const btn = this._modal?._overlay?.querySelector?.('#sbNewProjCreate');
    if (btn) btn.disabled = true;
    try {
      await this.onSubmit({
        project_name: name,
        customer,
        company,
        custom_fiscal_year,
        custom_grants_fy_label,
        project_type,
        custom_project_frequency: custom_project_frequency || this.formConfig?.defaultValues?.custom_project_frequency || '',
      });
      this.close();
    } catch (e) {
      const msg = getErrorMessage(e) || 'Create project failed';
      this._setError(msg);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
}


