export class MaintenanceError extends Error {
    code;
    action;
    stage = 'maintenance';
    constructor(code, action) {
        super(`${code}: ${action}`);
        this.code = code;
        this.action = action;
        this.name = 'MaintenanceError';
    }
    toJSON() {
        return { code: this.code, stage: this.stage, action: this.action };
    }
}
//# sourceMappingURL=maintenance-error.js.map