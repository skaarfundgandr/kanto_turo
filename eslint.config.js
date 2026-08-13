import { posix } from 'node:path';
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Architecture guards for the locked layering:
 * - `app/no-direct-fetch`: only `src/lib/api/client.ts` may call `fetch`; all
 *   other application code flows through it via endpoints.
 * - `app/no-restricted-layer-imports`: generated OpenAPI types, the fetch
 *   wrapper, the base URL, and the token seam are private to the API layer
 *   (token/jwt additionally open to stores); domain DTOs come only from
 *   `src/lib/api/types.ts`.
 */

const noDirectFetch = {
	meta: {
		type: 'problem',
		docs: { description: 'Reject direct fetch() calls outside the API client.' },
		messages: {
			directFetch:
				'Direct fetch() is forbidden here; call an endpoint from src/lib/api/endpoints.ts instead.'
		}
	},
	create(context) {
		const filename = toPosixPath(context.filename ?? '');
		if (filename.endsWith('/src/lib/api/client.ts')) return {};
		return {
			CallExpression(node) {
				const callee = node.callee;
				const isBareFetch = callee.type === 'Identifier' && callee.name === 'fetch';
				const isGlobalFetch =
					callee.type === 'MemberExpression' &&
					callee.object.type === 'Identifier' &&
					(callee.object.name === 'window' ||
						callee.object.name === 'globalThis' ||
						callee.object.name === 'self') &&
					callee.property.type === 'Identifier' &&
					callee.property.name === 'fetch';
				if (isBareFetch || isGlobalFetch) {
					context.report({ node, messageId: 'directFetch' });
				}
			}
		};
	}
};

const LAYER_TABLE = [
	{ from: 'src/lib/api/generated', allow: ['src/lib/api'] },
	{ from: 'src/lib/api/client', allow: ['src/lib/api'] },
	{ from: 'src/lib/api/base-url', allow: ['src/lib/api'] },
	{ from: 'src/lib/api/token', allow: ['src/lib/api', 'src/lib/stores'] },
	{ from: 'src/lib/api/jwt', allow: ['src/lib/api', 'src/lib/stores'] }
];

function toPosixPath(path) {
	return path.replace(/\\/g, '/');
}

function stripExtension(moduleId) {
	return moduleId.replace(/\.(ts|js|svelte|tsx|jsx)$/, '').replace(/\/index$/, '');
}

function resolveImport(relFile, source) {
	if (source.startsWith('$lib/')) {
		return stripExtension(`src/lib/${source.slice(5)}`);
	}
	if (!source.startsWith('.')) return null;
	return stripExtension(posix.normalize(posix.join(posix.dirname(relFile), source)));
}

const noRestrictedLayerImports = {
	meta: {
		type: 'problem',
		docs: { description: 'Enforce the API layer import boundaries.' },
		messages: {
			restricted:
				'"{{from}}" is private to {{allow}}; import domain DTOs from src/lib/api/types.ts or use the endpoint layer.'
		}
	},
	create(context) {
		const filename = toPosixPath(context.filename ?? '');
		const srcIndex = filename.indexOf('/src/');
		if (srcIndex === -1) return {};
		const relFile = filename.slice(srcIndex + 1);
		return {
			ImportDeclaration(node) {
				const source = node.source.value;
				const resolved = resolveImport(relFile, source);
				if (!resolved) return;
				for (const { from, allow } of LAYER_TABLE) {
					if (resolved === from || resolved === `${from}/index`) {
						const allowed = allow.some(
							(prefix) => relFile.startsWith(`${prefix}/`) || relFile === prefix
						);
						if (!allowed) {
							context.report({
								node,
								messageId: 'restricted',
								data: { from, allow: allow.join(', ') }
							});
						}
						break;
					}
				}
			}
		};
	}
};

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser
			}
		}
	},
	{
		files: ['src/**'],
		plugins: {
			app: {
				rules: {
					'no-direct-fetch': noDirectFetch,
					'no-restricted-layer-imports': noRestrictedLayerImports
				}
			}
		},
		rules: {
			'app/no-direct-fetch': 'error',
			'app/no-restricted-layer-imports': 'error'
		}
	},
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'.wrangler/',
			'dist/',
			'node_modules/',
			// ignored design/reference material, never part of the application
			'.opencode/'
		]
	}
);
