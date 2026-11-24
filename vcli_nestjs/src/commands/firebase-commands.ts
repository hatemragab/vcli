import { confirm, input, select } from '@inquirer/prompts';
import type { Command } from 'commander';
import type { ProjectConfig } from '../contracts.js';
import { developmentEnvFile } from '../engine/development-environment.js';
import { withProjectLock } from '../engine/operation-storage.js';
import { selection } from '../recipes/selection.js';
import { CliError } from './cli-error.js';
import type { CliRuntime } from './command-context.js';
import { publicError } from './command-output.js';
import {
  createFirebaseProject,
  listFirebaseProjects,
  loginFirebase,
} from './firebase-cli.js';
import {
  prepareFirebaseEnvironment,
  type FirebaseSetupTarget,
} from './firebase-setup-environment.js';
import { selectedProject } from './operational-shared.js';

interface SetupOptions {
  existing?: string;
  create?: string;
  for?: string;
  adc?: boolean;
  dryRun?: boolean;
}

const operation = 'firebase.setup';
const newProjectId = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const existingProjectId = /^[a-z0-9][a-z0-9.:-]{0,127}$/;
const projectIdHelp =
  'Use a project ID of 6 to 30 lowercase letters, digits or hyphens. Start with a letter and end with a letter or digit.';

function setupTarget(
  config: ProjectConfig,
  requested?: string,
): FirebaseSetupTarget {
  const auth = selection(config, 'auth') === 'auth.firebase';
  const fcm = selection(config, 'push-fcm') === 'push.fcm';
  const targets: FirebaseSetupTarget[] = [];
  if (auth) targets.push('auth');
  if (fcm) targets.push('fcm');
  if (auth && fcm) targets.push('both');
  const target = requested ?? targets.at(-1);
  const match = targets.find((item) => item === target);
  if (!match)
    throw new CliError(
      'FIREBASE_SETUP_CAPABILITY_REQUIRED',
      targets.length
        ? `Use --for with a selected capability (${targets.join(', ')}).`
        : 'Select Firebase Auth or FCM in the generated project before running Firebase setup.',
    );
  return match;
}

async function chooseIntent(options: SetupOptions, interactive: boolean) {
  if (options.existing !== undefined && options.create !== undefined)
    throw new CliError(
      'FIREBASE_SETUP_OPTIONS_CONFLICT',
      'Choose either --existing or --create.',
    );
  if (options.existing !== undefined) {
    if (!existingProjectId.test(options.existing))
      throw new CliError(
        'INVALID_FIREBASE_PROJECT_ID',
        'Use the project ID shown by firebase projects:list.',
      );
    return { mode: 'existing' as const, projectId: options.existing };
  }
  if (options.create !== undefined) {
    if (!newProjectId.test(options.create))
      throw new CliError('INVALID_FIREBASE_PROJECT_ID', projectIdHelp);
    return { mode: 'create' as const, projectId: options.create };
  }
  if (options.dryRun) return { mode: 'choose' as const };
  if (!interactive)
    throw new CliError(
      'FIREBASE_SETUP_PROJECT_REQUIRED',
      'Supply --existing <project-id> or --create <project-id> for non-interactive setup.',
    );
  const mode = await select({
    message: 'Firebase project',
    choices: [
      { name: 'Link an existing project', value: 'existing' as const },
      { name: 'Create a new project', value: 'create' as const },
    ],
  });
  if (mode === 'existing') return { mode };
  const projectId = await input({
    message: 'New Firebase project ID',
    validate: (value) => newProjectId.test(value) || projectIdHelp,
  });
  const approved = await confirm({
    message: `Create Firebase project ${projectId}?`,
    default: false,
  });
  return approved ? { mode, projectId } : { mode: 'cancelled' as const };
}

async function discoverProjects(root: string, interactive: boolean) {
  try {
    return await listFirebaseProjects(root);
  } catch (error: unknown) {
    if (
      !interactive ||
      !(error instanceof CliError) ||
      error.code !== 'FIREBASE_LOGIN_REQUIRED'
    )
      throw error;
    await loginFirebase(root);
    return listFirebaseProjects(root);
  }
}

