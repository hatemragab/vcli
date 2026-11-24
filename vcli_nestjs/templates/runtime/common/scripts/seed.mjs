function fail(code, action) {
  console.error(`${code}: ${action}`);
  process.exitCode = 1;
}

async function loadBuild(path) {
  try {
    return await import(path);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      fail(
        'SEED_BUILD_REQUIRED',
        'Install project dependencies and run npm run build, then retry.',
      );
    } else {
      fail(
        'SEED_BUILD_UNAVAILABLE',
        'Check the generated seed registry and run npm run build, then retry.',
      );
    }
    return null;
  }
}

const allowed = (value) => value === 'development' || value === 'test';
const environmentAction =
  'Set NODE_ENV to development or test (use ENVIRONMENT with make seed). Choose a development/test config file.';

async function seed() {
  const makeEnvironment = process.env.VCLI_SEED_MAKE_ENVIRONMENT;
  const exported = process.env.NODE_ENV;
  if (
    (makeEnvironment !== undefined && !allowed(makeEnvironment)) ||
    (exported !== undefined && !allowed(exported))
  ) {
    return fail('SEED_ENVIRONMENT_REQUIRED', environmentAction);
  }

  const config = await loadBuild('../dist/core/config/load-config.js');
  if (!config) return;
  let fileEnvironment;
  try {
    fileEnvironment = config.loadSelectedEnvFile();
  } catch {
    return fail(
      'ENV_FILE_UNAVAILABLE',
      'Set APP_ENV_FILE or make CONFIG_FILE to a readable development/test config file.',
    );
  }
  const environment = process.env.NODE_ENV ?? makeEnvironment;
  if (
    !allowed(environment) ||
    (fileEnvironment !== undefined && !allowed(fileEnvironment))
  )
    return fail('SEED_ENVIRONMENT_REQUIRED', environmentAction);
  if (
    (makeEnvironment !== undefined && environment !== makeEnvironment) ||
    (fileEnvironment !== undefined && environment !== fileEnvironment)
  ) {
    return fail(
      'SEED_ENVIRONMENT_MISMATCH',
      "Match the shell and config file's NODE_ENV values and set Make's ENVIRONMENT to the same value.",
    );
  }
  process.env.NODE_ENV = environment;

  // Load developer-owned registry code only after the environment is accepted.
  const runner = await loadBuild('../dist/seed/run-seeds.js');
  if (runner) await runner.runSeeds(process.argv.slice(2));
}

await seed();
