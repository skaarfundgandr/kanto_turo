import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/errors';
import type { Category, Order, Product, User } from '../src/lib/api/types';
import RootLayout from '../src/routes/+layout.svelte';
import ErrorPage from '../src/routes/+error.svelte';
import AdminLayout from '../src/routes/admin/+layout.svelte';
import AdminPage from '../src/routes/admin/+page.svelte';
import LoginPage from '../src/routes/login/+page.svelte';
import {
	deriveAdminFilterCounts,
	deriveAdminKpis,
	formatAdminDateTime,
	sortOrdersNewestFirst
} from '../src/lib/utils/admin-orders';
import { load as adminLoad } from '../src/routes/admin/+layout';

const navigationMocks = vi.hoisted(() => ({
	goto: vi.fn().mockResolvedValue(undefined),
	replaceState: vi.fn((url: string) => window.history.replaceState(null, '', url)),
	resolve: (path: string) => `/base${path}`,
	page: { url: new URL('http://localhost/base/'), state: {} }
}));

const endpointMocks = vi.hoisted(() => ({
	cancelOrder: vi.fn(),
	createCategory: vi.fn(),
	createProduct: vi.fn(),
	deleteOrder: vi.fn(),
	deleteProductImage: vi.fn(),
	getOrderingQr: vi.fn(),
	listCategories: vi.fn(),
	listOrders: vi.fn(),
	listProducts: vi.fn(),
	login: vi.fn(),
	payOrder: vi.fn(),
	uploadProductImage: vi.fn(),
	updateOrderStatus: vi.fn()
}));

const authMocks = vi.hoisted(() => {
	type MockState = {
		status: 'loading' | 'authenticated' | 'forbidden' | 'anonymous';
		user: User | null;
	};
	let currentState: MockState = { status: 'anonymous', user: null };
	const listeners = new Set<(state: MockState) => void>();
	let redirectHandler: (() => void) | null = null;
	const authStore = {
		subscribe(listener: (state: MockState) => void) {
			listeners.add(listener);
			listener(currentState);
			return () => listeners.delete(listener);
		}
	};
	const setState = (next: MockState): void => {
		currentState = next;
		for (const listener of listeners) listener(currentState);
	};

	return {
		authStore,
		initAuth: vi.fn(async () => currentState),
		login: vi.fn(async () => currentState),
		logout: vi.fn(() => setState({ status: 'anonymous', user: null })),
		setAuthRedirectHandler: vi.fn((handler: (() => void) | null) => {
			redirectHandler = handler;
		}),
		getAuthRedirectHandler: () => redirectHandler,
		resetAuthRedirectHandler: () => {
			redirectHandler = null;
		},
		setState,
		getState: () => currentState
	};
});

vi.mock('$app/navigation', () => ({
	goto: navigationMocks.goto,
	replaceState: navigationMocks.replaceState
}));
vi.mock('$app/paths', () => ({ resolve: navigationMocks.resolve, base: '/base' }));
vi.mock('$app/state', () => ({ page: navigationMocks.page }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$lib/api/endpoints', () => endpointMocks);
vi.mock('$lib/stores/auth', () => authMocks);

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

const customerUser: User = {
	...adminUser,
	username: 'customer',
	role: { ...adminUser.role!, permissions: ['READ'] }
};

const category: Category = {
	category_id: 1,
	name: 'Ulam',
	description: null,
	created_at: null,
	updated_at: null
};

const product: Product = {
	product_id: 1,
	name: 'Chicken adobo',
	description: null,
	price: '100.00',
	product_image_uri: null,
	categories: [category]
};

function makeProduct(overrides: Partial<Product> = {}): Product {
	return { ...product, ...overrides };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
	return {
		order_id: 1,
		user_id: null,
		products: [{ product, quantity: 1, unit_price: '100.00', line_total: '100.00' }],
		total_amount: '100.00',
		status: 'Pending',
		payment_status: 'unpaid',
		created_at: '2026-08-10 10:00:00',
		updated_at: '2026-08-10 10:00:00',
		...overrides
	};
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

const orders = [
	makeOrder({ order_id: 1, total_amount: '100.00', created_at: '2026-08-10 10:00:00' }),
	makeOrder({
		order_id: 2,
		total_amount: '250.50',
		status: 'Accepted',
		payment_status: 'paid',
		created_at: '2026-08-09 09:00:00'
	}),
	makeOrder({
		order_id: 3,
		total_amount: '75.25',
		status: 'Cancelled',
		payment_status: 'failed',
		created_at: '2026-08-08 08:00:00'
	})
];

let objectUrlCreate: ReturnType<typeof vi.fn>;
let objectUrlRevoke: ReturnType<typeof vi.fn>;
let urlCreateDescriptor: PropertyDescriptor | undefined;
let urlRevokeDescriptor: PropertyDescriptor | undefined;

function setOnline(value: boolean): void {
	Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

function setVisible(value: boolean): void {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		value: value ? 'visible' : 'hidden'
	});
}

function installObjectUrlMocks(): void {
	urlCreateDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
	urlRevokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
	objectUrlCreate = vi.fn(
		(blob: Blob) => `blob:ordering-${blob.size}-${objectUrlCreate.mock.calls.length}`
	);
	objectUrlRevoke = vi.fn();
	Object.defineProperty(URL, 'createObjectURL', {
		configurable: true,
		value: objectUrlCreate
	});
	Object.defineProperty(URL, 'revokeObjectURL', {
		configurable: true,
		value: objectUrlRevoke
	});
}

function restoreObjectUrlMocks(): void {
	if (urlCreateDescriptor) Object.defineProperty(URL, 'createObjectURL', urlCreateDescriptor);
	else Reflect.deleteProperty(URL, 'createObjectURL');
	if (urlRevokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', urlRevokeDescriptor);
	else Reflect.deleteProperty(URL, 'revokeObjectURL');
}

beforeEach(() => {
	vi.clearAllMocks();
	authMocks.initAuth.mockReset();
	authMocks.initAuth.mockImplementation(async () => authMocks.getState());
	authMocks.login.mockReset();
	authMocks.login.mockImplementation(async () => authMocks.getState());
	endpointMocks.listOrders.mockReset();
	endpointMocks.listCategories.mockReset();
	endpointMocks.listProducts.mockReset();
	endpointMocks.cancelOrder.mockReset();
	endpointMocks.createCategory.mockReset();
	endpointMocks.createProduct.mockReset();
	endpointMocks.deleteOrder.mockReset();
	endpointMocks.deleteProductImage.mockReset();
	endpointMocks.getOrderingQr.mockReset();
	endpointMocks.payOrder.mockReset();
	endpointMocks.uploadProductImage.mockReset();
	endpointMocks.updateOrderStatus.mockReset();
	navigationMocks.goto.mockResolvedValue(undefined);
	navigationMocks.page.url = new URL('http://localhost/base/');
	authMocks.resetAuthRedirectHandler();
	authMocks.setState({ status: 'authenticated', user: adminUser });
	endpointMocks.listOrders.mockResolvedValue(orders);
	endpointMocks.listCategories.mockResolvedValue([category]);
	endpointMocks.listProducts.mockResolvedValue([product]);
	endpointMocks.cancelOrder.mockResolvedValue('cancelled');
	endpointMocks.createCategory.mockResolvedValue(undefined);
	endpointMocks.createProduct.mockResolvedValue(undefined);
	endpointMocks.deleteOrder.mockResolvedValue('deleted');
	endpointMocks.deleteProductImage.mockResolvedValue(undefined);
	endpointMocks.getOrderingQr.mockResolvedValue(new Blob(['<svg />'], { type: 'image/svg+xml' }));
	endpointMocks.payOrder.mockResolvedValue({
		order_id: 1,
		payment_status: 'paid',
		message: 'Paid.'
	});
	endpointMocks.uploadProductImage.mockResolvedValue(undefined);
	endpointMocks.updateOrderStatus.mockResolvedValue('updated');
	setOnline(true);
	setVisible(true);
	installObjectUrlMocks();
	Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) });
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	window.history.replaceState(null, '', '/base/');
	restoreObjectUrlMocks();
	setOnline(true);
	setVisible(true);
	authMocks.setState({ status: 'anonymous', user: null });
	vi.restoreAllMocks();
});

