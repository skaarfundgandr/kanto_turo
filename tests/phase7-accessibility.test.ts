import { cleanup, render, waitFor, within } from '@testing-library/svelte';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order, Product, User } from '../src/lib/api/types';
import { cart } from '../src/lib/stores/cart';
import AdminPage from '../src/routes/admin/+page.svelte';
import CartPage from '../src/routes/cart/+page.svelte';
import CheckoutPage from '../src/routes/checkout/+page.svelte';
import LoginPage from '../src/routes/login/+page.svelte';
import MenuPage from '../src/routes/+page.svelte';
import ReceiptPage from '../src/routes/order/[id]/+page.svelte';

const endpointMocks = vi.hoisted(() => ({
	cancelOrder: vi.fn(),
	createGuestOrder: vi.fn(),
	deleteOrder: vi.fn(),
	getOrderingQr: vi.fn(),
	getProduct: vi.fn(),
	getSignedOrder: vi.fn(),
	listCategories: vi.fn(),
	listCategoryProducts: vi.fn(),
	listOrders: vi.fn(),
	listProducts: vi.fn(),
	login: vi.fn(),
	payOrder: vi.fn(),
	updateOrderStatus: vi.fn(),
	paySignedOrder: vi.fn()
}));

const navigationMocks = vi.hoisted(() => ({
	afterNavigate: vi.fn(),
	base: '/base',
	goto: vi.fn(() => Promise.resolve()),
	page: {
		params: { id: '42' },
		state: {},
		url: new URL('http://localhost/base/')
	},
	replaceState: vi.fn(),
	resolve: vi.fn((path: string) => `/base${path}`)
}));

const authMocks = vi.hoisted(() => {
	type MockState = {
		status: 'loading' | 'authenticated' | 'forbidden' | 'anonymous';
		user: User | null;
	};

	let currentState: MockState = { status: 'anonymous', user: null };
	const listeners = new Set<(state: MockState) => void>();

	return {
		authStore: {
			subscribe(listener: (state: MockState) => void) {
				listeners.add(listener);
				listener(currentState);
				return () => listeners.delete(listener);
			}
		},
		getState: () => currentState,
		initAuth: vi.fn(async () => currentState),
		login: vi.fn(async () => currentState),
		logout: vi.fn(),
		setState(next: MockState): void {
			currentState = next;
			for (const listener of listeners) listener(currentState);
		}
	};
});

