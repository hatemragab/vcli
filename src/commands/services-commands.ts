import type { Command } from 'commander';
import type { ServicePlan } from '../recipes/service-plan-types.js';
import {
  executeServiceCommand,
  planServiceCommand,
} from '../services/service-commands.js';
import { runOwnedProcess } from '../services/owned-process.js';
import type {
  ServiceRunner,
  CommandResult as ProcessResult,
  ServiceCommandPlan,
} from '../services/service-types.js';
import { CliError } from './cli-error.js';
import {
  emitExit,
  localEnvironment,
  localPlan,
  localPort,
  requireLocalProfile,
  selectedProject,
  type OperationalCommandContext,
  type OperationalExecution,
} from './operational-shared.js';

interface LocalOptions {
  environment: string;
  dryRun?: boolean;
  databasePort?: string;
  cgroupParent?: string;
}

function portableInvocation(plan: ServiceCommandPlan): Record<string, unknown> {
  const sanitize = (args: readonly string[]) =>
    args.map((value, index) =>
      args[index - 1] === '--project-directory' ? '<project>' : value,
    );
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

function serviceSummary(plan: ServicePlan): Record<string, unknown> {
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

function localOptions(command: Command): Command {
  return command
    .option('--environment <environment>', 'development or test', 'development')
    .option('--database-port <port>', 'Explicit selected local database port')
    .option('--cgroup-parent <parent>', 'Explicit host cgroup parent')
    .option('--dry-run', 'Preview without writes, processes or probes');
}

export function registerServicesCommands(
  program: Command,
  context: OperationalCommandContext,
  execution: OperationalExecution,
  environment: () => NodeJS.ProcessEnv,
): void {
  const services = program
    .command('services')
    .description('Plan or delegate selected local development/test services');
  for (const action of ['plan', 'up', 'down', 'status'] as const)
    localOptions(services.command(action)).action(
      async (options: LocalOptions) => {
        const operation = 'services.' + action;
        context.setOperation(operation);
        const selectedEnvironment = localEnvironment(options.environment),
          root = context.project();
        if (
          options.cgroupParent &&
          (!/^[a-zA-Z0-9][a-zA-Z0-9_.@/-]{0,127}$/.test(options.cgroupParent) ||
            options.cgroupParent.split('/').includes('..'))
        )
          throw new CliError(
            'INVALID_CGROUP_PARENT',
            'Choose one explicit supported host cgroup parent.',
          );
        const state = await selectedProject(root),
          plan = localPlan(state.config, selectedEnvironment);
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
        let last: ProcessResult | undefined;
        const runner: ServiceRunner = async (invocation) => {
          last = await (
            execution.serviceRunner ??
            ((input) => runOwnedProcess(input, { capture: true }))
          )(invocation);
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
        } catch (error) {
          if (last && last.code !== 0) {
            emitExit(context, operation, summary, last, error);
            return;
          }
          throw error;
        }
      },
    );
}