describe('Phase 6 admin domain and guard', () => {
	it('sorts newest first and derives exact KPI cents without floating arithmetic', () => {
		expect(sortOrdersNewestFirst(orders).map((order) => order.order_id)).toEqual([1, 2, 3]);
		expect(deriveAdminKpis(orders, new Date(2026, 7, 10, 12))).toEqual({
			todayOrders: 1,
			paidRevenueCents: 25_050,
			unpaidOrFailed: 2
		});
	});

	it('counts each tally pile from the full fetched order set', () => {
		expect(deriveAdminFilterCounts(orders)).toEqual({
			all: 3,
			Pending: 1,
			Accepted: 1,
			Ready: 0,
			Completed: 0,
			Cancelled: 1
		});
	});

	it('redirects anonymous admin loads and returns forbidden data for a valid non-admin', async () => {
		authMocks.initAuth.mockResolvedValueOnce({ status: 'anonymous', user: null });
		await expect(adminLoad()).rejects.toMatchObject({ status: 307, location: '/base/login' });

		authMocks.initAuth.mockResolvedValueOnce({ status: 'forbidden', user: customerUser });
		expect(await adminLoad()).toEqual({ authStatus: 'forbidden', user: customerUser });
	});

	it('does not flash protected content while the guard store is still loading', async () => {
		authMocks.setState({ status: 'loading', user: null });
		const view = render(AdminLayout, {
			data: { authStatus: 'loading', user: null }
		});

		expect(view.container.querySelector('[data-admin-loading]')).not.toBeNull();
		expect(view.container.querySelector('[data-admin-forbidden]')).toBeNull();

		authMocks.setState({ status: 'authenticated', user: adminUser });
		await waitFor(() => {
			expect(view.container.querySelector('[data-admin-loading]')).toBeNull();
			expect(view.container.querySelector('.admin-guard')?.getAttribute('data-auth-state')).toBe(
				'authenticated'
			);
		});
	});

	it('renders a clear 403 path for a valid non-admin with menu and logout actions', () => {
		authMocks.setState({ status: 'forbidden', user: customerUser });
		const view = render(AdminLayout, {
			data: { authStatus: 'forbidden', user: customerUser }
		});

		expect(view.getByRole('heading', { name: 'Hindi para sa role na ito.' })).not.toBeNull();
		expect(view.getByRole('link', { name: 'Bumalik sa menu' })).not.toBeNull();
		expect(view.getByRole('button', { name: 'Mag-logout' })).not.toBeNull();
	});
});

describe('Phase 6 root auth redirect gate', () => {
	it('uses a dark navigation-free Kusina shell for the admin-only login route', () => {
		navigationMocks.page.url = new URL('http://localhost/base/login');
		const view = render(RootLayout);

		expect(view.container.querySelector('.kusina-shell--login')).not.toBeNull();
		expect(view.container.querySelector('.band--kusina')).not.toBeNull();
		expect(view.getByText('Kusina · Admin Board')).not.toBeNull();
		expect(view.getByText('“para sa counter lang”')).not.toBeNull();
		expect(view.queryByRole('navigation')).toBeNull();
		view.unmount();
	});

	it('keeps the error-page recovery link within the configured base path', () => {
		const view = render(ErrorPage);

		expect(view.getByRole('link', { name: 'Bumalik sa menu' }).getAttribute('href')).toBe('/base/');
	});

	it.each([
		['/admin', true],
		['/', false],
		['/order/42', false]
	] as const)('redirects only from the kusina route for %s', async (pathname, shouldRedirect) => {
		navigationMocks.page.url = new URL(`http://localhost/base${pathname}`);
		const view = render(RootLayout);

		await waitFor(() =>
			expect(authMocks.setAuthRedirectHandler).toHaveBeenCalledWith(expect.any(Function))
		);
		authMocks.getAuthRedirectHandler()?.();

		if (shouldRedirect) expect(navigationMocks.goto).toHaveBeenCalledWith('/base/login');
		else expect(navigationMocks.goto).not.toHaveBeenCalled();
		view.unmount();
	});
});

