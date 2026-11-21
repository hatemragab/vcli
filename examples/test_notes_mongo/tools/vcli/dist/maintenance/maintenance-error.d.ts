export type MaintenanceErrorCode = 'UNSUPPORTED_BASELINE' | 'UNSUPPORTED_RELEASE' | 'UNSUPPORTED_MIGRATION' | 'TARGET_ASSET_MISMATCH' | 'MAINTENANCE_STATE_INVALID';
export declare class MaintenanceError extends Error {
    readonly code: MaintenanceErrorCode;
    readonly action: string;
    readonly stage = "maintenance";
    constructor(code: MaintenanceErrorCode, action: string);
    toJSON(): {
        code: MaintenanceErrorCode;
        stage: string;
        action: string;
    };
}
