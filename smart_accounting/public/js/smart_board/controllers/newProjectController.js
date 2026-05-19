/**
 * newProjectController
 * - Orchestrates the New Project modal for website shell (/smart).
 * - Keeps SmartBoardApp and services clean by centralizing workflow here.
 */
import { NewProjectModal } from '../components/BoardView/NewProjectModal.js';
import { ProjectCreateService } from '../services/projectCreateService.js';
import { openNewClientFlow } from './newClientController.js';
import { notify } from '../services/uiAdapter.js';
import { isDesk } from '../utils/env.js';
import { BoardStatusService } from '../services/boardStatusService.js';
import { getNewProjectModalConfig } from '../utils/moduleConfig.js';

function isAdHocProjectType(value) {
  return /\bad[\s-]?hoc\b/i.test(String(value || '').trim());
}

export async function openNewProjectFlow({ app, viewType } = {}) {
  // Desk keeps the existing behavior (open ERPNext form).
  if (isDesk()) {
    // Caller should use navigationService.createProject in Desk
    return null;
  }

  const currentView = String(viewType || app?.currentView || '').trim();
  const moduleKey = app?.moduleKey || 'accounting';
  const store = app?.store || null;
  const stateFilters = store?.getState?.()?.filters || {};
  const fixedCustomer = (currentView === 'client-projects')
    ? String(stateFilters?.customer || '').trim()
    : '';

  if (currentView === 'client-projects' && !fixedCustomer) {
    notify('No client selected. Please open a client first.', 'orange');
    return null;
  }

  const formConfig = getNewProjectModalConfig({ moduleKey, currentView });
  const defaultValues = { ...(formConfig?.defaultValues || {}) };
  const defaultProjectType = defaultValues.project_type || ((currentView === 'client-projects') ? '' : currentView);
  const isAdHoc = isAdHocProjectType(defaultProjectType);

  if (!defaultValues.custom_fiscal_year) {
    defaultValues.custom_fiscal_year = await ProjectCreateService.getCurrentFiscalYear();
  }
  if (!defaultValues.company && (formConfig?.visibleFields?.company !== false) && isAdHoc) {
    defaultValues.company = await ProjectCreateService.getDefaultCompany();
  }
  if (!defaultValues.customer && !fixedCustomer && isAdHoc) {
    defaultValues.customer = await ProjectCreateService.getOrCreateAdHocCustomer();
  }

  const modal = new NewProjectModal({
    title: 'New Project',
    initial: {
      project_type: defaultValues.project_type || ((currentView === 'client-projects') ? null : (currentView || null)),
      // If user has an active fiscal_year filter, reuse it for creation.
      fiscal_year: defaultValues.custom_fiscal_year || stateFilters?.fiscal_year || null,
      company: defaultValues.company || null,
      custom_project_frequency: defaultValues.custom_project_frequency || null,
      customer: fixedCustomer || defaultValues.customer || null,
      custom_grants_fy_label: defaultValues.custom_grants_fy_label || null,
    },
    fixedCustomer: fixedCustomer || null,
    lockCustomer: currentView === 'client-projects',
    formConfig,
    onCreateClient: async ({ initialName, onCreated } = {}) => {
      if (currentView === 'client-projects') return;
      await openNewClientFlow({
        app,
        initial: { customer_name: initialName || '' },
        onCreated,
      });
    },
    onSubmit: async (payload) => {
      // Ensure status is always valid under the global status pool.
      // Some sites still default Project.status to "Open" which will fail validation once the pool changes.
      let status = String(payload?.status || '').trim();
      if (!status) {
        try {
          const opts = await BoardStatusService.getEffectiveOptions({
            projectType: payload?.project_type,
            currentValue: '',
          });
          status = String((opts && opts[0]) || '').trim() || 'Not started';
        } catch (e) {
          status = 'Not started';
        }
      }

      const finalPayload = {
        ...defaultValues,
        ...payload,
        status,
      };
      const doc = await ProjectCreateService.createProject(finalPayload, {
        requiredFields: formConfig?.requiredFields,
      });
      notify('Project created', 'green');
      if (currentView === 'client-projects') {
        // Keep client scope and refresh cross-project-type list.
        await app?.loadViewData?.('client-projects');
      } else {
        // Refresh current board list so newly created row appears and columns/hydration are consistent.
        const last = store?.getState?.()?.projects?.lastFilters || null;
        const base = { ...(last || {}), project_type: finalPayload.project_type };
        try {
          await store?.dispatch?.('projects/fetchProjects', base);
        } catch (e) {
          // fallback: optimistic insert if fetch fails
          if (doc?.name) store?.commit?.('projects/addProject', doc);
        }
      }
      return doc;
    },
  });

  await modal.open();
  return modal;
}


