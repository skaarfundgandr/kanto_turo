#!/usr/bin/env node
/**
 * scripts/sync-api-types.mjs — regenerates `src/lib/api/generated.ts` from the
 * sibling backend OpenAPI spec and applies a fixed "generated file" header.
 *
 * The generated types are checked in so frontend builds never depend on the
 * backend repository. Regenerate with `bun run api:types` whenever the backend
 * contract changes; never patch `generated.ts` by hand.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const specPath = resolve(repoRoot, '..', 'arrow_server', 'openapi.yaml');
const outputPath = join(repoRoot, 'src', 'lib', 'api', 'generated.ts');
const cliPath = join(repoRoot, 'node_modules', 'openapi-typescript', 'bin', 'cli.js');

const HEADER = `/**
 * GENERATED FILE — do not edit by hand.
 * Generated from the sibling backend spec \`../arrow_server/openapi.yaml\` by
 * \`bun run api:types\` (scripts/sync-api-types.mjs). Regenerate whenever the
 * backend contract changes; never patch this file manually.
 */

`;

if (!existsSync(specPath)) {
	console.error(`[api:types] ERROR: backend OpenAPI spec not found at ${specPath}`);
	process.exit(1);
}
if (!existsSync(cliPath)) {
	console.error(`[api:types] ERROR: openapi-typescript is not installed; run bun install first.`);
	process.exit(1);
}

const result = spawnSync(process.execPath, [cliPath, specPath, '--output', outputPath], {
	stdio: 'inherit',
	cwd: repoRoot
});
if (result.status !== 0) {
	process.exit(result.status ?? 1);
}

const generated = readFileSync(outputPath, 'utf8');
const withoutOldHeader = generated.replace(/^\/\*\*[\s\S]*?\*\//, '').trimStart();
writeFileSync(outputPath, HEADER + withoutOldHeader);
console.log(`[api:types] regenerated ${outputPath} from ${specPath}`);
