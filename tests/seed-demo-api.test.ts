import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildPlan,
	createClient,
	imageFetchError,
	normalizeDecimal,
	parseArgs,
	parseSelectedEnv,
	rolePermissionPath,
	validateBaseUrl,
	validateSasImageUrls,
	verifyImageResponse,
	verifyImages
} from '../scripts/seed_demo_api.mjs';

const seedProductNames = [
	'Espresso',
	'Cappuccino',
	'Fresh Orange Juice',
	'Classic Burger',
	'Double Smash Burger',
	'Grilled Salmon',
	'Lobster Platter'
];

function productsWithDistinctSasUrls() {
	return seedProductNames.map((name, index) => ({
		name,
		price: '1.00',
		product_image_uri:
			`https://demo.blob.core.windows.net/menu/products/object-${index}.png` +
			`?sv=2024-11-04&sp=r&sig=test-${index}`
	}));
}

describe('demo API seed safety helpers', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('defaults to a non-mutating dry run', () => {
		vi.stubEnv('SEED_API_BASE_URL', '');
		expect(parseArgs([])).toEqual({
			help: false,
			mode: 'dry-run',
			baseUrl: 'http://127.0.0.1:3000/api/v1',
			repairCustomerRole: false
		});
	});

	it('selects only the two admin credential keys from dotenv content', () => {
		expect(
			parseSelectedEnv(`
DATABASE_URL=mysql://not-selected
ADMIN_USERNAME="counter"
JWT_SECRET=not-selected
export ADMIN_PASSWORD='safe=value'
`)
		).toEqual({ ADMIN_USERNAME: 'counter', ADMIN_PASSWORD: 'safe=value' });
	});

	it('normalizes equivalent decimal strings without floating-point conversion', () => {
		expect(normalizeDecimal('003.5000')).toBe('3.5');
		expect(normalizeDecimal('550.00')).toBe('550');
		expect(() => normalizeDecimal('3.5 PHP')).toThrow('invalid decimal');
	});

	it('requires the exact API root and secure transport away from loopback', () => {
		expect(validateBaseUrl('http://localhost:3000/api/v1')).toBe('http://localhost:3000/api/v1');
		expect(validateBaseUrl('http://127.0.0.1:3000/api/v1')).toBe('http://127.0.0.1:3000/api/v1');
		expect(validateBaseUrl('http://[::1]:3000/api/v1')).toBe('http://[::1]:3000/api/v1');
		expect(validateBaseUrl('https://api.example.test/api/v1')).toBe(
			'https://api.example.test/api/v1'
		);
		expect(() => validateBaseUrl('http://api.example.test/api/v1')).toThrow(
			'must use HTTPS unless its host is loopback'
		);
		expect(() => validateBaseUrl('https://api.example.test/api/v1/')).toThrow(
			'path must be exactly /api/v1'
		);
		expect(() => validateBaseUrl('https://api.example.test/other')).toThrow(
			'path must be exactly /api/v1'
		);
		expect(() => validateBaseUrl('https://user:secret@example.test/api/v1')).toThrow(
			'must not contain credentials'
		);
		expect(() => validateBaseUrl('https://example.test/api/v1?sig=secret')).toThrow(
			'must not contain credentials'
		);
	});

	it('plans all missing records without writes and fails on role conflicts', () => {
		const plan = buildPlan({ roles: [], categories: [], products: [] });
		expect(plan.createRole).toBe(true);
		expect(plan.setRolePermission).toBe(true);
		expect(plan.categories).toHaveLength(3);
		expect(plan.products).toHaveLength(7);
		expect(plan.images).toHaveLength(7);

		expect(() =>
			buildPlan({
				roles: [
					{
						name: 'CUSTOMER',
						description: 'Unexpected role',
						permissions: ['WRITE']
					}
				],
				categories: [],
				products: []
			})
		).toThrow('CUSTOMER role description conflicts');
	});

	it('requires explicit opt-in to repair a pre-existing CUSTOMER permission', () => {
		const snapshot = {
			roles: [
				{
					role_id: 42,
					name: 'CUSTOMER',
					description: 'Regular customer: can browse the menu and place orders',
					permissions: ['READ']
				}
			],
			categories: [],
			products: []
		};
		expect(() => buildPlan(snapshot)).toThrow('--repair-customer-role');
		const plan = buildPlan(snapshot, true);

		expect(plan.createRole).toBe(false);
		expect(plan.setRolePermission).toBe(true);
		expect(plan.customerRoleId).toBe(42);
		expect(rolePermissionPath(plan.customerRoleId)).toBe('/roles/42/set_permission');
		expect(() => rolePermissionPath('CUSTOMER')).toThrow('valid numeric role_id');
		expect(parseArgs(['--apply', '--repair-customer-role']).repairCustomerRole).toBe(true);
	});

	it('preserves an existing product image instead of overwriting it', () => {
		const plan = buildPlan({
			roles: [],
			categories: [],
			products: [
				{
					product_id: 1,
					name: 'Espresso',
					description: 'Single shot of freshly pulled espresso',
					price: '3.50',
					product_image_uri:
						'https://demo.blob.core.windows.net/menu/products/existing.png?sig=secret',
					categories: [{ name: 'Drinks' }]
				}
			]
		});
		expect(plan.images.map((product) => product.name)).not.toContain('Espresso');
	});

	it('accepts distinct HTTPS Azure product object locations', () => {
		expect(validateSasImageUrls(productsWithDistinctSasUrls())).toHaveLength(7);
	});

	it('rejects non-Azure hosts and unexpected object paths', () => {
		const wrongHost = productsWithDistinctSasUrls();
		wrongHost[0].product_image_uri =
			'https://objects.example.test/menu/products/espresso.png?sig=secret';
		expect(() => validateSasImageUrls(wrongHost)).toThrow('not hosted by Azure Blob Storage');

		const wrongPath = productsWithDistinctSasUrls();
		wrongPath[0].product_image_uri =
			'https://demo.blob.core.windows.net/menu/images/espresso.png?sig=secret';
		expect(() => validateSasImageUrls(wrongPath)).toThrow(
			'does not use a container/products/object path'
		);
	});

	it('rejects duplicate normalized Azure host and object paths', () => {
		const products = productsWithDistinctSasUrls();
		products[1].product_image_uri =
			'https://DEMO.blob.core.windows.net/menu/products/object-0.png?sig=different-secret';
		expect(() => validateSasImageUrls(products)).toThrow('reuses another product image object');
	});

	it('uses redirect-error mode for API and object fetches', async () => {
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
			void args;
			return new Response(png, {
				status: 200,
				headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.byteLength) }
			});
		});
		vi.stubGlobal('fetch', fetchMock);
		await createClient('https://api.example.test/api/v1', { value: null }).request('/categories');
		await verifyImages(productsWithDistinctSasUrls());

		expect(fetchMock).toHaveBeenCalledTimes(8);
		for (const [, options] of fetchMock.mock.calls) {
			expect(options).toEqual(expect.objectContaining({ redirect: 'error' }));
		}
	});

	it('redacts image fetch failure details and retains only a programmatic cause', () => {
		const cause = new Error(
			'https://demo.blob.core.windows.net/menu/products/object.png?sig=secret-value'
		);
		const error = imageFetchError('Espresso', cause);
		expect(error.message).toBe('Espresso image fetch failed');
		expect(error.message).not.toContain('sig=');
		expect(error.cause).toBe(cause);
	});

	it('validates bounded image bytes and rejects declared or streamed overflow', async () => {
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		await expect(
			verifyImageResponse(
				new Response(png, {
					headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.byteLength) }
				}),
				'Espresso'
			)
		).resolves.toBeUndefined();

		await expect(
			verifyImageResponse(
				new Response(png, {
					headers: { 'Content-Type': 'image/png', 'Content-Length': String(2 * 1024 * 1024 + 1) }
				}),
				'Espresso'
			)
		).rejects.toThrow('exceeds the 2 MiB');

		const oversizedStream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(2 * 1024 * 1024));
				controller.enqueue(new Uint8Array([0]));
				controller.close();
			}
		});
		await expect(
			verifyImageResponse(
				new Response(oversizedStream, { headers: { 'Content-Type': 'image/png' } }),
				'Espresso'
			)
		).rejects.toThrow('exceeds the 2 MiB');
	});

	it('redacts stream read and cancel transport failures', async () => {
		const readFailure = new Error('read failed for ?sig=secret-read');
		const failingRead = new ReadableStream<Uint8Array>({
			pull() {
				throw readFailure;
			}
		});
		const readError = await verifyImageResponse(
			new Response(failingRead, { headers: { 'Content-Type': 'image/png' } }),
			'Espresso'
		).then(
			() => null,
			(error: unknown) => error
		);
		expect(readError).toBeInstanceOf(Error);
		expect(readError).toMatchObject({
			message: 'Espresso image stream failed',
			cause: readFailure
		});
		expect((readError as Error).message).not.toContain('sig=');

		const cancelFailure = new Error('cancel failed for ?sig=secret-cancel');
		const failingCancel = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
			},
			cancel() {
				throw cancelFailure;
			}
		});
		const cancelError = await verifyImageResponse(
			new Response(failingCancel, { headers: { 'Content-Type': 'image/png' } }),
			'Espresso'
		).then(
			() => null,
			(error: unknown) => error
		);
		expect(cancelError).toBeInstanceOf(Error);
		expect(cancelError).toMatchObject({
			message: 'Espresso image exceeds the 2 MiB verification limit',
			cause: cancelFailure
		});
		expect((cancelError as Error).message).not.toContain('sig=');
	});

	it('rejects image content-type and magic-byte mismatches', async () => {
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
		await expect(
			verifyImageResponse(
				new Response(jpeg, { headers: { 'Content-Type': 'image/png' } }),
				'Espresso'
			)
		).rejects.toThrow('do not match the declared content type');
	});
});
