# Narcissist Feed — Chrome extension (Svelte + Vite + CRXJS).

set shell := ["sh", "-cu"]

[private]
default:
    @just --list

[private]
deps:
    @[ node_modules/.bun-tag -nt bun.lock ] || (bun install && touch node_modules/.bun-tag)

# Watch build; load dist/ unpacked once.
[group('dev')]
dev: deps
    bun run dev

[group('dev')]
build: deps
    bun run build

[group('dev')]
clean:
    rm -rf dist coverage .cache/e2e-failures

# Render icons from assets/icon/icon.svg.
[group('dev')]
icons: deps
    bun run icons

[group('check')]
test *args: deps
    bunx vitest run {{ args }}

# Needs a GitHub token or `gh` login.
[group('check')]
e2e *args: deps
    bun run build
    bunx vitest run --config vitest.e2e.config.ts {{ args }}

# Same, browser visible and slowed down.
[group('check')]
e2e-headed *args: deps
    bun run build
    HEADED=1 E2E_SLOWMO=${E2E_SLOWMO:-50} bunx vitest run --config vitest.e2e.config.ts {{ args }}

# oxlint, type checks, format check.
[group('check')]
lint: deps
    bun run lint
    bun run check
    bun run format:check

[group('check')]
format: deps
    bun run format

[private]
alias fmt := format
