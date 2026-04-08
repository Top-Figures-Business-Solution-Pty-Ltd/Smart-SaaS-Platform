/**
 * Smart Board - Project Service
 * Project相关API调用
 */

import { ProjectQueryService } from './projectQueryService.js';
import { ProjectCommandService } from './projectCommandService.js';
import { MonthlyStatusService } from './monthlyStatusService.js';

export class ProjectService {
    // Query
    static async fetchProjects(filters = {}) { return await ProjectQueryService.fetchProjects(filters); }
    static async getProject(name) { return await ProjectQueryService.getProject(name); }
    static async getTaskCounts(projects) { return await ProjectQueryService.getTaskCounts(projects); }
    static async getTasksForProjects(projects, fields = [], limitPerProject = 200) {
        return await ProjectQueryService.getTasksForProjects(projects, fields, limitPerProject);
    }
    static async getBoardFiscalStartMonth(projects) { return await ProjectQueryService.getBoardFiscalStartMonth(projects); }
    static async getMyProjectsWithRoles(opts = {}) { return await ProjectQueryService.getMyProjectsWithRoles(opts); }
    static async getStats(projectType) { return await ProjectQueryService.getStats(projectType); }

    // Commands
    static async updateProject(name, data) { return await ProjectCommandService.updateProject(name, data); }
    static async updateTask(name, data) { return await ProjectCommandService.updateTask(name, data); }
    static async deleteProject(name) { return await ProjectCommandService.deleteProject(name); }
    static async bulkSetProjectField(projects, field, value) {
        return await ProjectCommandService.bulkSetProjectField(projects, field, value);
    }
    static async createTask(project, data = {}) { return await ProjectCommandService.createTask(project, data); }
    static async setTaskTeamMembers(task, members = [], role = 'Assigned Person') {
        return await ProjectCommandService.setTaskTeamMembers(task, members, role);
    }

    // Monthly Status
    static async getMonthlyStatusBundle(projects, opts = {}) { return await MonthlyStatusService.getMonthlyStatusBundle(projects, opts); }
    static async setMonthlyStatus(args = {}) { return await MonthlyStatusService.setMonthlyStatus(args); }

    // Filters (kept for backward compatibility; used by internal query paths)
    static buildFilters(filters) { return ProjectQueryService.buildFilters(filters); }
    static buildOrFilters(filters) { return ProjectQueryService.buildOrFilters(filters); }
}

