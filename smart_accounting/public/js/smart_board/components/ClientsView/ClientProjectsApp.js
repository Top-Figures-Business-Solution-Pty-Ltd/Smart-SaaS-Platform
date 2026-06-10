/**
 * ClientProjectsApp
 * - Read-only aggregated Projects list for a single customer (cross project_type)
 * - Intentionally minimal UI: Client / Project Type / Project Name / Status + "Open Board"
 */
import { ClientProjectsTable } from './ClientProjectsTable.js';

export class ClientProjectsApp {
  constructor(container, { store, onOpenBoard } = {}) {
    this.container = container;
    this.store = store;
    this.onOpenBoard = onOpenBoard || (() => {});
    this._unsub = null;
    this._table = null;
  }

  init() {
    this.container.innerHTML = `<div id="sbClientProjectsTable"></div>`;
    const mount = this.container.querySelector('#sbClientProjectsTable');
    this._table = new ClientProjectsTable(mount, {
      onOpenBoard: (p) => this.onOpenBoard(p),
      onLoadMore: async () => {
        try { await this.store?.dispatch?.('projects/fetchMoreProjects'); } catch (e) {}
      },
      // Quick inline status change (Home status page). Reuses the same store path
      // as the board so automation side-effects are reflected immediately.
      onChangeStatus: async (project, value) => {
        const name = String(project?.name || '').trim();
        if (!name) return;
        await this.store?.dispatch?.('projects/updateProjectField', { name, field: 'status', value });
      },
    });

    this._unsub = this.store?.subscribe?.(() => this.render());
    this.render();
  }

  render() {
    const state = this.store?.getState?.() || {};
    const projects = state.projects || {};
    this._table?.render?.({
      items: projects.items || [],
      loading: !!projects.loading,
      loadingMore: !!projects.loadingMore,
      error: projects.error || null,
      totalCount: Number(projects.totalCount) || 0,
      hasMore: !!projects.hasMore,
    });
  }

  destroy() {
    try { this._unsub?.(); } catch (e) {}
    this._unsub = null;
    try { this._table?.destroy?.(); } catch (e) {}
    this._table = null;
    this.container.innerHTML = '';
  }
}


