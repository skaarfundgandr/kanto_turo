import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/errors';
import type { Order, User } from '../src/lib/api/types';
import RootLayout from '../src/routes/+layout.svelte';
import AdminLayout from '../src/routes/admin/+layout.svelte';
import AdminPage from '../src/routes/admin/+page.svelte';
import LoginPage from '../src/routes/login/+page.svelte';
import {
	deriveAdminKpis,
	formatAdminDateTime,
	sortOrdersNewestFirst
} from '../src/lib/utils/admin-orders';
import { load as adminLoad } from '../src/routes/admin/+layout';

const navigationMocks = vi.hoisted(() => ({
	goto: vi.fn().mockResolvedValue(undefined),
	resolve: (path: string) => `/base${path}`,
	page: { url: new URL('http://localhost/base/') }
}));

const endpointMocks = vi.hoisted(() => ({
	cancelOrder: vi.fn(),
	deleteOrder: vi.fn(),
	getOrderingQr: vi.fn(),
	listOrders: vi.fn(),
	login: vi.fn(),
	payOrder: vi.fn(),
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

vi.mock('$app/navigation', () => ({ goto: navigationMocks.goto }));
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

const product = {
	product_id: 1,
	name: 'Chicken adobo',
	description: null,
	price: '100.00',
	product_image_uri: null,
	categories: []
};

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
	endpointMocks.cancelOrder.mockReset();
	endpointMocks.deleteOrder.mockReset();
	endpointMocks.getOrderingQr.mockReset();
	endpointMocks.payOrder.mockReset();
	endpointMocks.updateOrderStatus.mockReset();
	navigationMocks.goto.mockResolvedValue(undefined);
	navigationMocks.page.url = new URL('http://localhost/base/');
	authMocks.resetAuthRedirectHandler();
	authMocks.setState({ status: 'authenticated', user: adminUser });
	endpointMocks.listOrders.mockResolvedValue(orders);
	endpointMocks.cancelOrder.mockResolvedValue('cancelled');
	endpointMocks.deleteOrder.mockResolvedValue('deleted');
	endpointMocks.getOrderingQr.mockResolvedValue(new Blob(['<svg />'], { type: 'image/svg+xml' }));
	endpointMocks.payOrder.mockResolvedValue({
		order_id: 1,
		payment_status: 'paid',
		message: 'Paid.'
	});
	endpointMocks.updateOrderStatus.mockResolvedValue('updated');
	setOnline(true);
	setVisible(true);
	installObjectUrlMocks();
	Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) });
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
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

	it('keeps desktop table and mobile cards data-equivalent, filters with exact backend values, and shows KPIs', async () => {
		endpointMocks.listOrders.mockImplementation(async (status?: string) =>
			status ? orders.filter((order) => order.status === status) : orders
		);
		const view = await renderBoard();
		const tableRows = Array.from(view.container.querySelectorAll('tbody tr[data-order-id]'));
		expect(tableRows.map((row) => row.getAttribute('data-order-id'))).toEqual(['1', '2', '3']);
		expect(view.container.querySelector('th[scope="col"]')).not.toBeNull();
		expect(view.container.querySelector('[data-order-card-id="1"]')?.textContent).toContain(
			'Chicken adobo'
		);
		expect(view.getAllByText('₱250.50')).not.toHaveLength(0);
		expect(view.getByText('Orders ngayong araw')).not.toBeNull();
		expect(view.getByText('1')).not.toBeNull();
		expect(view.getByRole('article', { name: 'Order #1' })).not.toBeNull();
		expect(
			view.container.querySelector('tbody tr[data-order-id="1"] time')?.getAttribute('datetime')
		).toBe(formatAdminDateTime(orders[0]?.created_at));
		expect(
			view.container.querySelector('[data-order-card-id="1"] time')?.getAttribute('datetime')
		).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		const advanceLabel = within(
			view.container.querySelector('tbody tr[data-order-id="1"]') as HTMLElement
		)
			.getByRole('button', { name: /Isulong ang order #1/ })
			.getAttribute('aria-label');
		expect(advanceLabel).not.toContain('→');

		const filter = view.getByRole('combobox', { name: 'Salain ang status ng order' });
		await fireEvent.change(filter, { target: { value: 'Pending' } });
		await waitFor(() => expect(endpointMocks.listOrders).toHaveBeenCalledWith('Pending'));
		expect(endpointMocks.listOrders).toHaveBeenCalledWith();
		expect((filter as HTMLSelectElement).value).toBe('Pending');
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

	it('ignores stale filtered rows and KPI sources after a newer selection wins', async () => {
		const pendingRows = deferred<Order[]>();
		const pendingKpiOrders = deferred<Order[]>();
		const latestAllOrders = deferred<Order[]>();
		const view = await renderBoard();
		let unfilteredCalls = 0;
		endpointMocks.listOrders.mockImplementation((status?: string) => {
			if (status === 'Pending') return pendingRows.promise;
			unfilteredCalls += 1;
			return unfilteredCalls === 1 ? pendingKpiOrders.promise : latestAllOrders.promise;
		});

		const filter = view.getByRole('combobox', { name: 'Salain ang status ng order' });
		await fireEvent.change(filter, { target: { value: 'Pending' } });
		await fireEvent.change(filter, { target: { value: 'all' } });

		latestAllOrders.resolve([orders[1]!]);
		await waitFor(() =>
			expect(
				Array.from(view.container.querySelectorAll('tbody tr[data-order-id]')).map((row) =>
					row.getAttribute('data-order-id')
				)
			).toEqual(['2'])
		);

		pendingRows.resolve([orders[0]!]);
		pendingKpiOrders.resolve([orders[2]!]);
		await waitFor(() =>
			expect(view.container.querySelector('tbody tr[data-order-id="2"]')).not.toBeNull()
		);
		const kpiGrid = view.container.querySelector('.kpi-grid') as HTMLElement;
		expect(within(kpiGrid).getByText('₱250.50')).not.toBeNull();
	});

	it('marks KPIs stale when a filtered load fails instead of showing old totals', async () => {
		const view = await renderBoard();
		endpointMocks.listOrders.mockRejectedValueOnce(new ApiError(503, 'Filtered failure.'));

		await fireEvent.change(view.getByRole('combobox', { name: 'Salain ang status ng order' }), {
			target: { value: 'Pending' }
		});

		await waitFor(() =>
			expect(view.container.querySelector('[data-kpi-stale="true"]')).not.toBeNull()
		);
		const kpiGrid = view.container.querySelector('.kpi-grid') as HTMLElement;
		expect(within(kpiGrid).getAllByText('—')).toHaveLength(3);
	});

	it('uses status-safe wording for an empty completed filter', async () => {
		const view = await renderBoard();
		endpointMocks.listOrders.mockImplementation(async (status?: string) =>
			status === 'Completed' ? [] : orders
		);

		await fireEvent.change(view.getByRole('combobox', { name: 'Salain ang status ng order' }), {
			target: { value: 'Completed' }
		});

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

	it('refetches the filtered board after a successful delete', async () => {
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
		endpointMocks.getOrderingQr.mockRejectedValueOnce(new ApiError(status, 'QR failure.'));

		await fireEvent.click(view.getByRole('button', { name: 'I-refresh ang QR' }));
		expect(await view.findByText(message, { exact: false })).not.toBeNull();
	});

	it('reports offline ordering QR refresh without calling the endpoint', async () => {
		const view = await renderBoard();
		endpointMocks.getOrderingQr.mockClear();
		setOnline(false);

		await fireEvent.click(view.getByRole('button', { name: 'I-refresh ang QR' }));
		expect(
			await view.findByText('Walang koneksyon. Subukan muli kapag online na.', { exact: false })
		).not.toBeNull();
		expect(endpointMocks.getOrderingQr).not.toHaveBeenCalled();
	});

	it('replaces and revokes ordering QR object URLs and cleans the last URL on unmount', async () => {
		const view = await renderBoard();
		await waitFor(() => expect(objectUrlCreate).toHaveBeenCalledTimes(1));
		const firstUrl = objectUrlCreate.mock.results[0]?.value;

		await fireEvent.click(view.getByRole('button', { name: 'I-refresh ang QR' }));
		await waitFor(() => expect(objectUrlCreate).toHaveBeenCalledTimes(2));
		const secondUrl = objectUrlCreate.mock.results[1]?.value;
		expect(objectUrlRevoke).toHaveBeenCalledWith(firstUrl);

		view.unmount();
		expect(objectUrlRevoke).toHaveBeenCalledWith(secondUrl);
	});

	it('uses a temporary QR URL for download without revoking the live preview URL', async () => {
		const view = await renderBoard();
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
});
