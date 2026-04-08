/**
 * Dashboard state module
 * - My Projects list (related via team roles)
 */
import { ProjectService } from '../../services/projectService.js';

export const DashboardModule = {
  state() {
    return {
      loading: false,
      myProjects: [],
      error: null,
      lastUpdatedAt: null,
      totalCount: 0,
      statusCounts: {},
      pageSize: 50,
    };
  },

  actions: {
    async fetchMyProjects(state, payload, store) {
      const append = !!payload?.append;
      store.commit('dashboard/setLoading', true);
      store.commit('dashboard/setError', null);
      try {
        const currentItems = Array.isArray(state?.myProjects) ? state.myProjects : [];
        const limit = Math.max(1, Number(state?.pageSize) || 50);
        const limitStart = append ? currentItems.length : 0;
        const res = await ProjectService.getMyProjectsWithRoles({ limitStart, limit });
        const rows = Array.isArray(res?.projects) ? res.projects : [];
        store.commit('dashboard/setMyProjects', append ? currentItems.concat(rows) : rows);
        store.commit('dashboard/setTotalCount', Number(res?.meta?.total_count || rows.length || 0));
        store.commit('dashboard/setStatusCounts', res?.meta?.status_counts || {});
        store.commit('dashboard/setLastUpdatedAt', Date.now());
      } catch (e) {
        store.commit('dashboard/setError', String(e?.message || e));
      } finally {
        store.commit('dashboard/setLoading', false);
      }
    }
  },

  mutations: {
    setLoading(state, v) {
      state.loading = !!v;
    },
    setMyProjects(state, rows) {
      state.myProjects = Array.isArray(rows) ? rows : [];
    },
    setTotalCount(state, count) {
      state.totalCount = Math.max(0, Number(count) || 0);
    },
    setStatusCounts(state, counts) {
      state.statusCounts = counts && typeof counts === 'object' ? { ...counts } : {};
    },
    setError(state, msg) {
      state.error = msg || null;
    },
    setLastUpdatedAt(state, ts) {
      state.lastUpdatedAt = ts || null;
    }
  }
};


