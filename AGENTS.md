# Repository Guidelines

## Project Structure & Module Organization

This is a SvelteKit 5 frontend. Routes live in `src/routes/`; reusable UI, stores, utilities, and API code live under `src/lib/`. Keep network access inside `src/lib/api/client.ts`; ESLint enforces this boundary. Static files belong in `static/`, Vitest suites in `tests/`, helpers in `scripts/`, and verification notes in `docs/`. Treat `build/` and `.svelte-kit/` as generated output.

## Build, Test, and Development Commands

- `bun install` installs the locked dependencies from `bun.lock`.
- `bun run dev` starts Vite at `http://127.0.0.1:5173`.
- `bun run check` runs Svelte and TypeScript diagnostics.
- `bun run lint` enforces ESLint rules, including API-layer restrictions.
- `bun run format:check` verifies Prettier formatting; `bun run format` fixes it.
- `bun run test:unit` runs Vitest once. Do not use bare `bun test`; it bypasses the Vite/Svelte configuration.
- `bun run build` creates the adapter-node production build; `bun run start` serves it.

## Coding Style & Naming Conventions

Use strict TypeScript and Svelte 5 conventions. Prettier requires tabs, single quotes, no trailing commas, and a 100-character print width. Name Svelte components in `PascalCase.svelte`, utilities and modules in descriptive kebab-case or existing project patterns, and variables/functions in `camelCase`. Import through `$lib` where practical. Never call `fetch` outside the API client or import generated/private API internals from routes and components.

## Testing Guidelines

Tests use Vitest, Testing Library Svelte, happy-dom, and axe-core. Name suites `*.test.ts` under `tests/`; follow phase-oriented names when extending a project phase. Stub network access so tests remain deterministic. There is no numeric coverage threshold; every fix or feature should include focused regression coverage. Before submitting, run `bun run check`, `bun run lint`, `bun run format:check`, `bun run test:unit`, and `bun run build`.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit prefixes such as `feat:`, `fix:`, `test:`, `docs:`, and `chore:`. Keep subjects imperative, concise, and scoped to observable behavior. Pull requests should explain the change and its motivation, list verification commands, link relevant issues, and include screenshots for visible UI changes. Call out environment, API-contract, or deployment impacts explicitly.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local overrides, but never commit credentials, bearer tokens, SAS URLs, or signed order URLs. `PUBLIC_API_BASE_URL` is public runtime configuration and must end exactly in `/api/v1`. Use `127.0.0.1` consistently to avoid CORS origin mismatches.
