ENVIRONMENT ?= development
PORT ?= 3100
PROFILE ?=
CONFIG_FILE ?=
.PHONY: help install dev dev-plan build start local-prod check test services-plan services-up services-down services-status db-initialize release-apply release-backup release-restore
help:
	@echo "install dev dev-plan build start local-prod check test services-plan services-up services-down services-status db-initialize release-apply release-backup release-restore"
install:
	npm --prefix tools/vcli install --omit=dev --ignore-scripts --no-package-lock --install-links --no-audit --no-fund
	node tools/vcli/bin/vcli.mjs install
dev:
	npm exec -- vcli dev --environment "$(ENVIRONMENT)" --port "$(PORT)" $(if $(CONFIG_FILE),--config-file "$(CONFIG_FILE)")
dev-plan:
	npm exec -- vcli dev --environment "$(ENVIRONMENT)" --port "$(PORT)" --dry-run $(if $(CONFIG_FILE),--config-file "$(CONFIG_FILE)")
build:
	npm run build
start:
	npm start
local-prod:
	NODE_ENV=production npm run start:prod
check:
	npm run check
test:
	npm test
services-plan:
	npm exec -- vcli services plan --environment "$(ENVIRONMENT)"
services-up:
	npm exec -- vcli services up --environment "$(ENVIRONMENT)"
services-down:
	npm exec -- vcli services down --environment "$(ENVIRONMENT)"
services-status:
	npm exec -- vcli services status --environment "$(ENVIRONMENT)"
db-initialize: release-apply
release-apply:
	npm exec -- vcli release apply $(if $(CONFIG_FILE),--config-file "$(CONFIG_FILE)")
release-backup:
	npm exec -- vcli release backup --profile "$(PROFILE)"
release-restore:
	npm exec -- vcli release restore --profile "$(PROFILE)"
