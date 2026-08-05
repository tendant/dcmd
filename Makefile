# Shortcuts for the two toolchains this project spans. Nothing here is required
# — every target is one or two commands you can run by hand — but the commands
# live in two directories and two ecosystems, which is what makes them awkward
# to remember.
#
# `make check` is the one that matters: it runs what CI runs, in the same order,
# so a green result here means a green result there.

.DEFAULT_GOAL := help

# Every target is phony; none of them produce a file of their own name.
.PHONY: help install run dev web build test test-web test-rust test-live lint \
        fmt check fixture platforms ssh-up ssh-down clean

help: ## Show this list
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk -F':.*?## ' '{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install frontend dependencies exactly as the lockfile says
	pnpm install --frozen-lockfile

run: dev ## Run the app (an alias for dev, which is how you run it)

dev: ## Run the app with hot reload
	pnpm tauri dev

web: ## Serve the frontend alone — no file operations work here, see README
	pnpm dev

build: ## Build the release binary and installer
	pnpm tauri build

# --- Tests -------------------------------------------------------

test: test-web test-rust ## Run both suites

test-web: ## Frontend: store logic and components, in jsdom
	pnpm test

test-rust: ## Rust: filesystem operations
	cd src-tauri && cargo test

test-live: ## Rust including the remote tests, against a throwaway SSH container
	./scripts/ssh-test-server.sh start
# One recipe line, so the server is stopped even when the tests fail. Split
# across lines make would abandon the rest on a failure and leave a container
# running, which is the sort of thing found days later.
	@eval "$$(./scripts/ssh-test-server.sh env)"; \
	  (cd src-tauri && cargo test); status=$$?; \
	  ./scripts/ssh-test-server.sh stop; \
	  exit $$status

# --- Checks ------------------------------------------------------

lint: ## Typecheck, format check and clippy in both profiles
	pnpm build
	cd src-tauri && cargo fmt --check
	cd src-tauri && cargo clippy --all-targets -- -D warnings
# The release profile compiles out code behind debug_assertions, so a `mut` only
# the removed branch needed is a warning nothing in the dev profile can report.
# CI does not run this one; it is the reason `make check` is stricter than CI
# rather than merely equal to it.
	cd src-tauri && cargo clippy --release --all-targets -- -D warnings

fmt: ## Format the Rust sources in place
	cd src-tauri && cargo fmt

check: lint test ## Everything CI runs, plus the release clippy pass

# --- Tools -------------------------------------------------------

fixture: ## Build /tmp/dcmd-fixture for exercising the dialogs by hand
	./scripts/make-fixture.sh

platforms: ## Clippy the cfg-gated filesystem code for Linux and Windows
	./scripts/check-platforms.sh

ssh-up: ## Start the disposable SSH server the remote tests need
	./scripts/ssh-test-server.sh start

ssh-down: ## Stop and remove it
	./scripts/ssh-test-server.sh stop

clean: ## Remove build output from both toolchains
	rm -rf dist
	cd src-tauri && cargo clean
