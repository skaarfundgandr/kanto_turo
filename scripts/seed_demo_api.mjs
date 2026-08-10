#!/usr/bin/env bun
/**
 * Resumable demo-data seed through Arrow Server's public/admin HTTP API.
 *
 * Safety:
 * - Dry-run is the default. Pass --apply to allow POST requests.
 * - Existing records are matched by their unique names and validated before
 *   any write. Conflicting core fields or unexpected category associations
 *   stop the run.
 * - The sibling backend .env is consulted only for ADMIN_USERNAME and
 *   ADMIN_PASSWORD. Credentials, bearer tokens, image URLs, and SAS query
 *   parameters are never logged.
 *
 * Usage:
 *   bun scripts/seed_demo_api.mjs
 *   bun scripts/seed_demo_api.mjs --apply
 *   bun scripts/seed_demo_api.mjs --verify-only
 *   bun scripts/seed_demo_api.mjs --check-fixtures
 *   bun scripts/seed_demo_api.mjs --base-url http://127.0.0.1:3000/api/v1
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {'dry-run' | 'apply' | 'verify-only' | 'check-fixtures'} SeedMode */
/** @typedef {{ help: boolean, mode: SeedMode, baseUrl: string }} CliOptions */
/** @typedef {{ username: string, password: string }} AdminCredentials */
/** @typedef {{ value: string | null }} TokenRef */
/** @typedef {{ name: string, description: string }} SeedCategory */
/** @typedef {{ name: string, description: string, price: string, categories: string[], fixture: string }} SeedProduct */
/** @typedef {{ category: string, product: string }} SeedAssociation */
/** @typedef {{ role_id?: number, name: string, description?: string | null, permissions: string[] }} ApiRole */
/** @typedef {{ name: string, description?: string | null }} ApiCategory */
/** @typedef {{ product_id?: number, name: string, description?: string | null, price: string, product_image_uri?: string | null, categories?: ApiCategory[] | null }} ApiProduct */
/** @typedef {{ roles: ApiRole[], categories: ApiCategory[], products: ApiProduct[] }} Snapshot */
/** @typedef {{ createRole: boolean, setRolePermission: boolean, customerRoleId: number | null, categories: SeedCategory[], products: SeedProduct[], associations: SeedAssociation[], images: SeedProduct[] }} SeedPlan */
/** @typedef {{ method?: string, json?: unknown, body?: BodyInit, expected?: number[], auth?: boolean }} RequestOptions */
/** @typedef {{ request: (path: string, options?: RequestOptions) => Promise<any> }} ApiClient */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const backendDir = resolve(repoRoot, '..', 'arrow_server');
const fixtureDir = join(scriptDir, 'fixtures', 'menu');
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

const CUSTOMER_ROLE = {
	name: 'CUSTOMER',
	description: 'Regular customer: can browse the menu and place orders',
	permissions: ['WRITE']
};

/** @type {SeedCategory[]} */
const CATEGORIES = [
	{ name: 'Drinks', description: 'Hot and cold beverages' },
	{ name: 'Burgers', description: 'Hand-made burgers and sides' },
	{ name: 'Mains', description: 'Grilled dishes and seafood specials' }
];

/** @type {SeedProduct[]} */
const PRODUCTS = [
	{
		name: 'Espresso',
		description: 'Single shot of freshly pulled espresso',
		price: '3.50',
		categories: ['Drinks'],
		fixture: 'espresso.png'
	},
	{
		name: 'Cappuccino',
		description: 'Espresso with steamed milk and foam',
		price: '4.25',
		categories: ['Drinks'],
		fixture: 'cappuccino.png'
	},
	{
		name: 'Fresh Orange Juice',
		description: 'Cold-pressed orange juice',
		price: '5.50',
		categories: ['Drinks'],
		fixture: 'orange-juice.png'
	},
	{
		name: 'Classic Burger',
		description: 'Beef patty, lettuce, tomato, house sauce',
		price: '9.99',
		categories: ['Burgers'],
		fixture: 'classic-burger.png'
	},
	{
		name: 'Double Smash Burger',
		description: 'Two smashed patties with cheddar',
		price: '13.50',
		categories: ['Burgers'],
		fixture: 'double-smash-burger.png'
	},
	{
		name: 'Grilled Salmon',
		description: 'Atlantic salmon with lemon butter',
		price: '28.00',
		categories: ['Mains'],
		fixture: 'grilled-salmon.png'
	},
	{
		name: 'Lobster Platter',
		description: 'Whole grilled lobster with sides',
		price: '550.00',
		categories: ['Mains'],
		fixture: 'lobster-platter.png'
	}
];