describe('Phase 6 login', () => {
	beforeEach(() => {
		authMocks.setState({ status: 'anonymous', user: null });
	});

	it('renders the Kusina-only Design2 copy with one shared action-sizing group', async () => {
		const view = render(LoginPage);
		const submit = await view.findByRole('button', { name: 'Pumasok sa kusina' });
		const menuLink = view.getByRole('link', { name: 'Bumalik sa menu' });

		expect(view.container.querySelector('[data-login-mode="kusina"]')).not.toBeNull();
		expect(view.getAllByRole('heading', { level: 1 })).toHaveLength(1);
		expect(view.getByRole('heading', { level: 1, name: 'SINO KA DIYAN?' })).not.toBeNull();
		expect(view.getByText('para sa counter lang')).not.toBeNull();
		expect(view.getByText('Para sa counter ito.', { exact: false })).not.toBeNull();
		expect(view.getByText('hindi admin account?', { exact: false })).not.toBeNull();
		expect(submit.closest('.login-actions--pair')).toBe(menuLink.closest('.login-actions--pair'));
		expect(view.queryByRole('tab')).toBeNull();
		expect(view.queryByText(/customer|register|gumawa ng account/i)).toBeNull();
	});

	it('blocks duplicate Kusina login submissions while server hydration is pending', async () => {
		type TestAuthState = Parameters<typeof authMocks.setState>[0];
		let resolveLogin: ((state: TestAuthState) => void) | undefined;
		authMocks.login.mockImplementationOnce(
			() => new Promise<TestAuthState>((resolve) => (resolveLogin = resolve))
		);
		const view = render(LoginPage);
		const submit = await view.findByRole('button', { name: 'Pumasok sa kusina' });
		await fireEvent.input(view.getByLabelText('Username'), { target: { value: 'admin' } });
		await fireEvent.input(view.getByLabelText('Password'), { target: { value: 'secret' } });

		await fireEvent.click(submit);
		await fireEvent.click(submit);

		expect(authMocks.login).toHaveBeenCalledTimes(1);
		expect((submit as HTMLButtonElement).disabled).toBe(true);
		resolveLogin?.({ status: 'authenticated', user: adminUser });
		await waitFor(() => expect(navigationMocks.goto).toHaveBeenCalledWith('/base/admin'));
	});

	it.each([
		[401, 'Hindi makapag-login (401)', 'Mali ang username o password.'],
		[404, 'Hindi nakita ang account (404)', 'Walang user na tumutugma'],
		[429, 'Sandali muna (429)', 'Masyadong maraming pagtatangka'],
		[0, 'Walang koneksyon', 'Suriin ang internet connection'],
		[500, 'Hindi makapag-login (500)', 'Server failure']
	])('keeps login errors inline for %s', async (status, title, message) => {
		authMocks.login.mockRejectedValueOnce(new ApiError(status, 'Server failure'));
		const view = render(LoginPage);
		await view.findByRole('button', { name: 'Pumasok sa kusina' });
		await fireEvent.input(view.getByLabelText('Username'), { target: { value: 'admin' } });
		await fireEvent.input(view.getByLabelText('Password'), { target: { value: 'secret' } });
		await fireEvent.click(view.getByRole('button', { name: 'Pumasok sa kusina' }));

		expect(await view.findByText(title)).not.toBeNull();
		expect(view.getByText(message, { exact: false })).not.toBeNull();
		expect(navigationMocks.goto).not.toHaveBeenCalled();
	});

	it('redirects only after login hydration confirms ADMIN permission', async () => {
		const view = render(LoginPage);
		await view.findByRole('button', { name: 'Pumasok sa kusina' });
		await fireEvent.input(view.getByLabelText('Username'), { target: { value: 'admin' } });
		await fireEvent.input(view.getByLabelText('Password'), { target: { value: 'secret' } });
		authMocks.login.mockResolvedValueOnce({ status: 'authenticated', user: adminUser });

		await fireEvent.click(view.getByRole('button', { name: 'Pumasok sa kusina' }));
		await waitFor(() => expect(navigationMocks.goto).toHaveBeenCalledWith('/base/admin'));
	});

	it('shows non-admin login as an inline 403 and does not navigate', async () => {
		const view = render(LoginPage);
		await view.findByRole('button', { name: 'Pumasok sa kusina' });
		await fireEvent.input(view.getByLabelText('Username'), { target: { value: 'customer' } });
		await fireEvent.input(view.getByLabelText('Password'), { target: { value: 'secret' } });
		authMocks.login.mockResolvedValueOnce({ status: 'forbidden', user: customerUser });

		await fireEvent.click(view.getByRole('button', { name: 'Pumasok sa kusina' }));
		expect(await view.findByText('403 · Walang access sa kusina')).not.toBeNull();
		expect(navigationMocks.goto).not.toHaveBeenCalled();
	});

	it('keeps login and retry affordances available during loading hydration', async () => {
		authMocks.setState({ status: 'loading', user: null });
		authMocks.initAuth.mockResolvedValueOnce({ status: 'loading', user: null });
		const view = render(LoginPage);

		expect(await view.findByRole('button', { name: 'Mag-login ngayon' })).not.toBeNull();
		expect(view.getByRole('button', { name: 'Subukan muli ang session' })).not.toBeNull();

		await fireEvent.click(view.getByRole('button', { name: 'Mag-login ngayon' }));
		expect(authMocks.logout).toHaveBeenCalled();
		expect(await view.findByRole('button', { name: 'Pumasok sa kusina' })).not.toBeNull();
	});
});

