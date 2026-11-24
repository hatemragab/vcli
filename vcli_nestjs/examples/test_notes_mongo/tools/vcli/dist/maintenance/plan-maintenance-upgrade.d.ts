import type { MaintenancePlan, MaintenanceSummary, MaintenanceUpgradeOptions } from './types.js';
export declare function planMaintenanceUpgrade(options: MaintenanceUpgradeOptions): Promise<MaintenancePlan>;
export declare function summarizeMaintenancePlan(result: MaintenancePlan): MaintenanceSummary;
