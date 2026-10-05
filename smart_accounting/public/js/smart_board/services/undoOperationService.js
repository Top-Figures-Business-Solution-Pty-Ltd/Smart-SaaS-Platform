import { notify, notifyUndoable } from './uiAdapter.js';
import { getErrorMessage } from '../utils/errorMessage.js';

const DEFAULT_UNDO_MS = 10000;

function _countLabel(count, singular, plural = `${singular}s`) {
  const n = Number(count || 0);
  return `${n} ${n === 1 ? singular : plural}`;
}

function _summarizeBatchUndo(resp = {}) {
  const undone = Number(resp?.undone_count || 0);
  const skipped = Number(resp?.skipped_count || 0);
  const failed = Number(resp?.failed_count || 0);
  if (undone && !skipped && !failed) return `Undid ${_countLabel(undone, 'change')}`;
  if (undone) return `Undid ${undone} change${undone === 1 ? '' : 's'}; skipped ${skipped + failed}`;
  return 'Nothing was undone';
}

export class UndoOperationService {
  static async undoProjectActivityBatch(batchId) {
    const bid = String(batchId || '').trim();
    if (!bid) throw new Error('Missing undo batch');
    const r = await frappe.call({
      method: 'smart_accounting.api.activity_log.undo_project_activity_batch',
      type: 'POST',
      args: { batch_id: bid },
    });
    return r?.message || {};
  }

  static showBatchUndo({ message, batchId, onAfterUndo, durationMs = DEFAULT_UNDO_MS } = {}) {
    const bid = String(batchId || '').trim();
    if (!bid) {
      notify(message || 'Updated successfully', 'green');
      return null;
    }
    return notifyUndoable({
      message: message || 'Updated successfully',
      durationMs,
      onUndo: async () => {
        try {
          const resp = await this.undoProjectActivityBatch(bid);
          notify(_summarizeBatchUndo(resp), resp?.failed_count ? 'orange' : 'green');
          if (typeof onAfterUndo === 'function') await onAfterUndo(resp);
        } catch (e) {
          notify(getErrorMessage(e) || 'Undo failed', 'red');
        }
      },
    });
  }

  static showManualUndo({ message, onUndo, onAfterUndo, durationMs = DEFAULT_UNDO_MS } = {}) {
    return notifyUndoable({
      message: message || 'Updated successfully',
      durationMs,
      onUndo: async () => {
        try {
          if (typeof onUndo === 'function') await onUndo();
          notify('Undone', 'green');
          if (typeof onAfterUndo === 'function') await onAfterUndo();
        } catch (e) {
          notify(getErrorMessage(e) || 'Undo failed', 'red');
        }
      },
    });
  }

  static scheduleDelayedDelete({
    message,
    onCommit,
    onUndo,
    onCommitSuccess,
    onCommitError,
    durationMs = DEFAULT_UNDO_MS,
  } = {}) {
    let cancelled = false;
    let committed = false;
    let timerId = null;

    const commit = async () => {
      if (cancelled || committed) return;
      committed = true;
      try {
        if (typeof onCommit === 'function') await onCommit();
        if (typeof onCommitSuccess === 'function') await onCommitSuccess();
      } catch (e) {
        notify(getErrorMessage(e) || 'Delete failed', 'red');
        if (typeof onCommitError === 'function') await onCommitError(e);
      }
    };

    timerId = setTimeout(commit, durationMs);

    notifyUndoable({
      message: message || 'Delete scheduled',
      durationMs,
      onUndo: async () => {
        if (committed) {
          notify('Delete already completed', 'orange');
          return;
        }
        cancelled = true;
        if (timerId) clearTimeout(timerId);
        if (typeof onUndo === 'function') await onUndo();
        notify('Delete cancelled', 'green');
      },
    });

    return {
      cancel() {
        cancelled = true;
        if (timerId) clearTimeout(timerId);
      },
      commit,
    };
  }
}
