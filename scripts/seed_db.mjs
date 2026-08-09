#!/usr/bin/env node
/**
 * scripts/seed_db.mjs — non-destructive demo seed for the Arrow Server MySQL database.
 *
 * Pipeline:
 *   1. Resolve the sibling backend workspace (`../arrow_server`) and load
 *      `DATABASE_URL` (process env first, then that repo's `.env`).
 *   2. Verify the `mysql` client is available and the server is reachable;
 *      create the database when it does not exist yet.
 *   3. Run the backend migrations from `src/data/migrations` — via the diesel
 *      CLI when installed (the backend's documented flow), otherwise by
 *      applying each `up.sql` directly and recording it in
 *      `__diesel_schema_migrations` so a later `diesel migration run` stays
 *      consistent.
 *   4. Check the complete known seed set (2 roles, 3 categories, 7 products,
 *      and their 7 category assignments). Already complete -> clean no-op.
 *   5. Apply `../arrow_server/seed.sql` ONLY to a fully unseeded database,
 *      then re-verify. A partial or conflicting seed fails clearly instead of
 *      being patched by a second `seed.sql` run — duplicate-key errors are
 *      real failures, never silently swallowed.
 *
 * Safety: never drops, truncates, or deletes anything. No credentials are
 * embedded: connection details come from `DATABASE_URL` (env or
 * `../arrow_server/.env`).
 *
 * Usage:
 *   DATABASE_URL=mysql://user:pass@127.0.0.1:3306/test_db bun run demo:seed
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const backendDir = resolve(repoRoot, '..', 'arrow_server');
const migrationsDir = join(backendDir, 'src', 'data', 'migrations');
const seedFile = join(backendDir, 'seed.sql');

const SEED_ROLES = ['ADMIN', 'CUSTOMER'];
const SEED_CATEGORIES = ['Drinks', 'Burgers', 'Mains'];
const SEED_PRODUCTS = [
	'Espresso',
	'Cappuccino',
	'Fresh Orange Juice',
	'Classic Burger',
	'Double Smash Burger',
	'Grilled Salmon',
	'Lobster Platter'
];
/** Expected product_count per seed category (from seed.sql assignments). */
const SEED_CATEGORY_PRODUCT_COUNTS = { Drinks: 3, Burgers: 2, Mains: 2 };

function info(message) {
	console.log(`[seed_db] ${message}`);
}

function fail(message) {
	console.error(`[seed_db] ERROR: ${message}`);
	process.exit(1);
}

function run(command, args, options = {}) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd ?? repoRoot,
			env: { ...process.env, ...options.env },
			stdio: options.stdin !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('error', (err) => reject(err));
		child.on('close', (code) => {
			if (code === 0) {
				resolvePromise({ stdout, stderr });
			} else {
				const detail = stderr.trim() || stdout.trim();
				reject(new Error(`\`${command}\` exited with code ${code}${detail ? `:\n${detail}` : ''}`));
			}
		});
		if (options.stdin !== undefined) {
			child.stdin.write(options.stdin);
			child.stdin.end();
		}
	});
}