export function registerFirebaseCommands(
  program: Command,
  runtime: CliRuntime,
): void {
  program
    .command('firebase')
    .description('Connect generated Firebase Auth or FCM to a project')
    .command('setup')
    .description('Link an existing Firebase project or create one')
    .option('--existing <project-id>', 'Link an accessible Firebase project')
    .option('--create <project-id>', 'Create and link a Firebase project')
    .option('--for <target>', 'Configure auth, fcm or both')
    .option(
      '--adc',
      'Use Application Default Credentials without setting a key path',
    )
    .option(
      '--dry-run',
      'Preview settings without reading credentials or contacting Firebase',
    )
    .action(async (options: SetupOptions) => {
      runtime.setOperation(operation);
      const root = runtime.project();
      const { config } = await selectedProject(root);
      const target = setupTarget(config, options.for);
      const intent = await chooseIntent(options, runtime.interactive);
      const keys: string[] = [];
      if (target !== 'fcm') {
        keys.push('FIREBASE_PROJECT_ID');
        if (!options.adc) keys.push('GOOGLE_APPLICATION_CREDENTIALS');
      }
      if (target !== 'auth') {
        keys.push('FCM_PROJECT_ID');
        if (!options.adc) keys.push('FCM_CREDENTIALS_PATH');
      }
      const data = {
        target,
        mode: intent.mode,
        projectId: intent.projectId,
        configFile: developmentEnvFile,
        keys,
        requiredSignInMethods:
          target === 'fcm'
            ? []
            : (config.capabilities.auth?.options.methods ?? []),
      };
      const result = { schemaVersion: 1, operation } as const;
      if (options.dryRun || intent.mode === 'cancelled') {
        runtime.emit({
          ...result,
          status: options.dryRun ? 'preview' : 'completed',
          data,
        });
        return;
      }

      const output = await withProjectLock(root, async () => {
        const current = await selectedProject(root);
        setupTarget(current.config, target);
        const environment = await prepareFirebaseEnvironment(root, target, {
          projectId: intent.projectId,
          adc: options.adc,
          allowMissingCredential: intent.mode === 'create',
        });
        const projects = await discoverProjects(root, runtime.interactive);
        const localProjectId =
          environment.linkedProjectId ?? environment.credentialProjectId;
        const candidates = projects.filter(
          ({ projectId }) =>
            existingProjectId.test(projectId) &&
            (!localProjectId || projectId === localProjectId),
        );
        const projectId =
          intent.projectId ??
          (candidates.length
            ? await select({
                message: 'Select an existing Firebase project',
                choices: candidates.map(({ projectId, displayName }) => ({
                  name:
                    displayName && displayName !== projectId
                      ? `${displayName} (${projectId})`
                      : projectId,
                  value: projectId,
                })),
              })
            : undefined);
        const found = projects.some(
          (project) => project.projectId === projectId,
        );
        if (!projectId || (intent.mode === 'existing' && !found))
          throw new CliError(
            'FIREBASE_PROJECT_NOT_ACCESSIBLE',
            'Choose an accessible Firebase project that matches the local settings. Check the Firebase CLI account with firebase projects:list.',
          );
        const projectAction =
          intent.mode === 'existing' ? 'linked' : found ? 'reused' : 'created';
        if (projectAction === 'created')
          await createFirebaseProject(root, projectId);
        const applied = { ...data, projectId, projectAction };
        try {
          await environment.apply(projectId);
        } catch (error: unknown) {
          return {
            ...result,
            status: 'failed' as const,
            data: {
              ...applied,
              projectAction:
                projectAction === 'linked' ? undefined : projectAction,
            },
            errors: [publicError(error)],
          };
        }
        const pending = environment.credentialPending;
        return {
          ...result,
          status: pending ? ('pending' as const) : ('completed' as const),
          data: {
            ...applied,
            credential: options.adc
              ? 'existing'
              : pending
                ? 'pending'
                : 'firebase-admin.json',
            next: pending
              ? `Save the Admin SDK service-account JSON as firebase-admin.json in the app root, then rerun npm exec -- vcli firebase setup --existing ${projectId} --for ${target}.`
              : 'Run npm exec -- vcli config check --config-file .env.development to check local configuration.',
          },
        };
      });
      runtime.emit(output);
    });
}
