import { executeServiceCommand, planServiceCommand, } from '../services/service-commands.js';
import { runOwnedProcess } from '../services/owned-process.js';
import { CliError } from './cli-error.js';
import { emitExit, localEnvironment, localPlan, localPort, requireLocalProfile, selectedProject, } from './operational-shared.js';
function portableInvocation(plan) {
    const sanitize = (args) => args.map((value, index) => args[index - 1] === '--project-directory' ? '<project>' : value);
    return {
        action: plan.action,
        command: 'docker',
        args: sanitize(plan.args),
        ...(plan.setupArgs ? { setupArgs: sanitize(plan.setupArgs) } : {}),
        ...(plan.readinessArgs
            ? { readinessArgs: sanitize(plan.readinessArgs) }
            : {}),
        noServices: plan.noServices,
        preservesVolumes: true,
    };
}
function serviceSummary(plan) {
    return {
        schemaVersion: 1,
        project: plan.project,
        environment: plan.environment,
        nodeEnvironment: plan.nodeEnvironment,
        topology: plan.topology,
        replicas: plan.replicas,
        services: plan.services.map((service) => ({
            id: service.id,
            kind: service.kind,
            execution: service.execution,
            resourceRef: service.resourceRef,
            ...(service.image ? { image: service.image } : {}),
            ports: service.ports,
            dependsOn: service.dependsOn,
            resources: service.resources,
            health: service.health,
            volumes: service.volumes,
            environment: service.environment.map((field) => ({
                key: field.key,
                required: field.required,
                secret: field.secret,
            })),
        })),
        volumes: plan.volumes,
        externalRequirements: plan.externalRequirements.map((item) => ({
            id: item.id,
            configured: !!item.resourceRef,
            environmentKeys: item.environmentKeys,
        })),
        jobs: plan.jobs,
        ingress: plan.ingress,
        pending: plan.pending,
    };
}
function localOptions(command) {
    return command
        .option('--environment <environment>', 'development or test', 'development')
        .option('--database-port <port>', 'Explicit selected local database port')
        .option('--cgroup-parent <parent>', 'Explicit host cgroup parent')
        .option('--dry-run', 'Preview without writes, processes or probes');
}
export function registerServicesCommands(program, context, execution, environment) {
    const services = program
        .command('services')
        .description('Plan or delegate selected local development/test services');
    for (const action of ['plan', 'up', 'down', 'status'])
        localOptions(services.command(action)).action(async (options) => {
            const operation = 'services.' + action;
            context.setOperation(operation);
            const selectedEnvironment = localEnvironment(options.environment), root = context.project();
            if (options.cgroupParent &&
                (!/^[a-zA-Z0-9][a-zA-Z0-9_.@/-]{0,127}$/.test(options.cgroupParent) ||
                    options.cgroupParent.split('/').includes('..')))
                throw new CliError('INVALID_CGROUP_PARENT', 'Choose one explicit supported host cgroup parent.');
            const state = await selectedProject(root), plan = localPlan(state.config, selectedEnvironment);
            requireLocalProfile(state.lock, selectedEnvironment);
            const args = {
                root,
                plan,
                environment: action === 'plan' || options.dryRun ? {} : environment(),
                ...(options.databasePort
                    ? { databasePort: localPort(options.databasePort) }
                    : {}),
                ...(options.cgroupParent
                    ? { cgroupParent: options.cgroupParent }
                    : {}),
                dryRun: action === 'plan' || !!options.dryRun,
            };
            const summary = {
                project: plan.project,
                environment: plan.environment,
                outcomes: state.outcomes,
            };
            if (action === 'plan') {
                context.emit({
                    schemaVersion: 1,
                    status: 'preview',
                    operation,
                    data: {
                        ...summary,
                        servicePlan: serviceSummary(plan),
                        invocation: portableInvocation(planServiceCommand('up', args)),
                    },
                });
                return;
            }
            let last;
            const runner = async (invocation) => {
                last = await (execution.serviceRunner ??
                    ((input) => runOwnedProcess(input, { capture: true })))(invocation);
                return last;
            };
            try {
                const result = await executeServiceCommand(action, args, runner);
                context.emit({
                    schemaVersion: 1,
                    status: result.status === 'planned' ? 'preview' : 'completed',
                    operation,
                    data: {
                        ...summary,
                        status: result.status,
                        invocation: portableInvocation(result.plan),
                        ...(result.services ? { services: result.services } : {}),
                    },
                });
            }
            catch (error) {
                if (last && last.code !== 0) {
                    emitExit(context, operation, summary, last, error);
                    return;
                }
                throw error;
            }
        });
}
//# sourceMappingURL=services-commands.js.map