describe('Phase 6 order board and QR', () => {
	async function renderBoard() {
		const view = render(AdminPage);
		await waitFor(() =>
			expect(view.container.querySelector('tbody tr[data-order-id="1"]')).not.toBeNull()
		);
		return view;
	}

	async function openStation(
		view: Awaited<ReturnType<typeof renderBoard>>,
		station: 'orders' | 'menu' | 'qr'
	): Promise<void> {
		const stationNames = {
			orders: /^MGA ORDER/,
			menu: /^MENU/,
			qr: /^QR NG MESA/
		} as const;
		await fireEvent.click(view.getByRole('tab', { name: stationNames[station] }));
	}

	it('renders the Design2 KPI, ledger, tabs, and QR composition with local filters', async () => {
		const view = await renderBoard();
		const tableRows = Array.from(view.container.querySelectorAll('tbody tr[data-order-id]'));
		expect(tableRows.map((row) => row.getAttribute('data-order-id'))).toEqual(['1', '2', '3']);
		expect(view.container.querySelector('th[scope="col"]')).not.toBeNull();
		expect(within(tableRows[0] as HTMLElement).getByText('Chicken adobo ×1')).not.toBeNull();
		expect(view.getAllByText('₱250.50')).not.toHaveLength(0);
		expect(view.getByText('Order ngayong araw')).not.toBeNull();
		expect(view.container.querySelector('.kpi-card__value')).not.toBeNull();
		// The tally piles and tab note must leave the loading state once the board lands.
		const lahatButton = view.getByRole('button', { name: 'Lahat' });
		expect(within(lahatButton).queryByText('—')).toBeNull();
		expect(within(lahatButton).getByText('3')).not.toBeNull();
		expect(within(view.getByRole('button', { name: 'Tinanggap' })).getByText('1')).not.toBeNull();
		expect(within(view.getByRole('button', { name: 'Kinansela' })).getByText('1')).not.toBeNull();
		expect(view.getByText('0 ngayon')).not.toBeNull();
		expect(
			view.container.querySelector('tbody tr[data-order-id="1"] time')?.getAttribute('datetime')
		).toBe(formatAdminDateTime(orders[0]?.created_at));
		expect(view.getByRole('region', { name: 'Scrollable na ledger ng mga order' })).toHaveProperty(
			'tabIndex',
			0
		);
		expect(
			Array.from(view.container.querySelectorAll('.admin-ledger thead th')).map((header) =>
				header.textContent?.trim()
			)
		).toEqual(['Oras', '#', 'Laman', 'Kabuuan', 'Kusina', 'Bayad', 'Aksyon']);
		expect(view.container.querySelector('.admin-workspace .admin-qr-panel')).not.toBeNull();
		expect(view.container.querySelector('[data-order-card-id]')).toBeNull();
		expect(view.getAllByRole('heading', { level: 1 })).toHaveLength(1);
		const advanceLabel = within(
			view.container.querySelector('tbody tr[data-order-id="1"]') as HTMLElement
		)
			.getByRole('button', { name: /Isulong ang order #1/ })
			.getAttribute('aria-label');
		expect(advanceLabel).not.toContain('→');

		const filter = view.getByRole('button', { name: 'Tinanggap' });
		const callsBeforeFilter = endpointMocks.listOrders.mock.calls.length;
		await fireEvent.click(filter);
		expect(endpointMocks.listOrders).toHaveBeenCalledTimes(callsBeforeFilter);
		expect(filter.getAttribute('aria-pressed')).toBe('true');
		await waitFor(() =>
			expect(
				Array.from(view.container.querySelectorAll('tbody tr[data-order-id]')).map((row) =>
					row.getAttribute('data-order-id')
				)
			).toEqual(['1'])
		);
		const kpiGrid = view.container.querySelector('.kpi-grid') as HTMLElement;
		expect(within(kpiGrid).getByText('₱250.50')).not.toBeNull();
		expect(within(kpiGrid).getByText('2')).not.toBeNull();
	});

	it('supports station deep links and roving keyboard navigation', async () => {
		window.history.replaceState(null, '', '/base/#menu');
		const view = await renderBoard();
		const ordersTab = view.getByRole('tab', { name: /^MGA ORDER/ });
		const menuTab = view.getByRole('tab', { name: /^MENU/ });
		const qrTab = view.getByRole('tab', { name: /^QR NG MESA/ });

		expect(menuTab.getAttribute('aria-selected')).toBe('true');
		expect(ordersTab.getAttribute('aria-selected')).toBe('false');
		expect(view.container.querySelector('#admin-station-menu')?.hasAttribute('hidden')).toBe(false);
		expect(view.container.querySelector('#admin-station-orders')?.hasAttribute('hidden')).toBe(
			true
		);

		await fireEvent.keyDown(menuTab, { key: 'ArrowRight' });
		expect(qrTab.getAttribute('aria-selected')).toBe('true');
		expect(window.location.hash).toBe('#qr');

		await fireEvent.keyDown(qrTab, { key: 'Home' });
		expect(ordersTab.getAttribute('aria-selected')).toBe('true');
		expect(window.location.hash).toBe('');
	});

	it('changes filters locally while a refresh is in flight', async () => {
		const view = await renderBoard();
		const refreshedOrders = deferred<Order[]>();
		endpointMocks.listOrders.mockReturnValueOnce(refreshedOrders.promise);

		await fireEvent.click(view.getByRole('button', { name: 'I-refresh' }));
		await fireEvent.click(view.getByRole('button', { name: 'Tinanggap' }));
		expect(view.container.querySelector('tbody tr[data-order-id="1"]')).not.toBeNull();
		expect(view.container.querySelector('.skeleton')).toBeNull();

		refreshedOrders.resolve([orders[1]!]);
		await waitFor(() =>
			expect(
				view.queryByRole('heading', { name: 'Walang order sa status na Tinanggap' })
			).not.toBeNull()
		);
	});

	it('keeps current KPIs and rows when a refresh fails', async () => {
		const view = await renderBoard();
		endpointMocks.listOrders.mockRejectedValueOnce(new ApiError(503, 'Refresh failure.'));

		await fireEvent.click(view.getByRole('button', { name: 'I-refresh' }));

		await view.findByText('Refresh failure.');
		expect(view.container.querySelector('[data-kpi-stale="false"]')).not.toBeNull();
		const kpiGrid = view.container.querySelector('.kpi-grid') as HTMLElement;
		expect(within(kpiGrid).getByText('₱250.50')).not.toBeNull();
		expect(view.container.querySelector('tbody tr[data-order-id="1"]')).not.toBeNull();
	});

	it('uses status-safe wording for an empty completed filter', async () => {
		const view = await renderBoard();
		await fireEvent.click(view.getByRole('button', { name: 'Nakuha na' }));

		expect(
			await view.findByRole('heading', { name: 'Walang order sa status na Nakuha na' })
		).not.toBeNull();
	});

	it('uses pessimistic progression and refetches after a successful advance', async () => {
		const view = await renderBoard();
		const row = view.container.querySelector('tbody tr[data-order-id="1"]') as HTMLElement;
		const advance = within(row).getByRole('button', { name: /Isulong ang order #1/ });
		await fireEvent.click(advance);

		expect(endpointMocks.updateOrderStatus).toHaveBeenCalledWith(1, 'Accepted');
		await waitFor(() => expect(endpointMocks.listOrders).toHaveBeenCalledTimes(2));
	});

	it('keeps a successful action out of row errors when its refetch fails and offers refresh', async () => {
		const view = await renderBoard();
		const row = view.container.querySelector('tbody tr[data-order-id="1"]') as HTMLElement;
		endpointMocks.listOrders.mockRejectedValueOnce(new ApiError(503, 'Refresh failure.'));
		await fireEvent.click(within(row).getByRole('button', { name: /Isulong ang order #1/ }));

		await waitFor(() =>
			expect(view.getByText('Aksyon matagumpay, pero hindi na-refresh ang board')).not.toBeNull()
		);
		expect(within(row).queryByText(/Hindi natuloy ang/)).toBeNull();
		expect(
			within(row).getByRole('button', { name: /Isulong ang order #1 sa Niluluto/ })
		).not.toBeNull();
		expect((view.getByRole('button', { name: 'I-refresh' }) as HTMLButtonElement).disabled).toBe(
			false
		);

		endpointMocks.listOrders.mockResolvedValueOnce(
			orders.map((order) =>
				order.order_id === 1 ? makeOrder({ ...order, status: 'Accepted' }) : order
			)
		);
		await fireEvent.click(view.getByRole('button', { name: 'I-refresh' }));
		await waitFor(() =>
			expect(view.queryByText('Aksyon matagumpay, pero hindi na-refresh ang board')).toBeNull()
		);
	});

	it('keeps 409 action conflicts inline and confirms destructive actions', async () => {
		const view = await renderBoard();
		const row = view.container.querySelector('tbody tr[data-order-id="1"]') as HTMLElement;
		endpointMocks.updateOrderStatus.mockRejectedValueOnce(new ApiError(409, 'Conflict.'));
		await fireEvent.click(within(row).getByRole('button', { name: /Isulong ang order #1/ }));
		expect(await within(row).findByText(/409/)).not.toBeNull();

		const confirm = window.confirm as unknown as ReturnType<typeof vi.fn>;
		confirm.mockReturnValue(false);
		await fireEvent.click(within(row).getByRole('button', { name: /Kanselahin ang order #1/ }));
		await fireEvent.click(within(row).getByRole('button', { name: /Burahin ang order #1/ }));
		expect(endpointMocks.cancelOrder).not.toHaveBeenCalled();
		expect(endpointMocks.deleteOrder).not.toHaveBeenCalled();
		expect(confirm).toHaveBeenCalledTimes(2);
	});

	it.each([
		[403, 'Walang pahintulot sa aksyon na ito (403)'],
		[429, 'Masyadong maraming request (429)'],
		[0, 'Walang koneksyon']
	])('keeps row action status %s inline', async (status, message) => {
		const view = await renderBoard();
		const row = view.container.querySelector('tbody tr[data-order-id="1"]') as HTMLElement;
		if (status === 0) setOnline(false);
		endpointMocks.updateOrderStatus.mockRejectedValueOnce(new ApiError(status, 'Action failure.'));

		await fireEvent.click(within(row).getByRole('button', { name: /Isulong ang order #1/ }));
		expect(await within(row).findByText(message, { exact: false })).not.toBeNull();
	});

	it('refetches the board after a successful delete', async () => {
		const view = await renderBoard();
		const initialListCalls = endpointMocks.listOrders.mock.calls.length;
		const row = view.container.querySelector('tbody tr[data-order-id="1"]') as HTMLElement;

		await fireEvent.click(within(row).getByRole('button', { name: /Burahin ang order #1/ }));

		await waitFor(() => expect(endpointMocks.deleteOrder).toHaveBeenCalledWith(1));
		await waitFor(() =>
			expect(endpointMocks.listOrders.mock.calls.length).toBe(initialListCalls + 1)
		);
	});

	it('keeps payment independent for active orders but hides it for cancelled orders', async () => {
		const view = await renderBoard();
		const pendingRow = view.container.querySelector('tbody tr[data-order-id="1"]') as HTMLElement;
		const cancelledRow = view.container.querySelector('tbody tr[data-order-id="3"]') as HTMLElement;

		expect(within(cancelledRow).queryByRole('button', { name: /Markahang bayad/ })).toBeNull();
		await fireEvent.click(within(pendingRow).getByRole('button', { name: /Markahang bayad/ }));
		await waitFor(() => expect(endpointMocks.payOrder).toHaveBeenCalledWith(1));
	});

	it.each([
		[403, 'Walang pahintulot na kumuha ng ordering QR (403)'],
		[429, 'Masyadong maraming request (429)']
	])('keeps ordering QR status %s inline', async (status, message) => {
		const view = await renderBoard();
		await openStation(view, 'qr');
		endpointMocks.getOrderingQr.mockRejectedValueOnce(new ApiError(status, 'QR failure.'));

		await fireEvent.click(view.getByRole('button', { name: 'Kumuha ng bagong QR' }));
		expect(await view.findByText(message, { exact: false })).not.toBeNull();
	});

	it('reports offline ordering QR refresh without calling the endpoint', async () => {
		const view = await renderBoard();
		await openStation(view, 'qr');
		endpointMocks.getOrderingQr.mockClear();
		setOnline(false);

		await fireEvent.click(view.getByRole('button', { name: 'Kumuha ng bagong QR' }));
		expect(
			await view.findByText('Walang koneksyon. Subukan muli kapag online na.', { exact: false })
		).not.toBeNull();
		expect(endpointMocks.getOrderingQr).not.toHaveBeenCalled();
	});

	it('replaces and revokes ordering QR object URLs and cleans the last URL on unmount', async () => {
		const view = await renderBoard();
		await openStation(view, 'qr');
		await waitFor(() => expect(objectUrlCreate).toHaveBeenCalledTimes(1));
		const firstUrl = objectUrlCreate.mock.results[0]?.value;

		await fireEvent.click(view.getByRole('button', { name: 'Kumuha ng bagong QR' }));
		await waitFor(() => expect(objectUrlCreate).toHaveBeenCalledTimes(2));
		const secondUrl = objectUrlCreate.mock.results[1]?.value;
		expect(objectUrlRevoke).toHaveBeenCalledWith(firstUrl);

		view.unmount();
		expect(objectUrlRevoke).toHaveBeenCalledWith(secondUrl);
	});

	it('uses a temporary QR URL for download without revoking the live preview URL', async () => {
		const view = await renderBoard();
		await openStation(view, 'qr');
		await waitFor(() => expect(objectUrlCreate).toHaveBeenCalledTimes(1));
		const previewUrl = objectUrlCreate.mock.results[0]?.value;

		await fireEvent.click(view.getByRole('button', { name: 'I-download ang SVG' }));
		await waitFor(() => expect(objectUrlCreate).toHaveBeenCalledTimes(2));
		const downloadUrl = objectUrlCreate.mock.results[1]?.value;

		expect(objectUrlRevoke).not.toHaveBeenCalledWith(downloadUrl);
		view.unmount();
		expect(objectUrlRevoke).toHaveBeenCalledWith(previewUrl);
		expect(objectUrlRevoke).not.toHaveBeenCalledWith(downloadUrl);
	});

	it('pauses board polling while hidden/offline and stops it after logout', async () => {
		vi.useFakeTimers();
		const view = await renderBoard();
		const initialCalls = endpointMocks.listOrders.mock.calls.length;

		setVisible(false);
		vi.advanceTimersByTime(15_000);
		expect(endpointMocks.listOrders).toHaveBeenCalledTimes(initialCalls);

		setVisible(true);
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.runAllTicks();
		await waitFor(() => expect(endpointMocks.listOrders.mock.calls.length).toBe(initialCalls + 1));

		setOnline(false);
		vi.advanceTimersByTime(15_000);
		expect(endpointMocks.listOrders.mock.calls.length).toBe(initialCalls + 1);

		setOnline(true);
		window.dispatchEvent(new Event('online'));
		await vi.runAllTicks();
		await waitFor(() => expect(endpointMocks.listOrders.mock.calls.length).toBe(initialCalls + 2));

		authMocks.setState({ status: 'anonymous', user: null });
		vi.advanceTimersByTime(30_000);
		expect(endpointMocks.listOrders.mock.calls.length).toBe(initialCalls + 2);
		view.unmount();
	});

	it('pauses automatic polling for a minute after a 429 response', async () => {
		vi.useFakeTimers();
		const view = await renderBoard();
		const initialCalls = endpointMocks.listOrders.mock.calls.length;
		endpointMocks.listOrders.mockRejectedValueOnce(new ApiError(429, 'Rate limited.'));

		vi.advanceTimersByTime(15_000);
		await vi.runAllTicks();
		await waitFor(() => expect(endpointMocks.listOrders).toHaveBeenCalledTimes(initialCalls + 1));
		await fireEvent.click(view.getByRole('button', { name: 'I-refresh' }));
		expect(endpointMocks.listOrders).toHaveBeenCalledTimes(initialCalls + 1);

		vi.advanceTimersByTime(45_000);
		await vi.runAllTicks();
		expect(endpointMocks.listOrders).toHaveBeenCalledTimes(initialCalls + 1);

		vi.advanceTimersByTime(15_000);
		await vi.runAllTicks();
		await waitFor(() => expect(endpointMocks.listOrders).toHaveBeenCalledTimes(initialCalls + 2));
		view.unmount();
	});
});

describe('Phase 3 admin menu and product images', () => {
	async function renderMenu() {
		const view = render(AdminPage);
		await fireEvent.click(view.getByRole('tab', { name: /^MENU/ }));
		await waitFor(() => expect(endpointMocks.listProducts).toHaveBeenCalled());
		await view.findByRole('heading', { name: 'MGA ULAM SA BAHAY' });
		return view;
	}

	async function fillProduct(view: Awaited<ReturnType<typeof renderMenu>>, productName: string) {
		await fireEvent.input(view.getByLabelText('Pangalan ng ulam'), {
			target: { value: productName }
		});
		await fireEvent.input(view.getByRole('textbox', { name: /^Presyo/ }), {
			target: { value: '125.50' }
		});
	}

	it('waits for authenticated state before loading categories and products', async () => {
		authMocks.setState({ status: 'loading', user: null });
		const view = render(AdminPage);
		await vi.waitFor(() => expect(endpointMocks.listProducts).not.toHaveBeenCalled());
		expect(endpointMocks.listCategories).not.toHaveBeenCalled();

		authMocks.setState({ status: 'authenticated', user: adminUser });
		await fireEvent.click(view.getByRole('tab', { name: /^MENU/ }));
		await waitFor(() => expect(endpointMocks.listProducts).toHaveBeenCalledTimes(1));
		expect(endpointMocks.listCategories).toHaveBeenCalledTimes(1);
		view.unmount();
	});

	it('loads categories and products independently and keeps the live order board available', async () => {
		endpointMocks.listCategories.mockRejectedValueOnce(
			new ApiError(503, 'Categories unavailable.')
		);
		const view = await renderMenu();

		expect(await view.findByText('Chicken adobo')).not.toBeNull();
		expect(view.container.querySelector('#admin-station-orders')?.hasAttribute('hidden')).toBe(
			true
		);
		expect(view.getByText('Hindi ma-load ang mga kategorya')).not.toBeNull();
		expect(view.getByRole('button', { name: 'Subukan muli ang mga kategorya' })).not.toBeNull();
	});

	it('creates a category inline and selects it in the dish form', async () => {
		const meryenda: Category = {
			category_id: 2,
			name: 'Meryenda',
			description: null,
			created_at: null,
			updated_at: null
		};
		endpointMocks.listCategories
			.mockResolvedValueOnce([category])
			.mockResolvedValueOnce([category, meryenda]);
		const view = await renderMenu();

		await fireEvent.click(view.getByRole('button', { name: '+ bagong kategorya' }));
		await fireEvent.input(view.getByLabelText('Pangalan ng bagong kategorya'), {
			target: { value: 'Meryenda' }
		});
		await fireEvent.click(view.getByRole('button', { name: 'Idagdag' }));

		await waitFor(() => expect(endpointMocks.createCategory).toHaveBeenCalledWith('Meryenda'));
		await waitFor(() =>
			expect((view.getByLabelText('Kategorya') as HTMLSelectElement).value).toBe('Meryenda')
		);
		expect(endpointMocks.listCategories).toHaveBeenCalledTimes(2);
		expect(view.queryByLabelText('Pangalan ng bagong kategorya')).toBeNull();
	});

	it('keeps category creation conflicts inline and the form untouched', async () => {
		endpointMocks.createCategory.mockRejectedValueOnce(new ApiError(409, 'Conflict.'));
		const view = await renderMenu();

		await fireEvent.click(view.getByRole('button', { name: '+ bagong kategorya' }));
		await fireEvent.input(view.getByLabelText('Pangalan ng bagong kategorya'), {
			target: { value: 'Meryenda' }
		});
		await fireEvent.click(view.getByRole('button', { name: 'Idagdag' }));

		expect(
			await view.findByText('May kategorya nang gumagamit ng pangalang ito (409).')
		).not.toBeNull();
		expect((view.getByLabelText('Kategorya') as HTMLSelectElement).value).toBe('Ulam');
	});

	it('selects an existing category instead of posting a duplicate', async () => {
		const view = await renderMenu();

		await fireEvent.click(view.getByRole('button', { name: '+ bagong kategorya' }));
		await fireEvent.input(view.getByLabelText('Pangalan ng bagong kategorya'), {
			target: { value: ' ulam ' }
		});
		await fireEvent.click(view.getByRole('button', { name: 'Idagdag' }));

		expect(endpointMocks.createCategory).not.toHaveBeenCalled();
		expect((view.getByLabelText('Kategorya') as HTMLSelectElement).value).toBe('Ulam');
		expect(view.queryByLabelText('Pangalan ng bagong kategorya')).toBeNull();
	});

	it('creates a product without an image, reloads the list, and resets the form', async () => {
		const created = makeProduct({ product_id: 12, name: 'Laing', price: '125.50' });
		endpointMocks.listProducts
			.mockResolvedValueOnce([product])
			.mockResolvedValueOnce([product, created]);
		const view = await renderMenu();
		await fillProduct(view, ' Laing ');
		await fireEvent.click(view.getByRole('button', { name: 'Idagdag sa menu' }));

		await waitFor(() =>
			expect(endpointMocks.createProduct).toHaveBeenCalledWith({
				name: 'Laing',
				price: '125.50',
				description: undefined,
				categories: ['Ulam']
			})
		);
		expect(await view.findByText('Laing')).not.toBeNull();
		expect(endpointMocks.uploadProductImage).not.toHaveBeenCalled();
		expect((view.getByLabelText('Pangalan ng ulam') as HTMLInputElement).value).toBe('');
		const toast = view.getByRole('status', { name: 'Notification sa menu' });
		expect(within(toast).getByText('Naidagdag ang Laing sa menu.')).not.toBeNull();
		await fireEvent.click(within(toast).getByRole('button', { name: 'Isara ang notification' }));
		expect(view.queryByText('Naidagdag ang Laing sa menu.')).toBeNull();
	});

	it('creates then uploads an optional image and refreshes server-backed state', async () => {
		const created = makeProduct({ product_id: 13, name: 'Pinakbet', price: '125.50' });
		const withImage = makeProduct({
			...created,
			product_image_uri: 'https://images.test/pinakbet.webp'
		});
		endpointMocks.listProducts
			.mockResolvedValueOnce([product])
			.mockResolvedValueOnce([product, created])
			.mockResolvedValueOnce([product, withImage]);
		const view = await renderMenu();
		await fillProduct(view, 'Pinakbet');
		const file = new File(['image'], 'pinakbet.webp', { type: 'image/webp' });
		await fireEvent.change(view.getByLabelText(/^Larawan opsyonal/), {
			target: { files: [file] }
		});
		const previewCall = objectUrlCreate.mock.calls.findIndex((call) => call[0] === file);
		const previewUrl = objectUrlCreate.mock.results[previewCall]?.value;

		await fireEvent.click(view.getByRole('button', { name: 'Idagdag sa menu' }));

		await waitFor(() => expect(endpointMocks.uploadProductImage).toHaveBeenCalledWith(13, file));
		expect(
			within(await view.findByRole('status', { name: 'Notification sa menu' })).getByText(
				'Naidagdag ang Pinakbet kasama ang larawan.'
			)
		).not.toBeNull();
		expect(view.getByAltText('Larawan ng Pinakbet').getAttribute('src')).toBe(
			'https://images.test/pinakbet.webp'
		);
		expect(objectUrlRevoke).toHaveBeenCalledWith(previewUrl);
	});

	it('keeps a created product visible after image failure and supports row retry', async () => {
		const created = makeProduct({ product_id: 14, name: 'Dinuguan', price: '125.50' });
		const withImage = makeProduct({
			...created,
			product_image_uri: 'https://images.test/dinuguan.png'
		});
		endpointMocks.listProducts
			.mockResolvedValueOnce([product])
			.mockResolvedValueOnce([product, created])
			.mockResolvedValueOnce([product, withImage]);
		endpointMocks.uploadProductImage.mockRejectedValueOnce(
			new ApiError(503, 'Storage unavailable.')
		);
		const view = await renderMenu();
		await fillProduct(view, 'Dinuguan');
		const original = new File(['image'], 'dinuguan.png', { type: 'image/png' });
		await fireEvent.change(view.getByLabelText(/^Larawan opsyonal/), {
			target: { files: [original] }
		});
		await fireEvent.click(view.getByRole('button', { name: 'Idagdag sa menu' }));

		expect(
			await view.findByText(/Naidagdag ang Dinuguan, pero hindi naikabit ang larawan/)
		).not.toBeNull();
		const row = view.container.querySelector('[data-admin-product-id="14"]') as HTMLElement;
		expect(within(row).getByText(/object storage/)).not.toBeNull();
		expect(endpointMocks.createProduct).toHaveBeenCalledTimes(1);

		const retry = new File(['retry'], 'retry.png', { type: 'image/png' });
		await fireEvent.change(within(row).getByLabelText('Ikabit ang larawan ng Dinuguan'), {
			target: { files: [retry] }
		});
		await waitFor(() =>
			expect(endpointMocks.uploadProductImage).toHaveBeenLastCalledWith(14, retry)
		);
		expect(endpointMocks.createProduct).toHaveBeenCalledTimes(1);
	});

	it('preserves form input and maps duplicate product conflicts inline', async () => {
		endpointMocks.createProduct.mockRejectedValueOnce(new ApiError(409, 'Duplicate.'));
		const view = await renderMenu();
		await fillProduct(view, 'Chicken adobo');
		await fireEvent.click(view.getByRole('button', { name: 'Idagdag sa menu' }));

		expect(
			await view.findByText(/May ulam nang gumagamit ng pangalang ito \(409\)/)
		).not.toBeNull();
		expect((view.getByLabelText('Pangalan ng ulam') as HTMLInputElement).value).toBe(
			'Chicken adobo'
		);
	});

	it('retries a failed product list without blocking the create form', async () => {
		endpointMocks.listProducts
			.mockRejectedValueOnce(new ApiError(503, 'Unavailable.'))
			.mockResolvedValueOnce([product]);
		const view = render(AdminPage);
		await fireEvent.click(view.getByRole('tab', { name: /^MENU/ }));

		expect(await view.findByText('Hindi ma-load ang mga ulam')).not.toBeNull();
		expect(view.getByLabelText('Pangalan ng ulam')).not.toBeNull();
		await fireEvent.click(view.getByRole('button', { name: 'Subukan muli ang mga ulam' }));
		expect(await view.findByText('Chicken adobo')).not.toBeNull();
	});

	it('ignores a stale initial product response after a create refresh wins', async () => {
		const stale = deferred<Product[]>();
		const created = makeProduct({ product_id: 15, name: 'Kare-kare', price: '125.50' });
		endpointMocks.listProducts
			.mockImplementationOnce(() => stale.promise)
			.mockResolvedValueOnce([created]);
		const view = render(AdminPage);
		await fireEvent.click(view.getByRole('tab', { name: /^MENU/ }));
		await waitFor(() => expect(endpointMocks.listProducts).toHaveBeenCalledTimes(1));
		await fireEvent.input(view.getByLabelText('Pangalan ng ulam'), {
			target: { value: 'Kare-kare' }
		});
		await fireEvent.input(view.getByRole('textbox', { name: /^Presyo/ }), {
			target: { value: '125.50' }
		});
		await fireEvent.click(view.getByRole('button', { name: 'Idagdag sa menu' }));

		expect(await view.findByText('Kare-kare')).not.toBeNull();
		stale.resolve([product]);
		await stale.promise;
		await Promise.resolve();
		expect(view.getByText('Kare-kare')).not.toBeNull();
		expect(view.queryByText('Chicken adobo')).toBeNull();
	});

	it('uses the latest product refresh when create and row image mutations interleave', async () => {
		const createRefresh = deferred<Product[]>();
		const created = makeProduct({ product_id: 16, name: 'Sinigang na hipon', price: '125.50' });
		const existingWithImage = makeProduct({
			product_image_uri: 'https://images.test/adobo.webp'
		});
		const createdWithImage = makeProduct({
			...created,
			product_image_uri: 'https://images.test/sinigang.webp'
		});
		endpointMocks.listProducts
			.mockResolvedValueOnce([product])
			.mockImplementationOnce(() => createRefresh.promise)
			.mockResolvedValueOnce([existingWithImage, created])
			.mockResolvedValueOnce([existingWithImage, createdWithImage]);
		const view = await renderMenu();
		await fillProduct(view, 'Sinigang na hipon');
		const formImage = new File(['new dish'], 'sinigang.webp', { type: 'image/webp' });
		await fireEvent.change(view.getByLabelText(/^Larawan opsyonal/), {
			target: { files: [formImage] }
		});
		await fireEvent.click(view.getByRole('button', { name: 'Idagdag sa menu' }));
		await waitFor(() => expect(endpointMocks.listProducts).toHaveBeenCalledTimes(2));

		const rowImage = new File(['existing dish'], 'adobo.webp', { type: 'image/webp' });
		await fireEvent.change(view.getByLabelText('Ikabit ang larawan ng Chicken adobo'), {
			target: { files: [rowImage] }
		});
		await waitFor(() => expect(endpointMocks.listProducts).toHaveBeenCalledTimes(3));

		createRefresh.resolve([product]);
		await waitFor(() =>
			expect(endpointMocks.uploadProductImage).toHaveBeenCalledWith(16, formImage)
		);
		expect(
			await view.findByText('Naidagdag ang Sinigang na hipon kasama ang larawan.')
		).not.toBeNull();
		expect(view.queryByText(/hindi na-refresh ang listahan/i)).toBeNull();
		expect(endpointMocks.uploadProductImage).toHaveBeenCalledWith(1, rowImage);
		expect(view.getByAltText('Larawan ng Sinigang na hipon').getAttribute('src')).toBe(
			'https://images.test/sinigang.webp'
		);
	});

	it('blocks duplicate form submits while leaving product-row controls independent', async () => {
		const pendingCreate = deferred<void>();
		endpointMocks.createProduct.mockImplementationOnce(() => pendingCreate.promise);
		const view = await renderMenu();
		await fillProduct(view, 'Sisig');
		const submit = view.getByRole('button', { name: 'Idagdag sa menu' });
		await fireEvent.click(submit);
		await fireEvent.click(submit);

		expect(endpointMocks.createProduct).toHaveBeenCalledTimes(1);
		expect((submit as HTMLButtonElement).disabled).toBe(true);
		expect(
			(view.getByLabelText('Ikabit ang larawan ng Chicken adobo') as HTMLInputElement).disabled
		).toBe(false);
		pendingCreate.resolve();
		await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
	});

	it('keeps other product rows operable while one image mutation is pending', async () => {
		const second = makeProduct({ product_id: 2, name: 'Sinigang' });
		const firstUpload = deferred<void>();
		endpointMocks.listProducts.mockResolvedValue([product, second]);
		endpointMocks.uploadProductImage.mockImplementation((productId: number) =>
			productId === 1 ? firstUpload.promise : Promise.resolve()
		);
		const view = await renderMenu();
		const firstInput = view.getByLabelText(
			'Ikabit ang larawan ng Chicken adobo'
		) as HTMLInputElement;
		const secondInput = view.getByLabelText('Ikabit ang larawan ng Sinigang') as HTMLInputElement;

		await fireEvent.change(firstInput, {
			target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] }
		});
		await waitFor(() => expect(firstInput.disabled).toBe(true));
		expect(secondInput.disabled).toBe(false);
		await fireEvent.change(secondInput, {
			target: { files: [new File(['two'], 'two.png', { type: 'image/png' })] }
		});
		await waitFor(() =>
			expect(endpointMocks.uploadProductImage).toHaveBeenCalledWith(2, expect.any(File))
		);

		firstUpload.resolve();
		await waitFor(() => expect(firstInput.disabled).toBe(false));
	});

	it('uploads, replaces, and deletes only the selected product image', async () => {
		const withImage = makeProduct({ product_image_uri: 'https://images.test/old.png' });
		const replaced = makeProduct({ product_image_uri: 'https://images.test/new.png' });
		endpointMocks.listProducts
			.mockResolvedValueOnce([withImage])
			.mockResolvedValueOnce([replaced])
			.mockResolvedValueOnce([product]);
		const view = await renderMenu();
		const replacement = new File(['replacement'], 'new.png', { type: 'image/png' });
		await fireEvent.change(view.getByLabelText('Palitan ang larawan ng Chicken adobo'), {
			target: { files: [replacement] }
		});
		await waitFor(() =>
			expect(endpointMocks.uploadProductImage).toHaveBeenCalledWith(1, replacement)
		);

		await fireEvent.click(
			view.getByRole('button', { name: 'Alisin ang larawan ng Chicken adobo' })
		);
		await waitFor(() => expect(endpointMocks.deleteProductImage).toHaveBeenCalledWith(1));
		expect(window.confirm).toHaveBeenCalledWith(
			'Alisin ang larawan ng Chicken adobo? Hindi ito maibabalik.'
		);
		await waitFor(() =>
			expect(
				(
					view.getByRole('button', {
						name: 'Alisin ang larawan ng Chicken adobo'
					}) as HTMLButtonElement
				).disabled
			).toBe(true)
		);
	});

	it.each([
		[400, 'Hindi tinanggap ang larawan'],
		[401, 'Tapos na ang admin session'],
		[403, 'Walang pahintulot ang account'],
		[404, 'Hindi na makita ang ulam'],
		[429, 'Masyadong maraming request'],
		[503, 'Hindi available ang object storage']
	])('maps row image upload status %s to actionable copy', async (status, message) => {
		endpointMocks.uploadProductImage.mockRejectedValueOnce(new ApiError(status, 'Upload failed.'));
		const view = await renderMenu();
		const file = new File(['image'], 'dish.png', { type: 'image/png' });
		await fireEvent.change(view.getByLabelText('Ikabit ang larawan ng Chicken adobo'), {
			target: { files: [file] }
		});

		expect(await view.findByText(message, { exact: false })).not.toBeNull();
	});

	it('revokes form preview URLs on replacement, clear, and unmount', async () => {
		const view = await renderMenu();
		const input = view.getByLabelText(/^Larawan opsyonal/);
		const first = new File(['one'], 'one.png', { type: 'image/png' });
		const second = new File(['two'], 'two.png', { type: 'image/png' });
		const third = new File(['three'], 'three.png', { type: 'image/png' });

		await fireEvent.change(input, { target: { files: [first] } });
		const firstCall = objectUrlCreate.mock.calls.findIndex((call) => call[0] === first);
		const firstUrl = objectUrlCreate.mock.results[firstCall]?.value;
		await fireEvent.change(input, { target: { files: [second] } });
		const secondCall = objectUrlCreate.mock.calls.findIndex((call) => call[0] === second);
		const secondUrl = objectUrlCreate.mock.results[secondCall]?.value;
		expect(objectUrlRevoke).toHaveBeenCalledWith(firstUrl);

		await fireEvent.click(view.getByRole('button', { name: 'Alisin ang napiling larawan' }));
		expect(objectUrlRevoke).toHaveBeenCalledWith(secondUrl);

		await fireEvent.change(input, { target: { files: [third] } });
		const thirdCall = objectUrlCreate.mock.calls.findIndex((call) => call[0] === third);
		const thirdUrl = objectUrlCreate.mock.results[thirdCall]?.value;
		view.unmount();
		expect(objectUrlRevoke).toHaveBeenCalledWith(thirdUrl);
	});
});
