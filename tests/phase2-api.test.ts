import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../src/lib/api/client';
import {
	cancelOrder,
	createProduct,
	createGuestOrder,
	deleteOrder,
	deleteProductImage,
	getOrderingQr,
	getProduct,
	getSignedOrder,
	getUser,
	listCategories,
	listCategoryProducts,
	listOrders,
	listProducts,
	login,
	payOrder,
	paySignedOrder,
	refreshToken,
	uploadProductImage,
	updateOrderStatus
} from '../src/lib/api/endpoints';
import { ApiError } from '../src/lib/api/errors';
import { setStoredToken } from '../src/lib/api/token';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

const rawProduct = {
	product_id: 1,
	name: 'Chicken adobo',
	description: null,
	price: '10.00',
	product_image_uri: null,
	categories: null
};

const rawOrder = {
	order_id: 42,
	user_id: null,
	products: [
		{
			product: rawProduct,
			quantity: 1,
			unit_price: '10.00',
			line_total: '10.00'
		}
	],
	total_amount: '10.00',
	status: 'Pending',
	payment_status: 'unpaid',
	created_at: null,
	updated_at: null
};

const rawPayment = { order_id: 42, payment_status: 'paid', message: 'Paid.' };

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function pathOf(call: unknown[]): string {
	return new URL(String(call[0])).pathname.replace('/api/v1', '');
}

function methodOf(call: unknown[]): string {
	const init = call[1] as RequestInit | undefined;
	return init?.method ?? 'GET';
}

function authorizationOf(call: unknown[]): string | undefined {
	const init = call[1] as RequestInit | undefined;
	const headers = init?.headers as Record<string, string> | undefined;
	return headers?.Authorization;
}

