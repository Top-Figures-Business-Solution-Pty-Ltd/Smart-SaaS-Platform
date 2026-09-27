import { AutomationHealthModal } from '../components/BoardView/AutomationHealthModal.js';
import { AutomationHealthService } from '../services/automationHealthService.js';
import { notify } from '../services/uiAdapter.js';

export async function openAutomationHealthFlow() {
  try {
    notify('Loading automation health...', 'blue');
    const health = await AutomationHealthService.getHealth({ lookbackHours: 24, recentLimit: 10 });
    new AutomationHealthModal({ health }).open();
  } catch (e) {
    notify(String(e?.message || 'Failed to load automation health.'), 'red');
  }
}