function loadDatabaseUrl() {
	if (process.env.DATABASE_URL) {
		return { url: process.env.DATABASE_URL, source: 'environment' };
	}
	const envFile = join(backendDir, '.env');
	if (existsSync(envFile)) {
		for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
			const eq = trimmed.indexOf('=');
			const key = trimmed.slice(0, eq).trim();
			const value = trimmed
				.slice(eq + 1)
				.trim()
				.replace(/^['"]|['"]$/g, '');
			if (key === 'DATABASE_URL' && value) {
				return { url: value, source: `${backendDir}\\.env` };
			}
		}
	}
	return null;
}

function parseMysqlUrl(databaseUrl) {
	let url;
	try {
		url = new URL(databaseUrl);
	} catch {
		return null;
	}
	if (url.protocol !== 'mysql:') return null;
	const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
	if (!database) return null;
	return {
		host: url.hostname || '127.0.0.1',
		port: url.port || '3306',
		user: decodeURIComponent(url.username),
		password: url.password ? decodeURIComponent(url.password) : null,
		database
	};
}

function mysqlEnv(conn) {
	return conn.password ? { MYSQL_PWD: conn.password } : {};
}

function mysqlBaseArgs(conn) {
	return [
		'--host',
		conn.host,
		'--port',
		conn.port,
		'--user',
		conn.user,
		'--batch',
		'--skip-column-names'
	];
}

async function mysqlQuery(conn, sql) {
	const { stdout } = await run(
		'mysql',
		[...mysqlBaseArgs(conn), '--database', conn.database, '-e', sql],
		{
			env: mysqlEnv(conn)
		}
	);
	return stdout
		.split(/\r?\n/)
		.filter((line) => line.length > 0)
		.map((line) => line.split('\t'));
}

async function applySqlFile(conn, file, label) {
	const sql = readFileSync(file, 'utf8');
	info(`applying ${label}...`);
	await run('mysql', [...mysqlBaseArgs(conn), '--database', conn.database], {
		env: mysqlEnv(conn),
		stdin: sql
	});
}

async function applyMigrations(conn, databaseUrl) {
	let dieselAvailable = true;
	try {
		await run('diesel', ['--version']);
	} catch (err) {
		if (err.code !== 'ENOENT') throw err;
		dieselAvailable = false;
	}

	if (dieselAvailable) {
		info('running backend migrations via diesel CLI...');
		await run('diesel', ['migration', 'run'], {
			cwd: backendDir,
			env: { DATABASE_URL: databaseUrl }
		});
		info('migrations are up to date');
		return;
	}

	info('diesel CLI not found — applying migrations directly via mysql');
	if (!existsSync(migrationsDir)) {
		fail(
			`backend migrations directory not found: ${migrationsDir}. ` +
				`Expected the sibling backend repository at ${backendDir}.`
		);
	}
	await run(
		'mysql',
		[
			...mysqlBaseArgs(conn),
			'--database',
			conn.database,
			'-e',
			`CREATE TABLE IF NOT EXISTS __diesel_schema_migrations (` +
				`version VARCHAR(50) PRIMARY KEY NOT NULL, ` +
				`run_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`
		],
		{ env: mysqlEnv(conn) }
	);
	const appliedRows = await mysqlQuery(conn, 'SELECT version FROM __diesel_schema_migrations');
	const applied = new Set(appliedRows.map((row) => row[0]));
	const migrations = readdirSync(migrationsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	let appliedCount = 0;
	for (const name of migrations) {
		const upFile = join(migrationsDir, name, 'up.sql');
		if (!existsSync(upFile)) continue;
		if (applied.has(name)) continue;
		await applySqlFile(conn, upFile, `migration ${name}`);
		await run(
			'mysql',
			[
				...mysqlBaseArgs(conn),
				'--database',
				conn.database,
				'-e',
				`INSERT INTO __diesel_schema_migrations (version) VALUES ('${name.replace(/'/g, "''")}')`
			],
			{ env: mysqlEnv(conn) }
		);
		appliedCount += 1;
	}
	info(
		appliedCount === 0
			? 'migrations are up to date'
			: `applied ${appliedCount} pending migration(s)`
	);
}

async function readSeedState(conn) {
	const roleNames = (await mysqlQuery(conn, 'SELECT name FROM roles')).map((row) => row[0]);
	const categoryNames = (await mysqlQuery(conn, 'SELECT name FROM categories')).map(
		(row) => row[0]
	);
	const productNames = (await mysqlQuery(conn, 'SELECT name FROM products')).map((row) => row[0]);
	const assignmentRows = await mysqlQuery(
		conn,
		`SELECT c.name, COUNT(pc.product_id) FROM categories c ` +
			`LEFT JOIN product_categories pc ON pc.category_id = c.category_id ` +
			`WHERE c.name IN ('Drinks','Burgers','Mains') GROUP BY c.name`
	);
	const assignments = new Map(assignmentRows.map((row) => [row[0], Number(row[1])]));
	return { roleNames, categoryNames, productNames, assignments };
}

function seedDeficits(state) {
	const missingRoles = SEED_ROLES.filter((name) => !state.roleNames.includes(name));
	const missingCategories = SEED_CATEGORIES.filter((name) => !state.categoryNames.includes(name));
	const missingProducts = SEED_PRODUCTS.filter((name) => !state.productNames.includes(name));
	const missingAssignments = SEED_CATEGORIES.filter(
		(name) => (state.assignments.get(name) ?? 0) < SEED_CATEGORY_PRODUCT_COUNTS[name]
	);
	return { missingRoles, missingCategories, missingProducts, missingAssignments };
}

function isSeedComplete(state) {
	const deficits = seedDeficits(state);
	return (
		deficits.missingRoles.length === 0 &&
		deficits.missingCategories.length === 0 &&
		deficits.missingProducts.length === 0 &&
		deficits.missingAssignments.length === 0
	);
}

function isUnseeded(state) {
	return (
		state.roleNames.length === 0 &&
		state.categoryNames.length === 0 &&
		state.productNames.length === 0
	);
}

function describeDeficits(deficits) {
	const parts = [];
	if (deficits.missingRoles.length) parts.push(`roles: ${deficits.missingRoles.join(', ')}`);
	if (deficits.missingCategories.length)
		parts.push(`categories: ${deficits.missingCategories.join(', ')}`);
	if (deficits.missingProducts.length)
		parts.push(`products: ${deficits.missingProducts.join(', ')}`);
	if (deficits.missingAssignments.length)
		parts.push(`category assignments: ${deficits.missingAssignments.join(', ')}`);
	return parts.join('; ');
}

async function main() {
	info(`backend workspace: ${backendDir}`);
	if (!existsSync(join(backendDir, 'seed.sql'))) {
		fail(
			`sibling backend repository not found at ${backendDir}. Clone arrow_server next to this repo.`
		);
	}

	const source = loadDatabaseUrl();
	if (!source) {
		fail(
			'DATABASE_URL is not set. Provide it in the environment or in ' +
				`${backendDir}\\.env (see the backend .env.example). ` +
				'Example: DATABASE_URL=mysql://user:pass@127.0.0.1:3306/test_db bun run demo:seed'
		);
	}
	const conn = parseMysqlUrl(source.url);
	if (!conn) {
		fail(`DATABASE_URL is not a valid mysql:// URL (source: ${source.source})`);
	}

	info(`database: ${conn.user}@${conn.host}:${conn.port}/${conn.database}`);

	try {
		await run('mysql', ['--version']);
	} catch {
		fail(
			'the mysql client is not available on PATH. Install it (see the backend README prerequisites) and retry.'
		);
	}

	try {
		await run('mysql', [...mysqlBaseArgs(conn), '-e', 'SELECT 1'], { env: mysqlEnv(conn) });
	} catch (err) {
		fail(`cannot reach MySQL at ${conn.host}:${conn.port}: ${err.message}`);
	}
	info('MySQL connection OK');

	const escapedDatabase = conn.database.replace(/`/g, '``');
	await run(
		'mysql',
		[...mysqlBaseArgs(conn), '-e', `CREATE DATABASE IF NOT EXISTS \`${escapedDatabase}\``],
		{ env: mysqlEnv(conn) }
	);
	info(`database \`${conn.database}\` is present`);

	await applyMigrations(conn, source.url);

	let state;
	try {
		state = await readSeedState(conn);
	} catch (err) {
		fail(`could not read seed state after migrations: ${err.message}`);
	}

	if (isSeedComplete(state)) {
		info(
			`seed already complete (${SEED_ROLES.length} roles, ${SEED_CATEGORIES.length} categories, ` +
				`${SEED_PRODUCTS.length} products, 7 assignments) — nothing to do`
		);
		return;
	}

	if (!isUnseeded(state)) {
		fail(
			'database is partially or conflictingly seeded; refusing to apply seed.sql. ' +
				`Missing: ${describeDeficits(seedDeficits(state))}. ` +
				'Finish the seed manually (mysql < seed.sql) or start from a fresh database.'
		);
	}

	if (!existsSync(seedFile)) {
		fail(`seed.sql not found at ${seedFile}`);
	}
	await applySqlFile(conn, seedFile, seedFile);
	state = await readSeedState(conn);
	if (!isSeedComplete(state)) {
		fail(
			`seed.sql applied but the seed is still incomplete. Missing: ${describeDeficits(seedDeficits(state))}.`
		);
	}
	info(
		`demo seed complete (${SEED_ROLES.length} roles, ${SEED_CATEGORIES.length} categories, ` +
			`${SEED_PRODUCTS.length} products, 7 assignments)`
	);
}

main().catch((err) => fail(err.message));