describe('API client errors and endpoint policy', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		setStoredToken(null);
	});

	afterEach(() => {
		setStoredToken(null);
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('maps plain-text and every documented empty error body to ApiError safely', async () => {
		fetchMock.mockResolvedValueOnce(new Response('backend says no', { status: 403 }));
		await expect(apiRequest('/forbidden')).rejects.toMatchObject({
			status: 403,
			message: 'backend says no'
		});

		fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
		await expect(apiRequest('/missing')).rejects.toMatchObject({
			status: 404,
			message: 'Not found.'
		});

		const emptyBodyFallbacks: Record<number, string> = {
			400: 'Invalid request.',
			401: 'Not authorized.',
			403: 'Forbidden.',
			404: 'Not found.',
			409: 'Conflict.',
			410: 'Expired.',
			429: 'Too many requests.',
			500: 'Server error.',
			503: 'Service unavailable.'
		};
		for (const [status, message] of Object.entries(emptyBodyFallbacks)) {
			fetchMock.mockResolvedValueOnce(new Response('', { status: Number(status) }));
			await expect(apiRequest(`/empty-${status}`)).rejects.toMatchObject({
				status: Number(status),
				message
			});
		}

		fetchMock.mockRejectedValueOnce(new Error('offline'));
		await expect(apiRequest('/offline')).rejects.toMatchObject({
			status: 0,
			message: 'Network error.'
		});

		fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
		await expect(apiRequest('/aborted')).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('fails protected calls locally when no token exists', async () => {
		await expect(apiRequest('/orders', { auth: 'required' })).rejects.toMatchObject(
			new ApiError(401, 'Not authorized.')
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('fails protected product mutations locally when no token exists', async () => {
		await expect(createProduct({ name: 'Sinigang', price: '150.00' })).rejects.toMatchObject({
			status: 401
		});
		await expect(uploadProductImage(12, new Blob(['image']))).rejects.toMatchObject({
			status: 401
		});
		await expect(deleteProductImage(12)).rejects.toMatchObject({ status: 401 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('passes raw FormData through without setting a multipart content type', async () => {
		const body = new FormData();
		body.append('file', new Blob(['image'], { type: 'image/png' }));
		fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));

		await expect(apiRequest('/multipart', { method: 'POST', body })).resolves.toBeUndefined();

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(init.body).toBe(body);
		expect(init.headers).not.toHaveProperty('Content-Type');
	});

	it('keeps guest and signed flows unauthenticated with a stored token', async () => {
		setStoredToken('valid-or-stale-admin-token');
		fetchMock.mockImplementation(async (input: URL | RequestInfo, init?: RequestInit) => {
			const url = new URL(String(input));
			const method = init?.method ?? 'GET';
			if (url.pathname.endsWith('/products') && method === 'GET') return jsonResponse([]);
			if (url.pathname.endsWith('/products/1') && method === 'GET') return jsonResponse(rawProduct);
			if (url.pathname.endsWith('/categories') && method === 'GET') return jsonResponse([]);
			if (url.pathname.includes('/categories/') && method === 'GET') return jsonResponse([]);
			if (url.pathname.endsWith('/orders') && method === 'POST') {
				return jsonResponse({
					order: rawOrder,
					order_url: 'https://api.test/api/v1/orders/42?exp=9&sig=abc'
				});
			}
			if (url.pathname.endsWith('/orders/42') && method === 'GET') return jsonResponse(rawOrder);
			if (url.pathname.endsWith('/orders/42/pay') && method === 'POST') {
				return jsonResponse(rawPayment);
			}
			if (url.pathname.endsWith('/auth/login')) return jsonResponse({ token: 'login-token' });
			return jsonResponse([]);
		});

		await listProducts();
		await getProduct(1);
		await listCategories();
		await listCategoryProducts('Ulam & Rice');
		await createGuestOrder([{ product_id: 1, quantity: 1 }]);
		await getSignedOrder(42, '9', 'abc');
		await paySignedOrder(42, '9', 'abc');
		await login('admin', 'password');
		setStoredToken('stale-admin-token');
		await createGuestOrder([{ product_id: 1, quantity: 1 }]);
		await getSignedOrder(42, '9', 'abc');
		await paySignedOrder(42, '9', 'abc');
		await login('admin', 'password');

		const guestCalls = fetchMock.mock.calls.filter((call) => {
			const path = pathOf(call);
			return (
				path === '/products' ||
				path === '/products/1' ||
				path === '/categories' ||
				path.includes('/categories/') ||
				(path === '/orders' && methodOf(call) === 'POST') ||
				(path === '/orders/42' && methodOf(call) === 'GET') ||
				(path === '/orders/42/pay' && methodOf(call) === 'POST') ||
				path === '/auth/login'
			);
		});
		expect(guestCalls.length).toBe(12);
		for (const call of guestCalls) expect(authorizationOf(call)).toBeUndefined();
	});

	it('rejects malformed JSON at the DTO boundary', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse([{ name: 'missing id', price: '10.00' }]));
		await expect(listProducts()).rejects.toMatchObject({
			status: 502,
			message: 'Unexpected response format.'
		});
	});

	it('requires auth for user, admin action, and QR endpoints', async () => {
		setStoredToken('admin-token');
		fetchMock.mockImplementation(async (input: URL | RequestInfo, init?: RequestInit) => {
			const url = new URL(String(input));
			const method = init?.method ?? 'GET';
			if (url.pathname.endsWith('/users/7'))
				return jsonResponse({ role: { permissions: ['ADMIN'] } });
			if (url.pathname.endsWith('/orders') && method === 'GET') return jsonResponse([]);
			if (url.pathname.endsWith('/orders/42') && method === 'POST') return new Response('updated');
			if (url.pathname.endsWith('/orders/42/pay')) return jsonResponse(rawPayment);
			if (url.pathname.endsWith('/orders/42/cancel')) return new Response('cancelled');
			if (url.pathname.endsWith('/orders/42') && method === 'DELETE')
				return new Response('deleted');
			if (url.pathname.endsWith('/qr/ordering')) return new Response('<svg />');
			if (url.pathname.endsWith('/auth/refresh')) return jsonResponse({ token: 'refreshed-token' });
			return jsonResponse([]);
		});

		await getUser(7);
		await refreshToken();
		await listOrders('Pending');
		await updateOrderStatus(42, 'Accepted');
		await payOrder(42);
		await cancelOrder(42);
		await deleteOrder(42);
		await getOrderingQr();

		for (const call of fetchMock.mock.calls) {
			expect(authorizationOf(call)).toBe('Bearer admin-token');
		}
		const ordersListCall = fetchMock.mock.calls.find(
			(call) => pathOf(call) === '/orders' && methodOf(call) === 'GET'
		);
		expect(new URL(String(ordersListCall?.[0])).searchParams.get('status')).toBe('Pending');
	});

	it('sends protected product JSON and image multipart requests to the generated paths', async () => {
		setStoredToken('admin-token');
		fetchMock.mockImplementation(async () => new Response('', { status: 200 }));
		const product = {
			name: 'Sinigang na Baboy',
			description: 'Maasim at mainit',
			price: '185.00',
			categories: ['Ulam']
		};
		const image = new Blob(['fake-png'], { type: 'image/png' });

		await expect(createProduct(product)).resolves.toBeUndefined();
		await expect(uploadProductImage(17, image)).resolves.toBeUndefined();
		await expect(deleteProductImage(17)).resolves.toBeUndefined();

		const [createCall, uploadCall, deleteCall] = fetchMock.mock.calls;
		expect(pathOf(createCall)).toBe('/products');
		expect(methodOf(createCall)).toBe('POST');
		expect(authorizationOf(createCall)).toBe('Bearer admin-token');
		expect((createCall[1] as RequestInit).headers).toHaveProperty(
			'Content-Type',
			'application/json'
		);
		expect((createCall[1] as RequestInit).body).toBe(JSON.stringify(product));

		expect(pathOf(uploadCall)).toBe('/products/17/image');
		expect(methodOf(uploadCall)).toBe('POST');
		expect(authorizationOf(uploadCall)).toBe('Bearer admin-token');
		expect((uploadCall[1] as RequestInit).headers).not.toHaveProperty('Content-Type');
		const uploadBody = (uploadCall[1] as RequestInit).body;
		expect(uploadBody).toBeInstanceOf(FormData);
		const uploadedFile = (uploadBody as FormData).get('file');
		expect(uploadedFile).toBeInstanceOf(Blob);
		expect((uploadedFile as Blob).size).toBe(image.size);
		expect((uploadedFile as Blob).type).toBe(image.type);

		expect(pathOf(deleteCall)).toBe('/products/17/image');
		expect(methodOf(deleteCall)).toBe('DELETE');
		expect(authorizationOf(deleteCall)).toBe('Bearer admin-token');
	});

	it('propagates documented product mutation errors for UI recovery', async () => {
		const cases = [
			{ status: 400, invoke: () => uploadProductImage(9, new Blob(['bad-image'])) },
			{ status: 401, invoke: () => uploadProductImage(9, new Blob(['image'])) },
			{ status: 403, invoke: () => deleteProductImage(9) },
			{ status: 404, invoke: () => uploadProductImage(9, new Blob(['image'])) },
			{ status: 409, invoke: () => createProduct({ name: 'Duplicate', price: '10.00' }) },
			{ status: 429, invoke: () => uploadProductImage(9, new Blob(['image'])) },
			{ status: 503, invoke: () => deleteProductImage(9) }
		];

		for (const { status, invoke } of cases) {
			setStoredToken('admin-token');
			fetchMock.mockResolvedValueOnce(new Response('', { status }));
			await expect(invoke()).rejects.toMatchObject({ status });
		}
	});

	it('accepts empty successful text responses and keeps signed query values', async () => {
		setStoredToken('stored-token');
		fetchMock.mockImplementation(async (input: URL | RequestInfo, init?: RequestInit) => {
			const url = new URL(String(input));
			if (url.pathname.endsWith('/orders/42') && (init?.method ?? 'GET') === 'GET') {
				return jsonResponse(rawOrder);
			}
			return new Response('');
		});

		await expect(updateOrderStatus(42, 'Ready')).resolves.toBe('');
		await getSignedOrder(42, '1700000000', 'sig-raw-value');
		const signedCall = fetchMock.mock.calls.find(
			(call) => pathOf(call) === '/orders/42' && methodOf(call) === 'GET'
		);
		const signedUrl = new URL(String(signedCall?.[0]));
		expect(signedUrl.searchParams.get('exp')).toBe('1700000000');
		expect(signedUrl.searchParams.get('sig')).toBe('sig-raw-value');
	});

	it('URL-encodes category names at the endpoint boundary', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse([]));

		await listCategoryProducts('Ulam & Rice');

		expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
			'/categories/Ulam%20%26%20Rice/products'
		);
	});
});