/** @param {string} message */
function info(message) {
	console.log(`[seed_demo_api] ${message}`);
}

function usage() {
	console.log(`Usage: bun scripts/seed_demo_api.mjs [mode] [options]

Modes (choose one):
  --dry-run          Inspect and report required writes (default)
  --apply            Create/repair missing seed data and upload missing images
  --verify-only      Require and verify the complete seed without writing
  --check-fixtures   Validate local image fixtures without credentials/network

Options:
  --base-url <url>   API root (default: SEED_API_BASE_URL or
                     http://127.0.0.1:3000/api/v1)
  --help             Show this help`);
}

/**
 * @param {string[]} argv
 * @returns {CliOptions}
 */
function parseArgs(argv) {
	/** @type {SeedMode} */
	let mode = 'dry-run';
	let modeWasSet = false;
	let baseUrl = process.env.SEED_API_BASE_URL || 'http://127.0.0.1:3000/api/v1';

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--help' || argument === '-h') return { help: true, mode, baseUrl };
		if (['--dry-run', '--apply', '--verify-only', '--check-fixtures'].includes(argument)) {
			if (modeWasSet) throw new Error('choose exactly one mode');
			mode = /** @type {SeedMode} */ (argument.slice(2));
			modeWasSet = true;
			continue;
		}
		if (argument === '--base-url') {
			const nextValue = argv[index + 1];
			if (!nextValue) throw new Error('--base-url requires a value');
			baseUrl = nextValue;
			index += 1;
			continue;
		}
		if (argument.startsWith('--base-url=')) {
			baseUrl = argument.slice('--base-url='.length);
			if (!baseUrl) throw new Error('--base-url requires a value');
			continue;
		}
		throw new Error(`unknown argument: ${argument}`);
	}

	return { help: false, mode, baseUrl: validateBaseUrl(baseUrl) };
}

/** @param {string} value */
function validateBaseUrl(value) {
	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error('API base URL is invalid');
	}
	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw new Error('API base URL must use http or https');
	}
	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new Error('API base URL must not contain credentials, a query, or a fragment');
	}
	parsed.pathname = parsed.pathname.replace(/\/+$/, '');
	return parsed.toString().replace(/\/$/, '');
}

/**
 * @param {string} source
 * @returns {Partial<Record<'ADMIN_USERNAME' | 'ADMIN_PASSWORD', string>>}
 */
function parseSelectedEnv(source) {
	/** @type {Partial<Record<'ADMIN_USERNAME' | 'ADMIN_PASSWORD', string>>} */
	const selected = {};
	for (const line of source.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const candidate = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
		const separator = candidate.indexOf('=');
		if (separator < 1) continue;
		const key = candidate.slice(0, separator).trim();
		if (key !== 'ADMIN_USERNAME' && key !== 'ADMIN_PASSWORD') continue;
		let value = candidate.slice(separator + 1).trim();
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1);
		}
		selected[key] = value;
	}
	return selected;
}

/** @returns {AdminCredentials} */
function loadAdminCredentials() {
	/** @type {Partial<Record<'ADMIN_USERNAME' | 'ADMIN_PASSWORD', string>>} */
	let fromFile = {};
	const envFile = join(backendDir, '.env');
	if ((!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) && existsSync(envFile)) {
		fromFile = parseSelectedEnv(readFileSync(envFile, 'utf8'));
	}
	const username = process.env.ADMIN_USERNAME || fromFile.ADMIN_USERNAME;
	const password = process.env.ADMIN_PASSWORD || fromFile.ADMIN_PASSWORD;
	if (!username || !password) {
		throw new Error(
			`admin credentials are missing; set ADMIN_USERNAME and ADMIN_PASSWORD or add them to ${backendDir}\\.env`
		);
	}
	return { username, password };
}

