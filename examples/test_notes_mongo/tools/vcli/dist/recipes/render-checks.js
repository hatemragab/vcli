import { bundled, file, runtime } from './bundle.js';
import { selection } from './selection.js';
export async function checkFiles(config) {
    const files = await Promise.all(['architecture-rules.ts', 'check-architecture.ts'].map((path) => bundled('scripts/' + path)));
    const selectedDb = selection(config, 'database');
    const variant = selectedDb === 'database.postgres'
        ? 'postgres'
        : selectedDb === 'database.mongodb'
            ? 'mongodb'
            : 'common';
    const database = await runtime('scripts/database-isolation-rules.ts', variant);
    files.push(database, await runtime('scripts/check-database.ts', variant === 'common' ? 'mongodb' : variant));
    for (const entry of files)
        entry.ownership = 'managed';
    files.push(file('Makefile', `ENVIRONMENT ?= development
PORT ?= 3100
PROFILE ?=
CONFIG_FILE ?=
.PHONY: help install dev dev-plan build start local-prod check test services-plan services-up services-down services-status${selection(config, 'database') ? ' db-initialize release-apply release-backup release-restore' : ''}
help:
\t@echo "install dev dev-plan build start local-prod check test services-plan services-up services-down services-status${selection(config, 'database') ? ' db-initialize release-apply release-backup release-restore' : ''}"
install:
\tnpm --prefix tools/vcli install --omit=dev --ignore-scripts --no-package-lock --install-links --no-audit --no-fund
\tnode tools/vcli/bin/vcli.mjs install
dev:
\tnpm exec -- vcli dev --environment "$(ENVIRONMENT)" --port "$(PORT)" $(if $(CONFIG_FILE),--config-file "$(CONFIG_FILE)")
dev-plan:
\tnpm exec -- vcli dev --environment "$(ENVIRONMENT)" --port "$(PORT)" --dry-run $(if $(CONFIG_FILE),--config-file "$(CONFIG_FILE)")
build:
\tnpm run build
start:
\tnpm start
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
${selection(config, 'database') ? 'db-initialize: release-apply\nrelease-apply:\n\tnpm exec -- vcli release apply $(if $(CONFIG_FILE),--config-file "$(CONFIG_FILE)")\nrelease-backup:\n\tnpm exec -- vcli release backup --profile "$(PROFILE)"\nrelease-restore:\n\tnpm exec -- vcli release restore --profile "$(PROFILE)"\n' : ''}`));
    return files;
}
//# sourceMappingURL=render-checks.js.map