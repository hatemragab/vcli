.DEFAULT_GOAL := help
.PHONY: help install demo dev build start-prod check check-architecture check-database test test-e2e services-up services-down migrate

NPM ?= npm
DOCKER ?= docker
COMPOSE_FILE ?= ops/compose.development.yml
export COMPOSE_FILE
export COMPOSE_PROFILES

help:
	@echo "install         Install pinned dependencies"
	@echo "demo            Build and run disposable verified local review fixture"
	@echo "dev             Run standard Nest watch workflow"
	@echo "build           Compile the application"
	@echo "start-prod      Run compiled app with production configuration"
	@echo "check           Formatting, lint, and type checks (build first)"
	@echo "check-architecture  Reject circular dependencies and forbidden shortcuts"
	@echo "check-database  Verify only the selected database source and dependencies"
	@echo "test            Focused application contract tests (build first)"
	@echo "test-e2e        Build and run actual HTTP/protocol tests"
	@echo "services-up     Start selected local development dependencies"
	@echo "services-down   Stop dependencies and preserve volumes"
	@echo "migrate         Apply explicit owner schema setup (build first)"

install:
	$(NPM) ci --ignore-scripts --no-audit --no-fund
dev:
	NODE_ENV=development $(NPM) run start:dev
demo: build
	NODE_ENV=development node scripts/demo.ts
build:
	$(NPM) run build
start-prod:
	NODE_ENV=production $(NPM) run start
check:
	$(NPM) run check
check-architecture:
	$(NPM) run check:architecture
check-database:
	$(NPM) run check:database
test:
	$(NPM) test
test-e2e: build
	$(NPM) run test:e2e
services-up:
	@test -n "$(COMPOSE_PROFILES)" || { echo "Select COMPOSE_PROFILES=mongodb, centrifugo, or diagnostics" >&2; exit 2; }
	$(DOCKER) compose up -d
services-down:
	$(DOCKER) compose down
migrate:
	node scripts/migrate.ts
