/** A fixed code plus nonsecret progress; raw provider/file/network failures are never exposed. */
export class DeploymentOperatorError extends Error {
    code;
    summary;
    constructor(code, summary) {
        super(code);
        this.code = code;
        this.summary = summary;
        this.name = 'DeploymentOperatorError';
    }
}
//# sourceMappingURL=deployment-operator-error.js.map