/**
 * Header Action Handler
 * Keeps app.js small by moving action switch to a dedicated module.
 */

import { msgprint } from '../services/uiAdapter.js';
import { openNewClientFlow } from './newClientController.js';
import { openBoardSettingsFlow } from './boardSettingsController.js';
import { openAutomationFlow } from './automationController.js';

export async function handleHeaderAction(app, action, data) {
  switch (action) {
    case 'new_project':
      return app?.createNewProject?.();
    case 'filter':
      return app?.applyFilters?.(data);
    case 'search':
      return app?.performSearch?.(data);
    case 'manage_columns':
      return app?.showColumnManager?.();
    case 'sort':
      return app?.showSortDialog?.();
    case 'automation':
      return openAutomationFlow({ moduleKey: app?.moduleKey || app?.module || '' });
    case 'export_projects_csv':
      return app?.exportCurrentProjectsCSV?.();
    case 'export_clients_csv':
      return app?.exportCurrentClientsCSV?.();
    case 'board_settings':
      return openBoardSettingsFlow({ app });
    case 'new_client':
      return openNewClientFlow({ app });
    case 'clients_search':
      return app?.setClientsSearch?.(data);
    case 'clients_columns':
      return app?.showClientsColumnManager?.();
    case 'dashboard_refresh':
      return app?.loadViewData?.('dashboard');
    case 'client_projects_back':
      return app?.goBackToClients?.();
    case 'client_projects_new_project':
      return app?.createNewProject?.();
    case 'client_projects_search':
      return app?.performSearch?.(data);
    case 'status_projects_back':
      return app?.goBackToDashboard?.();
    case 'status_projects_search':
      return app?.performSearch?.(data);
    default:
      console.warn('Unknown action:', action, data);
  }
}


