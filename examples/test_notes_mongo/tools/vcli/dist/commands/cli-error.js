export class CliError extends Error {
    code;
    action;
    constructor(code, action) {
        super(code);
        this.code = code;
        this.action = action;
        this.name = 'CliError';
    }
}
//# sourceMappingURL=cli-error.js.map