/** @param {unknown} value */
function normalizeDecimal(value) {
	const text = String(value);
	if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`invalid decimal returned by API: ${text}`);
	const [whole, fraction = ''] = text.split('.');
	const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
	const normalizedFraction = fraction.replace(/0+$/, '');
	return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

/**
 * @template {{ name: string }} T
 * @param {T[]} items
 * @param {string} kind
 * @returns {Map<string, T>}
 */
function indexUniqueByName(items, kind) {
	if (!Array.isArray(items)) throw new Error(`${kind} response is not an array`);
	const indexed = new Map();
	for (const item of items) {
		if (!item || typeof item.name !== 'string')
			throw new Error(`${kind} response contains an invalid item`);
		if (indexed.has(item.name))
			throw new Error(`${kind} response contains duplicate name ${item.name}`);
		indexed.set(item.name, item);
	}
	return indexed;
}

/**
 * @param {string} label
 * @param {unknown} actual
 * @param {unknown} expected
 */
function assertSame(label, actual, expected) {
	if (actual !== expected) {
		throw new Error(`${label} conflicts with the demo seed (expected ${JSON.stringify(expected)})`);
	}
}

/**
 * @param {unknown} roleId
 * @returns {string}
 */
function rolePermissionPath(roleId) {
	if (typeof roleId !== 'number' || !Number.isInteger(roleId) || roleId <= 0) {
		throw new Error('CUSTOMER role does not have a valid numeric role_id');
	}
	return `/roles/${roleId}/set_permission`;
}

/** @param {ApiProduct} product */
function categoryNames(product) {
	if (product.categories == null) return [];
	if (!Array.isArray(product.categories))
		throw new Error(`product ${product.name} has invalid categories`);
	return product.categories.map((category) => {
		if (!category || typeof category.name !== 'string') {
			throw new Error(`product ${product.name} has an invalid category`);
		}
		return category.name;
	});
}

/**
 * @param {Snapshot} snapshot
 * @returns {SeedPlan}
 */
function buildPlan(snapshot) {
	const rolesByName = indexUniqueByName(snapshot.roles, 'roles');
	const categoriesByName = indexUniqueByName(snapshot.categories, 'categories');
	const productsByName = indexUniqueByName(snapshot.products, 'products');
	/** @type {SeedPlan} */
	const plan = {
		createRole: false,
		setRolePermission: false,
		customerRoleId: null,
		categories: [],
		products: [],
		associations: [],
		images: []
	};

	const role = rolesByName.get(CUSTOMER_ROLE.name);
	if (!role) {
		plan.createRole = true;
		plan.setRolePermission = true;
	} else {
		assertSame('CUSTOMER role description', role.description ?? null, CUSTOMER_ROLE.description);
		if (!Array.isArray(role.permissions)) throw new Error('CUSTOMER role permissions are invalid');
		const permissions = [...role.permissions].sort();
		// Role creation omits the SET column, so MySQL temporarily supplies its
		// schema default READ until this second, resumable API step sets WRITE.
		const isUnconfigured =
			permissions.length === 0 || (permissions.length === 1 && permissions[0] === 'READ');
		if (isUnconfigured) {
			rolePermissionPath(role.role_id);
			plan.setRolePermission = true;
			plan.customerRoleId = Number(role.role_id);
		} else {
			assertSame(
				'CUSTOMER role permissions',
				permissions.join(','),
				CUSTOMER_ROLE.permissions.join(',')
			);
		}
	}

	for (const expected of CATEGORIES) {
		const actual = categoriesByName.get(expected.name);
		if (!actual) {
			plan.categories.push(expected);
			continue;
		}
		assertSame(
			`${expected.name} category description`,
			actual.description ?? null,
			expected.description
		);
	}

	for (const expected of PRODUCTS) {
		const actual = productsByName.get(expected.name);
		if (!actual) {
			plan.products.push(expected);
			plan.images.push(expected);
			continue;
		}
		assertSame(`${expected.name} description`, actual.description ?? null, expected.description);
		assertSame(
			`${expected.name} price`,
			normalizeDecimal(actual.price),
			normalizeDecimal(expected.price)
		);
		const actualCategories = new Set(categoryNames(actual));
		const expectedCategories = new Set(expected.categories);
		const unexpected = [...actualCategories].filter((name) => !expectedCategories.has(name));
		if (unexpected.length) {
			throw new Error(
				`${expected.name} has unexpected category associations: ${unexpected.join(', ')}`
			);
		}
		for (const category of expected.categories) {
			if (!actualCategories.has(category)) {
				plan.associations.push({ category, product: expected.name });
			}
		}
		if (!actual.product_image_uri) plan.images.push(expected);
	}

	return plan;
}

