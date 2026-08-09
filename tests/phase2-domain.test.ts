import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/errors';
import {
	isOrderLinkExpired,
	orderLinkToReceiptUrl,
	parseOrderLink
} from '../src/lib/utils/order-link';
import { startPolling } from '../src/lib/utils/polling';
import {
	canAdvanceOrderStatus,
	canCancelOrder,
	isOrderStatus,
	isPaymentStatus,
	isTerminalOrderStatus,
	nextOrderStatus,
	ORDER_STATUS_LABELS,
	ORDER_STATUS_TONES,
	ORDER_STATUSES,
	PAYMENT_STATUS_LABELS,
	PAYMENT_STATUS_TONES,
	PAYMENT_STATUSES
} from '../src/lib/utils/status';

afterEach(() => {
	vi.useRealTimers();
});

describe('signed order links', () => {
	it('validates an API link and passes exp/sig to the frontend URL', () => {
		const parsed = parseOrderLink(
			'https://api.example.test/api/v1/orders/42?exp=1700000000&sig=signature-value'
		);
		expect(parsed).toEqual({
			ok: true,
			link: { orderId: 42, exp: '1700000000', sig: 'signature-value' }
		});
		if (!parsed.ok) return;

		const receipt = orderLinkToReceiptUrl(parsed.link, 'https://frontend.example.test/');
		const receiptUrl = new URL(receipt);
		expect(receiptUrl.pathname).toBe('/order/42');
		expect(receiptUrl.searchParams.get('exp')).toBe('1700000000');
		expect(receiptUrl.searchParams.get('sig')).toBe('signature-value');
		expect(
			orderLinkToReceiptUrl(
				parsed.link,
				'https://frontend.example.test/receipt?old=query#old-fragment'
			)
		).toBe('https://frontend.example.test/receipt/order/42?exp=1700000000&sig=signature-value');
	});

	it('accepts the frontend receipt shape and preserves encoded query values', () => {
		const parsed = parseOrderLink(
			'https://frontend.example.test/order/42?exp=1700000000&sig=signature%2Bvalue'
		);
		expect(parsed).toEqual({
			ok: true,
			link: { orderId: 42, exp: '1700000000', sig: 'signature+value' }
		});
		if (!parsed.ok) return;

		expect(orderLinkToReceiptUrl(parsed.link, 'http://127.0.0.1:5173')).toBe(
			'http://127.0.0.1:5173/order/42?exp=1700000000&sig=signature%2Bvalue'
		);
		expect(parseOrderLink('/order/42?exp=1&sig=x')).toMatchObject({
			ok: false,
			reason: 'invalid-url'
		});
	});

	it('rejects unsafe or malformed links and detects expiry', () => {
		expect(parseOrderLink('/orders/42?exp=1&sig=x')).toMatchObject({
			ok: false,
			reason: 'invalid-url'
		});
		expect(parseOrderLink('https://api.test/orders/42/pay?exp=1&sig=x')).toMatchObject({
			ok: false,
			reason: 'not-order-path'
		});
		expect(parseOrderLink('https://api.test/orders/42?exp=1')).toMatchObject({
			ok: false,
			reason: 'missing-sig'
		});
		expect(parseOrderLink('https://api.test/orders/42?exp=not-a-number&sig=x')).toMatchObject({
			ok: false,
			reason: 'invalid-exp'
		});
		expect(parseOrderLink('https://api.test/order/1.5?exp=1&sig=x')).toMatchObject({
			ok: false,
			reason: 'invalid-id'
		});

		const link = { orderId: 42, exp: '100', sig: 'x' };
		expect(isOrderLinkExpired(link, 100)).toBe(true);
		expect(isOrderLinkExpired(link, 99)).toBe(false);
		expect(isOrderLinkExpired({ ...link, exp: 'invalid' }, 1)).toBe(true);
	});
});

