export type MaintenanceErrorCode =
  | 'UNSUPPORTED_BASELINE'
  | 'UNSUPPORTED_RELEASE'
  | 'UNSUPPORTED_MIGRATION'
  | 'TARGET_ASSET_MISMATCH'
  | 'MAINTENANCE_STATE_INVALID';
export class MaintenanceError extends Error {
  readonly stage = 'maintenance';
  constructor(
    readonly code: MaintenanceErrorCode,
    readonly action: string,
  ) {
    super(`${code}: ${action}`);
    this.name = 'MaintenanceError';
  }
  toJSON(): { code: MaintenanceErrorCode; stage: string; action: string } {
    return { code: this.code, stage: this.stage, action: this.action };
  }
}