function validateFixtures() {
	for (const product of PRODUCTS) {
		const path = join(fixtureDir, product.fixture);
		if (!existsSync(path))
			throw new Error(`missing fixture: scripts/fixtures/menu/${product.fixture}`);
		const size = statSync(path).size;
		if (size <= 8 || size > MAX_IMAGE_BYTES) {
			throw new Error(`${product.fixture} must be a non-empty PNG smaller than 2 MiB`);
		}
		const signature = readFileSync(path).subarray(0, 8);
		if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
			throw new Error(`${product.fixture} is not a PNG`);
		}
	}
	info(`validated ${PRODUCTS.length} PNG fixtures (each under 2 MiB)`);
}

/**
 * @param {string} baseUrl
 * @param {TokenRef} token
 * @returns {ApiClient}
 */
function createClient(baseUrl, token) {
	/**
	 * @param {string} path
	 * @param {RequestOptions} [options]
	 * @returns {Promise<any>}
	 */
	async function request(
		path,
		{ method = 'GET', json, body, expected = [200], auth = false } = {}
	) {
		/** @type {Record<string, string>} */
		const headers = { Accept: 'application/json' };
		if (json !== undefined) headers['Content-Type'] = 'application/json';
		if (auth) {
			if (!token.value) throw new Error('authenticated request attempted before login');
			headers.Authorization = `Bearer ${token.value}`;
		}
		let response;
		try {
			response = await fetch(`${baseUrl}${path}`, {
				method,
				headers,
				body: json === undefined ? body : JSON.stringify(json),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
		} catch (error) {
			throw new Error(
				`${method} ${path} failed: ${error instanceof Error ? error.message : 'network error'}`,
				{ cause: error }
			);
		}
		if (!expected.includes(response.status)) {
			throw new Error(`${method} ${path} returned HTTP ${response.status}`);
		}
		const text = await response.text();
		if (!text) return null;
		const contentType = response.headers.get('content-type') || '';
		if (!contentType.includes('application/json')) return text;
		try {
			return JSON.parse(text);
		} catch {
			throw new Error(`${method} ${path} returned invalid JSON`);
		}
	}

	return { request };
}

/**
 * @param {ApiClient} client
 * @param {AdminCredentials} credentials
 * @param {TokenRef} token
 */
async function login(client, credentials, token) {
	const result = await client.request('/auth/login', {
		method: 'POST',
		json: credentials,
		expected: [200]
	});
	if (!result || typeof result.token !== 'string' || !result.token) {
		throw new Error('login response did not contain a token');
	}
	token.value = result.token;
	info('admin authentication succeeded');
}

/**
 * @param {ApiClient} client
 * @returns {Promise<Snapshot>}
 */
async function readSnapshot(client) {
	const [roles, categories, products] = await Promise.all([
		client.request('/roles', { auth: true }),
		client.request('/categories'),
		client.request('/products')
	]);
	return { roles, categories, products };
}

/** @param {SeedPlan} plan */
function planCount(plan) {
	return (
		Number(plan.createRole) +
		Number(plan.setRolePermission) +
		plan.categories.length +
		plan.products.length +
		plan.associations.length +
		plan.images.length
	);
}

/** @param {SeedPlan} plan */
function reportPlan(plan) {
	if (plan.createRole) info('would create CUSTOMER role');
	if (plan.setRolePermission) info('would set CUSTOMER permission to WRITE');
	for (const category of plan.categories) info(`would create category: ${category.name}`);
	for (const product of plan.products) info(`would create product: ${product.name}`);
	for (const association of plan.associations) {
		info(`would associate ${association.product} with ${association.category}`);
	}
	for (const product of plan.images) info(`would upload image: ${product.name}`);
	if (planCount(plan) === 0) info('demo seed is already complete');
}

/**
 * @param {ApiClient} client
 * @param {SeedPlan} initialPlan
 */
async function applyPlan(client, initialPlan) {
	if (initialPlan.createRole) {
		await client.request('/roles/create', {
			method: 'POST',
			auth: true,
			json: { name: CUSTOMER_ROLE.name, description: CUSTOMER_ROLE.description },
			expected: [201]
		});
		info('created CUSTOMER role');
	}
	if (initialPlan.setRolePermission) {
		const roleSnapshot = await readSnapshot(client);
		const rolePlan = buildPlan(roleSnapshot);
		if (rolePlan.createRole) throw new Error('API did not persist the newly created CUSTOMER role');
		if (rolePlan.setRolePermission) {
			await client.request(rolePermissionPath(rolePlan.customerRoleId), {
				method: 'POST',
				auth: true,
				json: { permission: 'WRITE' },
				expected: [200]
			});
			info('set CUSTOMER permission to WRITE');
		}
	}
	for (const category of initialPlan.categories) {
		await client.request('/categories', {
			method: 'POST',
			auth: true,
			json: category,
			expected: [201]
		});
		info(`created category: ${category.name}`);
	}
	for (const product of initialPlan.products) {
		await client.request('/products', {
			method: 'POST',
			auth: true,
			json: {
				name: product.name,
				description: product.description,
				price: product.price,
				categories: product.categories
			},
			expected: [201]
		});
		info(`created product: ${product.name}`);
	}

	let snapshot = await readSnapshot(client);
	let remaining = buildPlan(snapshot);
	if (
		remaining.createRole ||
		remaining.setRolePermission ||
		remaining.categories.length ||
		remaining.products.length
	) {
		throw new Error('API did not persist all newly created core records as expected');
	}
	for (const association of remaining.associations) {
		await client.request('/categories/product', {
			method: 'POST',
			auth: true,
			json: association,
			expected: [201]
		});
		info(`associated ${association.product} with ${association.category}`);
	}

	if (remaining.associations.length) snapshot = await readSnapshot(client);
	remaining = buildPlan(snapshot);
	if (remaining.associations.length) {
		throw new Error('API did not persist all category associations as expected');
	}
	const productsByName = indexUniqueByName(snapshot.products, 'products');
	for (const product of remaining.images) {
		const actual = productsByName.get(product.name);
		if (!actual || !Number.isInteger(actual.product_id)) {
			throw new Error(`API did not return a numeric product_id for ${product.name}`);
		}
		const bytes = readFileSync(join(fixtureDir, product.fixture));
		const form = new FormData();
		form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), product.fixture);
		await client.request(`/products/${actual.product_id}/image`, {
			method: 'POST',
			auth: true,
			body: form,
			expected: [200]
		});
		info(`uploaded image: ${product.name}`);
	}
}

