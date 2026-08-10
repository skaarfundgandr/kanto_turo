import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildPlan,
	normalizeDecimal,
	parseArgs,
	parseSelectedEnv,
	rolePermissionPath,
	validateBaseUrl,
	validateSasImageUrls
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
	afterEach(() => vi.unstubAllEnvs());

	it('defaults to a non-mutating dry run', () => {
		vi.stubEnv('SEED_API_BASE_URL', '');
		expect(parseArgs([])).toEqual({
			help: false,
			mode: 'dry-run',
			baseUrl: 'http://127.0.0.1:3000/api/v1'
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

	it('rejects base URLs that could expose credentials or query tokens', () => {
		expect(validateBaseUrl('http://localhost:3000/api/v1/')).toBe('http://localhost:3000/api/v1');
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

	it('repairs the default CUSTOMER permission through the numeric role endpoint', () => {
		const plan = buildPlan({
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
		});

		expect(plan.createRole).toBe(false);
		expect(plan.setRolePermission).toBe(true);
		expect(plan.customerRoleId).toBe(42);
		expect(rolePermissionPath(plan.customerRoleId)).toBe('/roles/42/set_permission');
		expect(() => rolePermissionPath('CUSTOMER')).toThrow('valid numeric role_id');
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
});
