import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Order, Product } from '../src/lib/api/types';
import { ApiError } from '../src/lib/api/errors';
import { isUnrecoverableReceiptError, receiptProblemFor } from '../src/lib/utils/receipt';
import { startPolling } from '../src/lib/utils/polling';
import { orderLinkToReceiptUrl, parseOrderLink } from '../src/lib/utils/order-link';
import { cart } from '../src/lib/stores/cart';
import CheckoutPage from '../src/routes/checkout/+page.svelte';
import ReceiptPage from '../src/routes/order/[id]/+page.svelte';

const endpointMocks = vi.hoisted(() => ({
	createGuestOrder: vi.fn(),
	getSignedOrder: vi.fn(),
	listProducts: vi.fn(),
	paySignedOrder: vi.fn()
}));

const navigationMocks = vi.hoisted(() => ({
	afterNavigate: vi.fn(),
	afterNavigateCallback: null as (() => void) | null
}));

const routerMocks = vi.hoisted(() => ({
	goto: vi.fn(() => Promise.resolve()),
	page: {
		url: new URL('http://localhost/base/order/42?exp=1700000000&sig=sig%2Bvalue'),
		params: { id: '42' }
	},
	resolve: vi.fn((path: string, params?: { id?: string }) =>
		path === '/order/[id]' ? `/base/order/${params?.id}` : `/base${path}`
	)
}));

const qrMocks = vi.hoisted(() => ({
	toDataURL: vi.fn(async () => 'data:image/png;base64,receipt')
}));

vi.mock('../src/lib/api/endpoints', () => endpointMocks);
vi.mock('$app/navigation', () => ({
	afterNavigate: navigationMocks.afterNavigate,
	goto: routerMocks.goto
}));
vi.mock('$app/paths', () => ({ base: '/base', resolve: routerMocks.resolve }));
vi.mock('$app/state', () => ({ page: routerMocks.page }));
vi.mock('qrcode', () => ({ default: qrMocks }));

const product: Product = {
	product_id: 1,
	name: 'Chicken adobo',
	description: null,
	price: '123.45',
	product_image_uri: null,
	categories: []
};

