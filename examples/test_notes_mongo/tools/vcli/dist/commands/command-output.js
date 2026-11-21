import { CommanderError } from 'commander';
import { BoundedFailure } from '../contracts.js';
import { EngineError } from '../engine/engine-error.js';
import { MaintenanceError } from '../maintenance/maintenance-error.js';
import { CliError } from './cli-error.js';
import { DeploymentOperatorError } from '../deployment/operators/deployment-operator-error.js';
import { asRecord, formatTextData } from './text-formatters.js';
/** Text mode names the outcome and key summary lines. JSON stays the full envelope. */
export function writeResult(result, json, verbose = false) {
    if (json) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return;
    }
    const lines = [`${result.operation}: ${result.status}`];
    if (verbose && result.data !== undefined)
        lines.push(JSON.stringify(result.data, null, 2));
    else if (result.data !== undefined)
        lines.push(...formatTextData(result.operation, result.data));
    process.stdout.write(`${lines.join('\n')}\n`);
    for (const error of result.errors ?? []) {
        process.stderr.write(`${error.code}: ${error.action}\n`);
        if (typeof error.rerun === 'string')
            process.stderr.write(`next: ${error.rerun}\n`);
        if (Array.isArray(error.diagnostics))
            for (const item of error.diagnostics.slice(0, 20)) {
                const diagnostic = asRecord(item);
                if (!diagnostic || typeof diagnostic.path !== 'string')
                    continue;
                const line = typeof diagnostic.line === 'number' ? `:${diagnostic.line}` : '';
                process.stderr.write(`${diagnostic.path}${line} ${String(diagnostic.code ?? '')}\n`);
            }
    }
}
/** Raw parser/provider/process errors can contain private input; expose fixed facts. */
export function publicError(error) {
    if (error instanceof BoundedFailure)
        return error.toJSON();
    if (error instanceof EngineError)
        return error.toJSON();
    if (error instanceof MaintenanceError)
        return error.toJSON();
    if (error instanceof DeploymentOperatorError)
        return {
            code: error.code,
            stage: 'deployment',
            action: 'Inspect the private operation journal and current target state; explicitly reconcile unknown outcomes before retrying.',
        };
    if (error instanceof CliError)
        return { code: error.code, action: error.action };
    if (error instanceof Error &&
        error.message === 'PRIVATE_ENV_FILE_UNAVAILABLE')
        return {
            code: error.message,
            action: 'Create the private config file from the selected example and restrict it to the owner. A dry run does not read it.',
        };
    if (error instanceof Error && error.message === 'UNSAFE_PRIVATE_ENV_FILE')
        return {
            code: error.message,
            action: 'Use an absolute owner-only regular file with mode 0600 for --config-file.',
        };
    if (error instanceof CommanderError)
        return {
            code: 'INVALID_COMMAND',
            action: 'Use --help to review the command and required options.',
        };
    if (error instanceof Error && /^[A-Z][A-Z_]{2,90}$/.test(error.message))
        return {
            code: error.message,
            action: 'Review the selected recipe options and supported profiles.',
        };
    return {
        code: 'COMMAND_FAILED',
        action: 'Review project state with inspect/doctor and retry the named operation.',
    };
}
//# sourceMappingURL=command-output.js.map