describe('status contract and legal actions', () => {
	it('maps every backend order and payment value without Preparing', () => {
		expect(ORDER_STATUSES).toEqual(['Pending', 'Accepted', 'Ready', 'Completed', 'Cancelled']);
		expect(PAYMENT_STATUSES).toEqual(['unpaid', 'paid', 'failed']);
		expect(ORDER_STATUS_LABELS).toEqual({
			Pending: 'Tinanggap',
			Accepted: 'Niluluto',
			Ready: 'Handa na',
			Completed: 'Nakuha na',
			Cancelled: 'Kinansela'
		});
		expect(Object.keys(PAYMENT_STATUS_LABELS)).toEqual(['unpaid', 'paid', 'failed']);
		expect(Object.keys(ORDER_STATUS_TONES)).toEqual(ORDER_STATUSES);
		expect(Object.keys(PAYMENT_STATUS_TONES)).toEqual(PAYMENT_STATUSES);
		expect(isOrderStatus('Preparing')).toBe(false);
		expect(isPaymentStatus('pending')).toBe(false);

		expect(nextOrderStatus('Pending')).toBe('Accepted');
		expect(nextOrderStatus('Accepted')).toBe('Ready');
		expect(nextOrderStatus('Ready')).toBe('Completed');
		expect(nextOrderStatus('Completed')).toBeNull();
		expect(nextOrderStatus('Cancelled')).toBeNull();
		expect(canAdvanceOrderStatus('Ready')).toBe(true);
		expect(canAdvanceOrderStatus('Completed')).toBe(false);
		expect(canCancelOrder('Pending')).toBe(true);
		expect(canCancelOrder('Ready')).toBe(true);
		expect(canCancelOrder('Completed')).toBe(false);
		expect(isTerminalOrderStatus('Completed')).toBe(true);
		expect(isTerminalOrderStatus('Cancelled')).toBe(true);
		expect(isTerminalOrderStatus('Accepted')).toBe(false);
	});
});

describe('visibility-aware polling', () => {
	it('pauses while hidden/offline, resumes, and cleans up after stop', async () => {
		vi.useFakeTimers();
		let visible = false;
		let online = true;
		const fetchResult = vi.fn(async () => ({ done: fetchResult.mock.calls.length >= 2 }));
		const handle = startPolling(fetchResult, (result) => result.done, {
			intervalMs: 1000,
			isVisible: () => visible,
			isOnline: () => online
		});

		vi.advanceTimersByTime(1000);
		expect(fetchResult).not.toHaveBeenCalled();

		visible = true;
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.runAllTicks();
		expect(fetchResult).toHaveBeenCalledTimes(1);

		online = false;
		vi.advanceTimersByTime(1000);
		expect(fetchResult).toHaveBeenCalledTimes(1);

		online = true;
		window.dispatchEvent(new Event('online'));
		await vi.runAllTicks();
		expect(fetchResult).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(5000);
		expect(fetchResult).toHaveBeenCalledTimes(2);

		handle.stop();
		vi.advanceTimersByTime(5000);
		document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('online'));
		expect(fetchResult).toHaveBeenCalledTimes(2);
	});

	it('stops on caller-marked terminal errors but keeps retrying transient errors', async () => {
		vi.useFakeTimers();
		const fetchResult = vi
			.fn<() => Promise<{ done: boolean }>>()
			.mockRejectedValueOnce(new Error('offline'))
			.mockRejectedValueOnce(new ApiError(410, 'Expired.'));
		const handle = startPolling(fetchResult, (result) => result.done, {
			intervalMs: 1000,
			isVisible: () => true,
			isOnline: () => true,
			shouldStopOnError: (error) =>
				error instanceof ApiError && [400, 403, 410].includes(error.status)
		});

		await vi.advanceTimersByTimeAsync(1000);
		expect(fetchResult).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetchResult).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchResult).toHaveBeenCalledTimes(2);
		handle.stop();
	});

	it('does not make rejected fetches terminal by default', async () => {
		vi.useFakeTimers();
		const fetchResult = vi
			.fn<() => Promise<{ done: boolean }>>()
			.mockRejectedValueOnce(new ApiError(410, 'Expired.'))
			.mockResolvedValueOnce({ done: false });
		const handle = startPolling(fetchResult, (result) => result.done, {
			intervalMs: 1000,
			isVisible: () => true,
			isOnline: () => true
		});

		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetchResult).toHaveBeenCalledTimes(2);
		handle.stop();
	});
});
