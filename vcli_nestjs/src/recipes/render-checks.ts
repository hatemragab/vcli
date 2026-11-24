import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { bundled, file } from './bundle.js';
import { selection } from './selection.js';
import { sliceFrom } from './template-markers.js';

export async function checkFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  const files = await Promise.all(
    ['architecture-rules.ts', 'check-architecture.ts'].map((path) =>
      bundled('scripts/' + path),
    ),
  );
  const selectedDb = selection(config, 'database');
  const variant =
    selectedDb === 'database.postgres'
      ? 'postgres'
      : selectedDb === 'database.mongodb'
        ? 'mongodb'
        : 'common';
  const rulesPath = 'scripts/database-isolation-rules.ts';
  const database = await bundled(rulesPath, variant);
  if (variant !== 'common') {
    // Native templates supply only the policy header. Emit one complete checker.
    const commonRules = await bundled(rulesPath);
    database.content += sliceFrom(
      commonRules.content,
      'const databaseNames =',
      rulesPath,
    );
  }
  files.push(database, await bundled('scripts/check-database.ts'));
  for (const entry of files) entry.ownership = 'managed';
  const databaseTargets = selectedDb
    ? ' first-run db-initialize release-apply release-backup release-restore seed'
    : '';
  const firstRun = selectedDb
    ? `FIRST_RUN_CONFIG_FILE := $(or $(CONFIG_FILE),$(APP_ENV_FILE),$(wildcard .env.development))
FIRST_RUN_CONFIG_ARG := $(if $(FIRST_RUN_CONFIG_FILE),--config-file "$(FIRST_RUN_CONFIG_FILE)")
first-run: build
\tNODE_ENV=development npm exec -- vcli release apply $(FIRST_RUN_CONFIG_ARG)
\t$(MAKE) dev ENVIRONMENT=development CONFIG_FILE="$(FIRST_RUN_CONFIG_FILE)"
`
    : '';
  const seedTarget = selectedDb
    ? `seed: export VCLI_SEED_MAKE_ENVIRONMENT := $(ENVIRONMENT)
seed: export VCLI_SEED_CONFIG_FILE := $(RUN_CONFIG_FILE)
seed: export VCLI_SEED_MODULE := $(value MODULE)
seed:
\t@set --; if [ -n "$$VCLI_SEED_MODULE" ]; then set -- -- --module "$$VCLI_SEED_MODULE"; fi; APP_ENV_FILE="$$VCLI_SEED_CONFIG_FILE" npm run db:seed "$$@"
`
    : '';
  files.push(
    file(
      'Makefile',
      `ENVIRONMENT ?= development
PORT ?= 3100
PROFILE ?=
CONFIG_FILE ?=
RUN_CONFIG_FILE := $(or $(CONFIG_FILE),$(APP_ENV_FILE),$(wildcard .env.$(ENVIRONMENT)))
RUN_CONFIG_ARG := $(if $(RUN_CONFIG_FILE),--config-file "$(RUN_CONFIG_FILE)")
.PHONY: help install dev dev-plan build start local-prod check test services-plan services-up services-down services-status${databaseTargets}
help:
\t@echo "install dev dev-plan build start local-prod check test services-plan services-up services-down services-status${databaseTargets}"
install:
\tnpm --prefix tools/vcli install --omit=dev --ignore-scripts --no-package-lock --install-links --no-audit --no-fund
\tnode tools/vcli/bin/vcli.mjs install
dev:
\t$(if $(RUN_CONFIG_FILE),NODE_ENV="$(ENVIRONMENT)" HOST=127.0.0.1 PORT="$(PORT)" npm exec -- vcli config check $(RUN_CONFIG_ARG))
\tnpm exec -- vcli dev --environment "$(ENVIRONMENT)" --port "$(PORT)" $(RUN_CONFIG_ARG)
dev-plan:
\tnpm exec -- vcli dev --environment "$(ENVIRONMENT)" --port "$(PORT)" --dry-run $(RUN_CONFIG_ARG)
build:
\tnpm run build
${firstRun}start:
\t$(if $(RUN_CONFIG_FILE),APP_ENV_FILE="$(RUN_CONFIG_FILE)") npm start
local-prod:
\tNODE_ENV=production npm run start:prod
check:
\tnpm run check
test:
\tnpm test
services-plan:
\tnpm exec -- vcli services plan --environment "$(ENVIRONMENT)"
services-up:
\tnpm exec -- vcli services up --environment "$(ENVIRONMENT)"
services-down:
\tnpm exec -- vcli services down --environment "$(ENVIRONMENT)"
services-status:
\tnpm exec -- vcli services status --environment "$(ENVIRONMENT)"
${selectedDb ? 'db-initialize: release-apply\nrelease-apply:\n\tnpm exec -- vcli release apply $(RUN_CONFIG_ARG)\nrelease-backup:\n\tnpm exec -- vcli release backup --profile "$(PROFILE)"\nrelease-restore:\n\tnpm exec -- vcli release restore --profile "$(PROFILE)"\n' : ''}${seedTarget}`,
    ),
  );
  return files;
}