vi.mock('$app/navigation', () => ({
	afterNavigate: navigationMocks.afterNavigate,
	goto: navigationMocks.goto,
	replaceState: navigationMocks.replaceState
}));
vi.mock('$app/paths', () => ({ base: navigationMocks.base, resolve: navigationMocks.resolve }));
vi.mock('$app/state', () => ({ page: navigationMocks.page }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$lib/api/endpoints', () => endpointMocks);
vi.mock('$lib/stores/auth', () => authMocks);
vi.mock('qrcode', () => ({
	default: { toDataURL: vi.fn(async () => 'data:image/png;base64,receipt') }
}));

const categories = [
	{
		category_id: 1,
		name: 'Ulam & Rice',
		description: null,
		created_at: null,
		updated_at: null
	}
];

const product: Product = {
	product_id: 1,
	name: 'Chicken adobo',
	description: 'Malinamnam at bagong luto.',
	price: '123.45',
	product_image_uri: null,
	categories
};

const order: Order = {
	order_id: 42,
	user_id: null,
	products: [
		{
			product,
			quantity: 1,
			unit_price: '123.45',
			line_total: '123.45'
		}
	],
	total_amount: '123.45',
	status: 'Pending',
	payment_status: 'unpaid',
	created_at: '2026-08-10 10:00:00',
	updated_at: '2026-08-10 10:00:00'
};

const adminUser: User = {
	user_id: 7,
	username: 'admin',
	role: {
		role_id: 1,
		name: 'Admin',
		description: null,
		permissions: ['ADMIN']
	},
	created_at: null,
	updated_at: null
};

async function expectAccessible(container: HTMLElement): Promise<void> {
	// happy-dom does not calculate rendered colors, so color contrast remains a browser review.
	const result = await axe.run(container, {
		rules: {
			// Isolated route components do not include the full application shell.
			region: { enabled: false },
			// happy-dom cannot calculate the rendered colors needed for this rule.
			'color-contrast': { enabled: false }
		}
	});
	expect(result).toEqual(
		expect.objectContaining({
			incomplete: expect.any(Array),
			passes: expect.any(Array),
			violations: expect.any(Array)
		})
	);
	expect(
		result.passes.length + result.incomplete.length + result.violations.length
	).toBeGreaterThan(0);
	const details = result.violations
		.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`)
		.join('\n');
	expect(result.violations, details).toEqual([]);
}

beforeEach(() => {
	vi.clearAllMocks();
	cart.clear();
	localStorage.clear();
	navigationMocks.page.params = { id: '42' };
	navigationMocks.page.url = new URL('http://localhost/base/');
	authMocks.setState({ status: 'anonymous', user: null });
	endpointMocks.listCategories.mockResolvedValue(categories);
	endpointMocks.listCategoryProducts.mockResolvedValue([product]);
	endpointMocks.listProducts.mockResolvedValue([product]);
	endpointMocks.getProduct.mockResolvedValue(product);
	endpointMocks.getSignedOrder.mockResolvedValue(order);
	endpointMocks.paySignedOrder.mockResolvedValue({
		order_id: 42,
		payment_status: 'paid',
		message: 'Payment successful'
	});
	endpointMocks.listOrders.mockResolvedValue([order]);
	endpointMocks.getOrderingQr.mockResolvedValue(new Blob(['<svg />'], { type: 'image/svg+xml' }));
	authMocks.initAuth.mockResolvedValue({ status: 'anonymous', user: null });
});

afterEach(() => {
	cleanup();
	cart.clear();
	localStorage.clear();
	vi.restoreAllMocks();
});

describe('Phase 7 route accessibility', () => {
	it('audits the menu route and its category/product semantics', async () => {
		const view = render(MenuPage);

		expect(await view.findByRole('heading', { name: /SCAN.*TURO.*KAIN/ })).not.toBeNull();
		expect(await view.findByRole('button', { name: 'Lahat' })).not.toBeNull();
		expect(view.container.querySelector('[aria-labelledby="menu-title"]')).not.toBeNull();
		expect(await view.findByRole('list', { name: 'Mga putahe' })).not.toBeNull();
		await expectAccessible(view.container);
	});

	it('audits the cart route and names quantity/removal controls', async () => {
		cart.addItem(product, 2);
		const view = render(CartPage);

		expect(await view.findByRole('heading', { name: 'Chicken adobo' })).not.toBeNull();
		expect(view.getByRole('group', { name: 'Dami ng Chicken adobo' })).not.toBeNull();
		expect(view.getByRole('button', { name: 'Alisin ang Chicken adobo' })).not.toBeNull();
		await expectAccessible(view.container);
	});

	it('audits the checkout route and exposes a labelled submit form', async () => {
		cart.addItem(product);
		const view = render(CheckoutPage);

		expect(await view.findByRole('button', { name: 'Ipadala ang order' })).not.toBeNull();
		expect(view.container.querySelector('form')).not.toBeNull();
		expect(view.getByText(/presyo at total sa resibo/i)).not.toBeNull();
		await expectAccessible(view.container);
	});

	it('audits the signed receipt route and exposes status/payment announcements', async () => {
		navigationMocks.page.url = new URL(
			'http://localhost/base/order/42?exp=1700000000&sig=sig-value'
		);
		const view = render(ReceiptPage);

		expect(await view.findByText('Order #42')).not.toBeNull();
		expect(view.getByRole('list', { name: 'Progress ng order' })).not.toBeNull();
		expect(view.getByRole('button', { name: 'Bayaran ang order' })).not.toBeNull();
		expect(view.getByRole('button', { name: 'Kopyahin ang link' })).not.toBeNull();
		await expectAccessible(view.container);
	});

	it('audits the login route and preserves explicit form field names', async () => {
		const view = render(LoginPage);

		expect(await view.findByRole('button', { name: 'Pumasok sa kusina' })).not.toBeNull();
		expect(view.getByLabelText('Username')).not.toBeNull();
		expect(view.getByLabelText('Password')).not.toBeNull();
		await expectAccessible(view.container);
	});

	it('audits the authenticated admin route with table headers and named actions', async () => {
		authMocks.setState({ status: 'authenticated', user: adminUser });
		const view = render(AdminPage);

		await waitFor(() =>
			expect(view.container.querySelector('tbody tr[data-order-id="42"]')).not.toBeNull()
		);
		expect(view.getByRole('table')).not.toBeNull();
		expect(view.container.querySelector('th[scope="col"]')).not.toBeNull();
		const desktopLedger = view.getByRole('table');
		expect(
			within(desktopLedger).getByRole('button', { name: /Isulong ang order #42/ })
		).not.toBeNull();
		expect(
			within(desktopLedger).getByRole('button', { name: /Markahang bayad ang order #42/ })
		).not.toBeNull();
		expect(view.getByRole('img', { name: 'QR code para sa general ordering menu' })).not.toBeNull();
		await expectAccessible(view.container);
	});
});