const order: Order = {
	order_id: 42,
	user_id: null,
	products: [
		{
			product,
			quantity: 2,
			unit_price: '123.45',
			line_total: '246.90'
		}
	],
	total_amount: '246.90',
	status: 'Pending',
	payment_status: 'unpaid',
	created_at: null,
	updated_at: null
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function setReceiptLocation(query = 'exp=1700000000&sig=sig%2Bvalue', orderId = 42): void {
	routerMocks.page.url = new URL(`http://localhost/base/order/${orderId}?${query}`);
	routerMocks.page.params = { id: String(orderId) };
}

beforeEach(() => {
	vi.clearAllMocks();
	navigationMocks.afterNavigateCallback = null;
	navigationMocks.afterNavigate.mockImplementation((callback: () => void) => {
		navigationMocks.afterNavigateCallback = callback;
	});
	cart.clear();
	localStorage.clear();
	routerMocks.page.url = new URL('http://localhost/');
	routerMocks.page.params = { id: '42' };
	endpointMocks.listProducts.mockResolvedValue([product]);
	endpointMocks.getSignedOrder.mockResolvedValue(order);
	endpointMocks.paySignedOrder.mockResolvedValue({
		order_id: 42,
		payment_status: 'paid',
		message: 'Payment successful'
	});
	qrMocks.toDataURL.mockResolvedValue('data:image/png;base64,receipt');
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
	cart.clear();
	localStorage.clear();
	navigationMocks.afterNavigateCallback = null;
	delete (navigator as { clipboard?: unknown }).clipboard;
});

describe('Phase 5 checkout', () => {
	it('reconciles the cart, prevents duplicate submit, and clears once after confirmation', async () => {
		cart.addItem(product, 2);
		const response = {
			order,
			order_url: 'https://api.test/api/v1/orders/42?exp=1700000000&sig=sig%2Bvalue'
		};
		const request = deferred<typeof response>();
		endpointMocks.createGuestOrder.mockReturnValue(request.promise);
		const clearSpy = vi.spyOn(cart, 'clear');

		const view = render(CheckoutPage);
		const submit = await view.findByRole('button', { name: 'Ipadala ang order' });
		const form = view.container.querySelector('form');
		expect(form).not.toBeNull();

		await fireEvent.submit(form as HTMLFormElement);
		await fireEvent.submit(form as HTMLFormElement);
		expect(endpointMocks.createGuestOrder).toHaveBeenCalledTimes(1);
		expect(endpointMocks.createGuestOrder).toHaveBeenCalledWith([{ product_id: 1, quantity: 2 }]);
		expect(submit.hasAttribute('disabled')).toBe(true);
		expect(clearSpy).not.toHaveBeenCalled();
		expect(get(cart)).toHaveLength(1);

		request.resolve(response);
		await waitFor(() => expect(routerMocks.goto).toHaveBeenCalledTimes(1));
		expect(clearSpy).toHaveBeenCalledTimes(1);
		expect(get(cart)).toHaveLength(0);
		expect(localStorage.getItem('kanto:cart')).not.toContain('sig%2Bvalue');
		expect(routerMocks.goto).toHaveBeenCalledWith('/base/order/42?exp=1700000000&sig=sig%2Bvalue');
	});

	it('preserves the cart when guest order creation fails', async () => {
		cart.addItem(product);
		endpointMocks.createGuestOrder.mockRejectedValue(new Error('Network error.'));

		const view = render(CheckoutPage);
		await fireEvent.click(await view.findByRole('button', { name: 'Ipadala ang order' }));

		await waitFor(() => expect(view.getByText(/Network error/)).not.toBeNull());
		expect(get(cart)).toHaveLength(1);
		expect(endpointMocks.createGuestOrder).toHaveBeenCalledTimes(1);
		expect(routerMocks.goto).not.toHaveBeenCalled();
	});

	it('keeps an in-memory receipt recovery link when navigation fails', async () => {
		cart.addItem(product);
		const response = {
			order,
			order_url: 'https://api.test/api/v1/orders/42?exp=1700000000&sig=sig%2Bvalue'
		};
		const clearSpy = vi.spyOn(cart, 'clear');
		endpointMocks.createGuestOrder.mockResolvedValue(response);
		routerMocks.goto.mockRejectedValue(new Error('Navigation failed.'));

		const view = render(CheckoutPage);
		await fireEvent.click(await view.findByRole('button', { name: 'Ipadala ang order' }));

		const recoveryLink = await view.findByRole('link', { name: 'Buksan ang resibo' });
		expect(recoveryLink.getAttribute('href')).toBe(
			'http://localhost:3000/base/order/42?exp=1700000000&sig=sig%2Bvalue'
		);
		expect(clearSpy).toHaveBeenCalledTimes(1);
		expect(get(cart)).toHaveLength(0);
		expect(localStorage.getItem('kanto:cart')).not.toContain('sig');
	});

	it('clears a confirmed order cart even after checkout unmounts', async () => {
		cart.addItem(product);
		const response = {
			order,
			order_url: 'https://api.test/api/v1/orders/42?exp=1700000000&sig=sig%2Bvalue'
		};
		const request = deferred<typeof response>();
		const clearSpy = vi.spyOn(cart, 'clear');
		endpointMocks.createGuestOrder.mockReturnValue(request.promise);

		const view = render(CheckoutPage);
		await fireEvent.click(await view.findByRole('button', { name: 'Ipadala ang order' }));
		view.unmount();
		request.resolve(response);

		await waitFor(() => expect(clearSpy).toHaveBeenCalledTimes(1));
		expect(get(cart)).toHaveLength(0);
		expect(routerMocks.goto).not.toHaveBeenCalled();
	});
});

describe('Phase 5 signed receipt validation and errors', () => {
	it('keeps signed query values when converting an API link to the frontend route', () => {
		const parsed = parseOrderLink(
			'https://api.test/api/v1/orders/42?exp=1700000000&sig=sig%2Bvalue'
		);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(orderLinkToReceiptUrl(parsed.link, 'http://localhost/base')).toBe(
			'http://localhost/base/order/42?exp=1700000000&sig=sig%2Bvalue'
		);
	});

	it('renders missing or malformed signed links as a 403 UX without fetching', async () => {
		setReceiptLocation('exp=1700000000');
		const view = render(ReceiptPage);

		expect(await view.findByText(/403/)).not.toBeNull();
		expect(view.getByText(/Hindi kumpleto o malformed/)).not.toBeNull();
		expect(endpointMocks.getSignedOrder).not.toHaveBeenCalled();
	});

	it.each([
		[400, 'Hindi wasto ang signed link'],
		[404, 'Hindi mahanap ang order'],
		[410, 'Nag-expire ang signed link'],
		[0, 'Walang koneksyon'],
		[503, 'Sandaling hindi available']
	])('maps signed receipt HTTP %s and network failures to explicit UX', async (status, copy) => {
		setReceiptLocation();
		endpointMocks.getSignedOrder.mockRejectedValue(
			new ApiError(status, status === 0 ? 'Network error.' : 'backend failure')
		);
		const view = render(ReceiptPage);

		expect(await view.findByText(new RegExp(String(copy)))).not.toBeNull();
	});
});

describe('Phase 5 receipt polling, QR, copy, and payment', () => {
	it('stops polling after terminal fulfillment and unrecoverable signed errors', async () => {
		vi.useFakeTimers();
		const terminalFetch = vi.fn(async () => ({ status: 'Completed' as const }));
		startPolling(terminalFetch, (value) => value.status === 'Completed', {
			intervalMs: 1000,
			isVisible: () => true,
			isOnline: () => true
		});
		vi.advanceTimersByTime(1000);
		await vi.runAllTicks();
		vi.advanceTimersByTime(3000);
		expect(terminalFetch).toHaveBeenCalledTimes(1);

		const signedErrorFetch = vi
			.fn<() => Promise<never>>()
			.mockRejectedValue(new ApiError(410, 'Expired.'));
		startPolling(signedErrorFetch, () => false, {
			intervalMs: 1000,
			isVisible: () => true,
			isOnline: () => true,
			shouldStopOnError: isUnrecoverableReceiptError
		});
		vi.advanceTimersByTime(1000);
		await vi.runAllTicks();
		vi.advanceTimersByTime(3000);
		expect(signedErrorFetch).toHaveBeenCalledTimes(1);
		expect(receiptProblemFor(new ApiError(410, 'Expired.'))).toBe('expired');
	});

	it('pauses stale receipt updates during payment and preserves feedback afterward', async () => {
		vi.useFakeTimers();
		setReceiptLocation();
		const stalePoll = deferred<Order>();
		endpointMocks.getSignedOrder
			.mockResolvedValueOnce(order)
			.mockReturnValueOnce(stalePoll.promise)
			.mockResolvedValue({ ...order, payment_status: 'paid' });
		endpointMocks.paySignedOrder.mockResolvedValue({
			order_id: 42,
			payment_status: 'paid',
			message: 'Payment successful'
		});

		const view = render(ReceiptPage);
		await view.findByRole('button', { name: 'Bayaran ang order' });
		await vi.advanceTimersByTimeAsync(8000);
		await waitFor(() => expect(endpointMocks.getSignedOrder).toHaveBeenCalledTimes(2));

		await fireEvent.click(view.getByRole('button', { name: 'Bayaran ang order' }));
		await waitFor(() => expect(view.getByText('Payment successful')).not.toBeNull());
		expect(view.getByText('Payment successful')).toBe(document.activeElement);

		stalePoll.resolve({ ...order, payment_status: 'unpaid' });
		await vi.runAllTicks();
		expect(view.getByText('BAYAD NA')).not.toBeNull();
		expect(view.getByText('Payment successful')).not.toBeNull();

		await vi.advanceTimersByTimeAsync(8000);
		await waitFor(() => expect(endpointMocks.getSignedOrder).toHaveBeenCalledTimes(3));
		expect(view.getByText('BAYAD NA')).not.toBeNull();
		expect(view.getByText('Payment successful')).not.toBeNull();
	});

	it('keeps polling when a terminal result resolves during payment', async () => {
		vi.useFakeTimers();
		setReceiptLocation();
		const terminalPoll = deferred<Order>();
		const paymentRequest = deferred<{
			order_id: number;
			payment_status: 'paid' | 'failed';
			message: string;
		}>();
		endpointMocks.getSignedOrder
			.mockResolvedValueOnce(order)
			.mockReturnValueOnce(terminalPoll.promise)
			.mockResolvedValue({ ...order, status: 'Completed', payment_status: 'paid' });
		endpointMocks.paySignedOrder.mockReturnValue(paymentRequest.promise);

		const view = render(ReceiptPage);
		await view.findByRole('button', { name: 'Bayaran ang order' });
		await vi.advanceTimersByTimeAsync(8000);
		await waitFor(() => expect(endpointMocks.getSignedOrder).toHaveBeenCalledTimes(2));

		await fireEvent.click(view.getByRole('button', { name: 'Bayaran ang order' }));
		terminalPoll.resolve({ ...order, status: 'Completed' });
		await vi.runAllTicks();
		expect(view.getAllByText('Tinanggap')).toHaveLength(2);

		paymentRequest.resolve({
			order_id: 42,
			payment_status: 'paid',
			message: 'Payment successful'
		});
		await waitFor(() => expect(view.getByText('Payment successful')).not.toBeNull());

		await vi.advanceTimersByTimeAsync(8000);
		await waitFor(() => expect(endpointMocks.getSignedOrder).toHaveBeenCalledTimes(3));
		expect(view.getAllByText('Nakuha na')).toHaveLength(2);
	});

	it('moves unrecoverable payment recovery failures to the matching receipt problem', async () => {
		setReceiptLocation();
		endpointMocks.paySignedOrder.mockRejectedValue(new ApiError(410, 'Expired.'));
		const view = render(ReceiptPage);

		await fireEvent.click(await view.findByRole('button', { name: 'Bayaran ang order' }));
		expect(await view.findByText('Nag-expire ang signed link (410)')).not.toBeNull();
		expect(view.container.querySelector('[data-receipt-state="expired"]')).not.toBeNull();
		expect(view.queryByRole('button', { name: 'Bayaran ang order' })).toBeNull();
	});

	it('uses the receipt problem UX when a 409 refresh has an unrecoverable error', async () => {
		setReceiptLocation();
		endpointMocks.getSignedOrder
			.mockResolvedValueOnce(order)
			.mockRejectedValueOnce(new ApiError(403, 'Forbidden.'));
		endpointMocks.paySignedOrder.mockRejectedValue(new ApiError(409, 'Already paid.'));
		const view = render(ReceiptPage);

		await fireEvent.click(await view.findByRole('button', { name: 'Bayaran ang order' }));
		expect(await view.findByText('Hindi makuha ang resibo (403)')).not.toBeNull();
		expect(view.queryByRole('button', { name: 'Bayaran ang order' })).toBeNull();
		expect(endpointMocks.getSignedOrder).toHaveBeenCalledTimes(2);
	});

	it('generates the exact full receipt URL and reports safe copy feedback', async () => {
		setReceiptLocation();
		const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
		const view = render(ReceiptPage);

		const qr = await view.findByRole('img', { name: 'QR code para sa buong link ng resibo' });
		expect(qr.getAttribute('src')).toBe('data:image/png;base64,receipt');
		expect(qrMocks.toDataURL).toHaveBeenCalledWith(
			'http://localhost/base/order/42?exp=1700000000&sig=sig%2Bvalue',
			expect.any(Object)
		);

		const copyButton = view.getByRole('button', { name: 'Kopyahin ang link' });
		await fireEvent.click(copyButton);
		await waitFor(() => expect(copyButton.dataset.copyState).toBe('copied'));
		expect(clipboard.writeText).toHaveBeenCalledWith(
			'http://localhost/base/order/42?exp=1700000000&sig=sig%2Bvalue'
		);
		expect(copyButton.textContent).toContain('Nakopya na');
	});

	it('reports QR generation and clipboard failures without losing the receipt', async () => {
		setReceiptLocation();
		qrMocks.toDataURL.mockRejectedValue(new Error('QR unavailable.'));
		const clipboard = { writeText: vi.fn().mockRejectedValue(new Error('Clipboard unavailable.')) };
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });

		const view = render(ReceiptPage);
		expect(await view.findByText(/Hindi nabuo ang QR/)).not.toBeNull();
		const copyButton = view.getByRole('button', { name: 'Kopyahin ang link' });
		await fireEvent.click(copyButton);

		await waitFor(() => expect(copyButton.dataset.copyState).toBe('failed'));
		expect(copyButton.textContent).toContain('Hindi nakopya');
	});

	it('does not offer payment for a cancelled order', async () => {
		setReceiptLocation();
		endpointMocks.getSignedOrder.mockResolvedValue({ ...order, status: 'Cancelled' });
		const view = render(ReceiptPage);

		expect((await view.findAllByText('Kinansela')).length).toBeGreaterThan(0);
		expect(view.queryByRole('button', { name: 'Bayaran ang order' })).toBeNull();
	});

	it('reinitializes safely when the same route receives a new signed query', async () => {
		setReceiptLocation();
		const staleInitial = deferred<Order>();
		endpointMocks.getSignedOrder.mockReset();
		endpointMocks.getSignedOrder.mockReturnValueOnce(staleInitial.promise).mockResolvedValue(order);
		const view = render(ReceiptPage);
		await waitFor(() => expect(endpointMocks.getSignedOrder).toHaveBeenCalledTimes(1));

		setReceiptLocation('exp=1700000000&sig=new-value');
		expect(navigationMocks.afterNavigateCallback).not.toBeNull();
		navigationMocks.afterNavigateCallback?.();
		await waitFor(() => expect(endpointMocks.getSignedOrder).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(view.getByText('Order #42')).not.toBeNull());
		expect(qrMocks.toDataURL).toHaveBeenCalledWith(
			'http://localhost/base/order/42?exp=1700000000&sig=new-value',
			expect.any(Object)
		);

		staleInitial.resolve({ ...order, payment_status: 'failed' });
		await Promise.resolve();
		await Promise.resolve();
		expect(view.queryByText('HINDI TINANGGAP')).toBeNull();
	});

	it('reinitializes when browser history changes the signed receipt query', async () => {
		setReceiptLocation();
		const view = render(ReceiptPage);
		await view.findByText('Order #42');

		setReceiptLocation('exp=1700000000&sig=popstate-value');
		window.dispatchEvent(new Event('popstate'));
		await waitFor(() => expect(endpointMocks.getSignedOrder).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(view.getByText('Order #42')).not.toBeNull());
		expect(qrMocks.toDataURL).toHaveBeenLastCalledWith(
			'http://localhost/base/order/42?exp=1700000000&sig=popstate-value',
			expect.any(Object)
		);
	});

	it('handles paid, failed, already-paid, and duplicate payment outcomes', async () => {
		setReceiptLocation();
		const view = render(ReceiptPage);
		const payButton = await view.findByRole('button', { name: 'Bayaran ang order' });

		const paymentRequest = deferred<{
			order_id: number;
			payment_status: 'paid' | 'failed';
			message: string;
		}>();
		endpointMocks.paySignedOrder.mockReturnValue(paymentRequest.promise);
		await fireEvent.click(payButton);
		await fireEvent.click(payButton);
		expect(endpointMocks.paySignedOrder).toHaveBeenCalledTimes(1);
		paymentRequest.resolve({ order_id: 42, payment_status: 'paid', message: 'Payment successful' });
		await waitFor(() => expect(view.getByText('BAYAD NA')).not.toBeNull());
		expect(view.getByText('Payment successful')).not.toBeNull();
		expect(view.getAllByText('₱246.90')).toHaveLength(2);

		cleanup();
		endpointMocks.getSignedOrder.mockResolvedValue(order);
		endpointMocks.paySignedOrder.mockResolvedValue({
			order_id: 42,
			payment_status: 'failed',
			message: 'Payment failed: amount exceeds the maximum allowed'
		});
		const failedView = render(ReceiptPage);
		await fireEvent.click(await failedView.findByRole('button', { name: 'Bayaran ang order' }));
		await waitFor(() => expect(failedView.getByText('HINDI TINANGGAP')).not.toBeNull());
		expect(failedView.getByText(/amount exceeds/)).not.toBeNull();
		await waitFor(() =>
			expect(failedView.getByText(/amount exceeds/)).toBe(document.activeElement)
		);
		expect(failedView.getAllByText('₱246.90')).toHaveLength(2);

		cleanup();
		const paidOrder = { ...order, payment_status: 'paid' as const };
		endpointMocks.getSignedOrder.mockClear();
		endpointMocks.getSignedOrder.mockResolvedValueOnce(order).mockResolvedValueOnce(paidOrder);
		endpointMocks.paySignedOrder.mockRejectedValue(new ApiError(409, 'Order already paid'));
		const conflictView = render(ReceiptPage);
		await fireEvent.click(await conflictView.findByRole('button', { name: 'Bayaran ang order' }));
		await waitFor(() => expect(conflictView.getByText('BAYAD NA')).not.toBeNull());
		await waitFor(() =>
			expect(conflictView.getByText('Bayad na ang order.')).toBe(document.activeElement)
		);
		expect(endpointMocks.getSignedOrder).toHaveBeenCalledTimes(2);
	});
});
