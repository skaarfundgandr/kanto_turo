import type { OrderStatus, PaymentStatus } from '../api/types';

/**
 * The single typed source of the locked status contract. Customer-facing
 * copy is fixed; requests always send the exact backend enum values and
 * Requests always use one of the exact backend order values below.
 */

export const ORDER_STATUSES: readonly OrderStatus[] = [
	'Pending',
	'Accepted',
	'Ready',
	'Completed',
	'Cancelled'
];

export const PAYMENT_STATUSES: readonly PaymentStatus[] = ['unpaid', 'paid', 'failed'];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
	Pending: 'Tinanggap',
	Accepted: 'Niluluto',
	Ready: 'Handa na',
	Completed: 'Nakuha na',
	Cancelled: 'Kinansela'
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
	unpaid: 'Hindi pa bayad',
	paid: 'Bayad na',
	failed: 'Hindi tinanggap'
};

export type StatusTone = 'neutral' | 'accent' | 'warning' | 'positive' | 'negative';

export const ORDER_STATUS_TONES: Record<OrderStatus, StatusTone> = {
	Pending: 'neutral',
	Accepted: 'accent',
	Ready: 'warning',
	Completed: 'positive',
	Cancelled: 'negative'
};

export const PAYMENT_STATUS_TONES: Record<PaymentStatus, StatusTone> = {
	unpaid: 'neutral',
	paid: 'positive',
	failed: 'negative'
};

export function isOrderStatus(value: unknown): value is OrderStatus {
	return typeof value === 'string' && ORDER_STATUSES.some((status) => status === value);
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
	return typeof value === 'string' && PAYMENT_STATUSES.some((status) => status === value);
}

/** Orders in a terminal state stop polling and further progression. */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
	return status === 'Completed' || status === 'Cancelled';
}

/**
 * The next status in the enforced frontend progression
 * `Pending -> Accepted -> Ready -> Completed`. Returns `null` when the order
 * cannot advance (terminal or already Cancelled).
 */
export function nextOrderStatus(status: OrderStatus): OrderStatus | null {
	switch (status) {
		case 'Pending':
			return 'Accepted';
		case 'Accepted':
			return 'Ready';
		case 'Ready':
			return 'Completed';
		default:
			return null;
	}
}

export function canAdvanceOrderStatus(status: OrderStatus): boolean {
	return nextOrderStatus(status) !== null;
}

/** Cancellation is separate from the progress path and only legal pre-commit. */
export function canCancelOrder(status: OrderStatus): boolean {
	return status === 'Pending' || status === 'Accepted' || status === 'Ready';
}
