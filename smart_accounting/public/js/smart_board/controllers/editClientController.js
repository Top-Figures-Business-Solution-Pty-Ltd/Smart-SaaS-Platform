/**
 * editClientController
 * - Orchestrates Edit Client modal for /smart shell.
 */
import { EditClientModal } from '../components/ClientsView/EditClientModal.js';
import { ClientUpdateService } from '../services/clientUpdateService.js';
import { notify } from '../services/uiAdapter.js';
import { isDesk } from '../utils/env.js';

export async function openEditClientFlow({ app, client, onUpdated } = {}) {
  if (!client || !client?.name) return null;

  // Desk: keep native ERPNext behavior (open form)
  if (isDesk()) {
    try { frappe?.set_route?.('Form', 'Customer', client?.name); } catch (e) {}
    return null;
  }

  const store = app?.store || null;
  const primary = client?.primary_entity || {};
  const initial = {
    name: client?.name,
    customer_name: client?.customer_name || client?.name,
    entity_type: primary?.entity_type || '',
    year_end: primary?.year_end || '',
    custom_partner: client?.custom_partner || '',
  };

  const modal = new EditClientModal({
    title: 'Edit Client',
    initial,
    onSubmit: async (payload) => {
      const item = await ClientUpdateService.updateClient(payload);
      notify('Client updated', 'green');
      try { onUpdated?.(item); } catch (e) {}
      // Merge into current list (avoid full reload)
      try {
        store?.commit?.('clients/updateClient', { name: client?.name, data: item });
      } catch (e) {}
      return item;
    },
  });

  await modal.open();
  return modal;
}