/**
 * Validate the public image locations before any object fetch. Error messages
 * deliberately identify only the product, never the URL or its SAS query.
 *
 * @param {ApiProduct[]} products
 * @returns {{ product: SeedProduct, url: URL }[]}
 */
function validateSasImageUrls(products) {
	const productsByName = indexUniqueByName(products, 'products');
	const seenObjects = new Set();
	const validated = [];
	for (const expected of PRODUCTS) {
		const actual = productsByName.get(expected.name);
		if (!actual || !actual.product_image_uri)
			throw new Error(`${expected.name} has no product image`);
		let imageUrl;
		try {
			imageUrl = new URL(actual.product_image_uri);
		} catch {
			throw new Error(`${expected.name} image is not an absolute object-storage URL`);
		}
		if (imageUrl.protocol !== 'https:') {
			throw new Error(`${expected.name} image does not use HTTPS`);
		}
		const hostname = imageUrl.hostname.toLowerCase();
		const azureBlobSuffix = '.blob.core.windows.net';
		if (!hostname.endsWith(azureBlobSuffix) || hostname.length === azureBlobSuffix.length) {
			throw new Error(`${expected.name} image is not hosted by Azure Blob Storage`);
		}
		let decodedPath;
		try {
			decodedPath = decodeURIComponent(imageUrl.pathname).normalize('NFC');
		} catch {
			throw new Error(`${expected.name} image has an invalid object path`);
		}
		const pathSegments = decodedPath.split('/');
		if (
			pathSegments.length !== 4 ||
			pathSegments[0] !== '' ||
			!pathSegments[1] ||
			pathSegments[2] !== 'products' ||
			!pathSegments[3]
		) {
			throw new Error(`${expected.name} image does not use a container/products/object path`);
		}
		if (!imageUrl.searchParams.get('sig')) {
			throw new Error(`${expected.name} image is not a SAS-hosted object`);
		}
		const objectIdentity = `${hostname}${decodedPath}`;
		if (seenObjects.has(objectIdentity)) {
			throw new Error(`${expected.name} reuses another product image object`);
		}
		seenObjects.add(objectIdentity);
		validated.push({ product: expected, url: imageUrl });
	}
	return validated;
}

