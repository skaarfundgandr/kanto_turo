import type { Order, OrderStatus } from '../api/types';
import { parsePriceToCents } from './money';
import { ORDER_STATUS_LABELS } from './status';

/** The board refreshes often enough for a demo without competing with actions. */
export const ADMIN_POLL_INTERVAL_MS = 15_000;

export type AdminOrderFilter = 'all' | OrderStatus;

export const ADMIN_ORDER_FILTERS: readonly AdminOrderFilter[] = [
	'all',
	'Pending',
	'Accepted',
	'Ready',
	'Completed',
	'Cancelled'
];

export function adminOrderFilterLabel(filter: AdminOrderFilter): string {
	return filter === 'all' ? 'Lahat' : ORDER_STATUS_LABELS[filter];
}

export function parseAdminDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const normalized = value.includes('T') ? value : value.replace(' ', 'T');
	const date = new Date(normalized);
	return Number.isNaN(date.getTime()) ? null : date;
}

function orderTime(order: Order): number {
	return parseAdminDate(order.created_at ?? order.updated_at)?.getTime() ?? 0;
}

/** Orders are server-fetched but sorted locally because the endpoint is unpaginated. */
export function sortOrdersNewestFirst(orders: readonly Order[]): Order[] {
	return [...orders].sort((left, right) => {
		const timeDifference = orderTime(right) - orderTime(left);
		return timeDifference || right.order_id - left.order_id;
	});
}

export interface AdminKpis {
	todayOrders: number;
	paidRevenueCents: number;
	unpaidOrFailed: number;
}

function isSameLocalDay(left: Date, right: Date): boolean {
	return (
		left.getFullYear() === right.getFullYear() &&
		left.getMonth() === right.getMonth() &&
		left.getDate() === right.getDate()
	);
}

/** Derives display-only KPIs from the currently fetched, server-authoritative rows. */
export function deriveAdminKpis(orders: readonly Order[], now = new Date()): AdminKpis {
	let todayOrders = 0;
	let paidRevenueCents = 0;
	let unpaidOrFailed = 0;

	for (const order of orders) {
		const created = parseAdminDate(order.created_at);
		if (created && isSameLocalDay(created, now)) todayOrders += 1;

		if (order.payment_status === 'paid') {
			try {
				paidRevenueCents += parsePriceToCents(order.total_amount);
			} catch {
				// A malformed server amount contributes no fabricated revenue.
			}
		} else if (order.payment_status === 'unpaid' || order.payment_status === 'failed') {
			unpaidOrFailed += 1;
		}
	}

	return { todayOrders, paidRevenueCents, unpaidOrFailed };
}

export function formatAdminDate(value: string | null | undefined): string {
	const date = parseAdminDate(value);
	if (!date) return 'Walang petsa';
	return new Intl.DateTimeFormat('fil-PH', {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(date);
}

export function formatAdminDateTime(value: string | null | undefined): string | undefined {
	return parseAdminDate(value)?.toISOString();
}
