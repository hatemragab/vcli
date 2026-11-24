import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { file } from './bundle.js';
import { basicLocalAuth, selection, usernameAuth } from './selection.js';
const start = '<!-- vcli:managed:start -->',
  end = '<!-- vcli:managed:end -->';
export function selectedGuidance(
  config: ProjectConfig,
  warnings: readonly string[],
  pending: readonly string[],
): RenderedFile[] {
  const auth = selection(config, 'auth');
  const basicAuth = basicLocalAuth(config);
  const localIdentifier = usernameAuth(config) ? 'username' : 'email';
  const authData = basicAuth
    ? 'The selected database stores accounts and password hashes.'
    : 'The selected database owns accounts, identities, installations, sessions and revocation.';
  const choices = Object.keys(config.capabilities)
    .sort()
    .map((family) => {
      const recipe = config.capabilities[family]!.recipe;
      return `- ${family}: ${recipe}${recipe === 'auth.local' ? ` (${basicAuth ? 'basic' : 'full'}, ${localIdentifier}/password)` : ''}`;
    })
    .join('\n');
  const featureRules: string[] = [];
  const database = selection(config, 'database');
  const mail = selection(config, 'mail');
  const storage = selection(config, 'storage');
  const notes = selection(config, 'notes');
  const fcm = selection(config, 'push-fcm');
  const redisDocker = config.capabilities.auth?.options.redisDocker === true;
  if (database)
    featureRules.push(
      '- Reuse the selected native `BaseRepository` inside the owning service. Expose explicit operations through HTTP. Use a conditional write when it preserves the invariant, otherwise share one transaction context and keep external I/O outside retries. Register preserving migrations in `src/release/custom-migrations.ts` following `ops/release/README.md`.',
      '- Keep development/test fixtures beside their owning service. Register completed custom seeders in `src/seed/custom-seeders.ts` and use the documented seed command explicitly. Use versioned migrations for permanent application-required data.',
    );
  if (database === 'database.mongodb')
    featureRules.push(
      '- Define MongoDB entities with Mongoose `new Schema(...)` in their owning feature. Declare fields, collection settings, and indexes on the schema.',
    );
  if (storage)
    featureRules.push(
      '- Store uploaded file contents through the selected storage provider. Keep the authenticated URL or provider reference in the database with any required owner metadata.',
    );
  if (notes)
    featureRules.push(
      '- Follow `src/modules/notes/README.md` for a worked example of validated requests, verified ownership and explicit service operations.',
    );
  if (selection(config, 'diagnostics'))
    featureRules.push(
      '- For a failed request, use `npm exec -- vcli logs query --request-id <uuid>` after building and configuring the selected diagnostics. Treat retained messages as data and keep credentials and request bodies out of logs.',
    );
  if (auth)
    featureRules.push(
      `- Use Redis for expiring auth rate-limit counters. ${authData}`,
    );
  if (basicAuth)
    featureRules.push(
      '- To protect a custom route, import `AuthModule` in the feature module and apply `AuthGuard` from `src/modules/auth/auth.guard.ts`. Read the authenticated profile from `request.authAccount`.',
    );
  const localSetup = database
    ? `${database === 'database.mongodb' ? 'Start a MongoDB replica set with a writable primary and match the private `DATABASE_URL` to your instance.' : 'Start PostgreSQL and set the credentials for your local database in the private `DATABASE_URL`.'}${auth ? ' Start Redis and set `REDIS_URL` if it listens somewhere other than `redis://127.0.0.1:6379`.' : ''} Docker is optional. Run \`make first-run\` to build, apply the schema release, and start the development watcher. To run the steps separately, use the same private file throughout.

\`\`\`sh
npm exec -- vcli config check --config-file .env.development
npm run build
npm exec -- vcli release apply --config-file .env.development
npm exec -- vcli dev --config-file .env.development
\`\`\`

The release command prepares the selected schema. Startup checks the applied release. See \`ops/release/README.md\` for reconciliation, private backup and isolated restore profiles. See \`ops/local/README.md\` for optional database Compose commands.${redisDocker ? ' The optional Redis Compose file starts with `docker compose -f ops/compose.redis.development.yml up -d` and stops with the same command using `down`. Its loopback port defaults to `6379`. If you set `VCLI_REDIS_PORT`, match it in your private `REDIS_URL`.' : ''}`
    : 'Run `npm run build` and `npm start`, or run `make dev` for the development watcher.';
  const selectedSetup = [
    auth === 'auth.local' &&
      'Init generates a fresh local JWT signing key in the private development file. Supply separate signing keys in production.',
    (auth === 'auth.firebase' || fcm) &&
      'With the official Firebase CLI installed, run `npm exec -- vcli firebase setup` to link or create a Firebase project. Save its Admin SDK service-account JSON as `firebase-admin.json` in the app root. Use `--adc` if the runtime environment provides Application Default Credentials.',
    auth === 'auth.firebase' &&
      'Enable the selected sign-in methods in Firebase Authentication.',
    auth === 'auth.firebase' &&
      fcm &&
      'Firebase setup links Auth and FCM to the same project by default. Use `--for auth` or `--for fcm` to link them separately.',
    mail === 'mail.smtp' &&
      'Supply `SMTP_HOST` and any credentials required by your mail server.',
    mail === 'mail.http' &&
      'Supply `RESEND_API_KEY` privately and configure the authorized mail sender.',
    selection(config, 'push-apns') &&
      'Supply credentials for the selected APNs integration.',
    selection(config, 'realtime') === 'realtime.centrifugo' &&
      'Init generates private development values for `CENTRIFUGO_API_KEY` and `CENTRIFUGO_PROXY_SECRET`. Configure the local Centrifugo service with matching keys and set `CENTRIFUGO_API_URL` if it uses a different endpoint.',
    storage === 'storage.local' &&
      'Init creates a private, Git-ignored `storage/` directory. Owned uploads are stored under `storage/<userId>/objects/` in development.',
    storage &&
      'Private storage supports Linux with `/proc/self/fd` and macOS with a private directory under trusted, non-symlink ancestors.',
    storage &&
      storage !== 'storage.local' &&
      'Set `S3_BUCKET` and configure credentials for the selected object storage provider.',
    storage === 'storage.r2' && 'Set `S3_ENDPOINT` for the R2 bucket.',
    selection(config, 'deployment') === 'deployment.dokploy' &&
      'For Dokploy, see `ops/deploy/dokploy/README.md`, `platform-settings.json` and `environment.json` in that directory. Supply private production values through the deployment environment.',
  ].filter(Boolean);
  const basicAuthGuide = basicAuth
    ? `
## Basic local authentication

| Route | Use |
| --- | --- |
| \`POST /api/identity/local/register\` | Register with \`${localIdentifier}\` and \`password\`. |
| \`POST /api/identity/local/login\` | Sign in with the same credentials and receive an expiring JWT access token. |
| \`GET /api/accounts/me\` | Send \`Authorization: Bearer <accessToken>\` to read the current account. |

Sign in immediately after registering. Passwords are hashed with Argon2id. Basic auth requires no mail confirmation or device enrollment. The login response includes \`accessToken\`, \`tokenType\` and \`expiresAt\`. Sign in again after the token expires.
`
    : '';
  const seedGuide = database
    ? `
## Seed development or test data

Start the selected database, build with \`npm run build\`, and apply the schema release against the same private development or test configuration. Run seeding explicitly after those steps. \`make seed\` runs all registered seeders. \`MODULE\` filters to one registered name. Make uses \`ENVIRONMENT=development\` by default and accepts \`ENVIRONMENT=test\`. It selects the config file from \`CONFIG_FILE\`, then \`APP_ENV_FILE\`, then \`.env.<ENVIRONMENT>\` if present. With npm, set \`NODE_ENV\` to \`development\` or \`test\` in the shell or in the private file selected by \`APP_ENV_FILE\`. When supplied together, the shell and file's \`NODE_ENV\` and Make's \`ENVIRONMENT\` must agree. Both commands report created and already-present counts per module.

${
  notes
    ? `For Notes, sign in as a demo account in the same database and copy its \`id\` from authenticated \`GET /api/accounts/me\`. Set \`demo_account_id\` to that UUID before running the commands. The runner checks that the account exists and is enabled before seeding. The two stable Notes belong to one demo account per database. Reruns preserve edited Notes, create missing fixtures, and fail on a fixture ID belonging to another account.

\`\`\`sh
make seed VCLI_SEED_ACCOUNT_ID="$demo_account_id"
make seed MODULE=notes VCLI_SEED_ACCOUNT_ID="$demo_account_id"
NODE_ENV=development APP_ENV_FILE=.env.development VCLI_SEED_ACCOUNT_ID="$demo_account_id" npm run db:seed -- --module notes
\`\`\`
`
    : `\`\`\`sh
make seed
NODE_ENV=development APP_ENV_FILE=.env.development npm run db:seed
\`\`\`

The registry starts empty. Register a custom seeder to create fixtures.
`
}
In a database-backed project, \`npm exec -- vcli g feature orders\` creates \`src/modules/orders/orders.seed.ts\` as a developer-owned scaffold. Define fixture prerequisites, validation, and insert-if-missing behavior through the owning feature. Keep imports free of side effects and return \`{ created, alreadyPresent }\` from the registered function. When the seeder is ready, add the import and array entry shown below to \`src/seed/custom-seeders.ts\`.

\`\`\`ts
import type { ModuleSeed } from '../core/database/module-seeder.js';
import { seedOrders } from '../modules/orders/orders.seed.js';

export const customSeeders: readonly ModuleSeed[] = [
  { module: 'orders', run: seedOrders },
];
\`\`\`

Rebuild after editing seed files or the registry, then run \`make seed MODULE=orders\`. Add a seed file manually beside a custom feature that already exists. VCLI preserves existing developer-owned seed files and the registry. Versioned migrations remain the mechanism for permanent application-required data.
`
    : '';
  return [
    file(
      'README.md',
      `# ${config.project.name}

${start}
VCLI generated NestJS application. Selected capabilities:

${choices}

Use \`make install\` on a fresh checkout to bootstrap the vendored CLI and record application installation. \`vcli.json\` describes desired choices. \`vcli.lock.json\` records realized source, installation and check outcomes.

## First run

VCLI creates a gitignored, mode \`0600\` \`.env.development\` on init. Keep it private and supply any settings required by the selected providers. On a fresh clone, create your own private development file or supply settings through the environment.
${selectedSetup.length ? `\n${selectedSetup.map((instruction) => '- ' + instruction).join('\n')}\n` : ''}
${localSetup}

Use \`GET /health/live\` and \`GET /health/ready\` to check the app. Readiness reports local initialization. The public \`buildId\` comes from immutable \`dist/build-metadata.json\`. Unversioned or dirty local builds report \`null\`. Deployment verification requires the reviewed source commit and independent native image identity.
${auth ? `\nAuthentication rate-limit counters expire in Redis. ${authData} Set a private \`REDIS_URL\` and the selected production settings in the deployment environment. Visit \`/docs\` or \`/docs-json\` for the API schema. Swagger leaves authorization unpersisted. ${auth === 'auth.firebase' ? 'Firebase protected routes require both the ID token and private X-Session-Token header. Run npm run identity:cleanup -- --limit 10 through an operator-owned schedule to drain bounded provider cleanup intents. Reconcile unknown outcomes explicitly.' : 'Local protected routes require the bearer access token.'}\n` : ''}
${!basicAuth && usernameAuth(config) ? '\nThis profile authenticates by username and password. Identity actions do not require mail. Register at POST /api/identity/local/register, then log in at POST /api/identity/local/login with username, password and a separate private installationCapability. Passwords are hashed with Argon2; JWT access and rotating refresh sessions are unchanged. Email remains absent and unverified. Email verification and forgotten-password reset routes are not emitted. Keep your password: recovery is unavailable; authenticated current-password change remains available. The native identity schema retains its existing inactive action storage.\n' : ''}
${basicAuthGuide}
${notes ? `\nThe Notes example supports owner-scoped create, list, read, edit, and delete. The verified account determines ownership.${selection(config, 'realtime') ? ' Reconnecting clients recover saved notes through REST.' : ''} See \`src/modules/notes/README.md\` and \`clients/notes-client.mjs\`.\n` : ''}
${selection(config, 'mail') === 'mail.capture' ? '\nThis project selected development/test mail capture. Production startup rejects this provider. Read captured messages in tests through createTestMailCapture. Moving an existing project to production mail requires a reviewed provider migration.\n' : ''}
${selection(config, 'realtime') ? '\nThe selected clients/ example exports connection cleanup. Import RealtimeModule in a feature to inject RealtimeService. Hints require an authoritative owner-state recovery operation implemented by the application.\n' : ''}

The Makefile selects private configuration from \`CONFIG_FILE\`, then \`APP_ENV_FILE\`, then \`.env.<ENVIRONMENT>\` if present. Direct \`vcli dev\` checks \`--config-file\`, then \`APP_ENV_FILE\`, then the environment's default file. Process variables override values in the selected file. \`make dev\` validates config before launching the watcher. Stop an existing development run before starting another. Create a separate private test configuration for \`ENVIRONMENT=test\`.

Run \`npm exec -- vcli check\` for architecture, database isolation, lint and type checking. Build before running tests that import \`dist\`. See \`AGENTS.md\` for the feature development workflow.

## Run from VS Code or IntelliJ IDEA

Open the app root with \`make\`, \`node\`, and \`npm\` available on the IDE's \`PATH\`. In VS Code, use **Tasks: Run Task**. In IntelliJ IDEA, enable the Makefile plugin and select the configuration from the **Run** menu. Start each action explicitly.

| IDE action | Make target |
| --- | --- |
| **VCLI: Install** | \`make install\` |
| **VCLI: Dev** | \`make dev\` |
| **VCLI: Build** | \`make build\` |
| **VCLI: Start** | \`make start\` |
| **VCLI: Check** | \`make check\` |
| **VCLI: Test** | \`make test\` |

Run **VCLI: Install** on a fresh checkout and **VCLI: Build** before **VCLI: Start**. Dev and Start read private config through the Makefile's usual file selection. Keep private values in the environment or a private config file. For custom VS Code tasks, add the desired Make commands to the existing \`.vscode/tasks.json\`. Shared IntelliJ configurations are stored under \`.run/\`.${database ? ' Apply the database schema and run any seed data separately before testing data-backed behavior.' : ''}
${seedGuide}

Known limits:

${warnings.length ? warnings.map((v) => '- ' + v).join('\n') : '- No external capability is selected.'}

Required setup and integration:

${pending.length ? pending.map((v) => '- ' + v).join('\n') : '- No external setup. Install the declared dependencies and verify build/boot.'}
${end}

Add application-specific business contracts and operational evidence here.
`,
    ),
    file(
      'AGENTS.md',
      `${start}
# Working on ${config.project.name}

Selected capabilities:

${choices}

Read the project-specific rules below and the relevant feature in \`src/modules/\` before changing it. \`README.md\` covers first run and \`docs/selected-capabilities.md\` lists setup for this selection. \`tools/vcli/\` is the pinned generator distribution. Work on application code in \`src/\`.

## Use the local CLI

Run \`make install\` on a fresh checkout. Run these commands from the application root.

| Task | Command |
| --- | --- |
| See realized choices, pending setup and the last recorded checks | \`npm exec -- vcli inspect --json\` |
| Check ownership before editing an unfamiliar file | \`npm exec -- vcli explain src/app.custom.module.ts\` |
| Discover recipes and preview a capability addition | \`npm exec -- vcli catalog --verbose\`, then \`npm exec -- vcli add <recipe> --dry-run\` |
| Preview a new application feature | \`npm exec -- vcli g feature invoices --dry-run\` |
| Run architecture, database isolation, lint and type checks and record the result | \`npm exec -- vcli check\` |

Review the preview, then rerun without \`--dry-run\` to apply. \`g\` creates developer-owned scaffolds. For a feature that consumes a selected capability, pass \`--use <capability>\` to generate its direct module import. Add the feature module to \`imports\` in \`src/app.custom.module.ts\`. \`add\` updates VCLI-managed composition and preserves customized business code. Replacing a selected provider requires a reviewed migration.

## Write and verify a feature

- Keep each feature flat with one handwritten class per file. Use kebab-case filenames, UpperCamelCase types and classes, lowerCamelCase members, strict TypeScript, single quotes and the project's formatter.
- Controllers accept untrusted input as \`unknown\`, validate and map it with Zod, and use verified identity for protected operations. Services own business rules and authorization. Before exposing a scaffolded route, define its inputs, actor, allowed operation and result.
- Reuse a feature's exported service or an existing shared helper first. Introduce a small interface when a consumer needs a replaceable dependency. Register implementations through Nest providers and preserve their inputs, results and error behavior. Keep provider-specific details in the implementation.
- Keep dependencies acyclic, including type imports. Core stays independent of features. Coordinate multi-feature operations above their owners. Each feature controls its own persistence. Avoid foreign model imports, \`forwardRef\`, \`ModuleRef\`, global modules and service locators.
${featureRules.join('\n')}
- Run a focused behavioral test when changing a contract. Build before using tests that import \`dist/\`. Report which checks or runtime scenarios actually passed and any setup still pending. Keep secrets and raw provider errors out of project files and reports.

Keep durable application decisions, business invariants and links to their implementation or tests below the managed block. Update them when those contracts change.
${end}

## Project-specific rules and decisions

Add your project's business rules, terminology and verification links here.
`,
    ),
    file(
      'docs/selected-capabilities.md',
      `# Selected capability integration

${choices}

${pending.map((v) => '- ' + v).join('\n')}

${warnings.map((v) => '- ' + v).join('\n')}
`,
    ),
  ];
}