/** @param {ApiProduct[]} products */
async function verifyImages(products) {
	for (const { product, url } of validateSasImageUrls(products)) {
		let response;
		try {
			response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		} catch (error) {
			throw new Error(
				`${product.name} image fetch failed: ${error instanceof Error ? error.message : 'network error'}`,
				{ cause: error }
			);
		}
		if (!response.ok) throw new Error(`${product.name} image returned HTTP ${response.status}`);
		const contentType = response.headers.get('content-type') || '';
		if (!contentType.toLowerCase().startsWith('image/')) {
			throw new Error(`${product.name} object did not return an image content type`);
		}
		const bytes = await response.arrayBuffer();
		if (bytes.byteLength === 0) throw new Error(`${product.name} image object is empty`);
		info(`verified SAS-hosted image: ${product.name}`);
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		usage();
		return;
	}
	validateFixtures();
	if (options.mode === 'check-fixtures') return;

	const credentials = loadAdminCredentials();
	const token = { value: null };
	const client = createClient(options.baseUrl, token);
	info(`API: ${options.baseUrl}`);
	await login(client, credentials, token);

	let snapshot = await readSnapshot(client);
	let plan = buildPlan(snapshot);
	if (options.mode === 'dry-run') {
		reportPlan(plan);
		if (planCount(plan) === 0) await verifyImages(snapshot.products);
		info('dry-run complete; no writes were made');
		return;
	}
	if (options.mode === 'verify-only') {
		if (planCount(plan) !== 0) {
			reportPlan(plan);
			throw new Error('demo seed is incomplete');
		}
		await verifyImages(snapshot.products);
		info('verification complete; no writes were made');
		return;
	}

	await applyPlan(client, plan);
	snapshot = await readSnapshot(client);
	plan = buildPlan(snapshot);
	if (planCount(plan) !== 0) throw new Error('seed apply finished with unresolved changes');
	await verifyImages(snapshot.products);
	info('demo API and object-storage seed is complete');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	main().catch((error) => {
		console.error(
			`[seed_demo_api] ERROR: ${error instanceof Error ? error.message : 'unknown error'}`
		);
		process.exitCode = 1;
	});
}

export {
	buildPlan,
	normalizeDecimal,
	parseArgs,
	parseSelectedEnv,
	rolePermissionPath,
	validateBaseUrl,
	validateSasImageUrls
};
