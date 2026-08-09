import type { SignedOrderLink } from '../api/types';

export type OrderLinkParseResult =
	{ ok: true; link: SignedOrderLink } | { ok: false; reason: OrderLinkFailureReason };

export type OrderLinkFailureReason =
	'invalid-url' | 'not-order-path' | 'invalid-id' | 'missing-exp' | 'invalid-exp' | 'missing-sig';

function parseAbsoluteHttpUrl(raw: string): URL | null {
	try {
		const url = new URL(raw);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
	} catch {
		return null;
	}
}

/**
 * Parses and validates a signed order link (backend `order_url` or a
 * frontend `/order/{id}` receipt URL). The order id must be a positive
 * integer and the `exp`/`sig` query values must be present. They remain
 * strings throughout parsing and URL construction; the URL serializer escapes
 * only characters that require escaping.
 */
export function parseOrderLink(raw: string): OrderLinkParseResult {
	const url = parseAbsoluteHttpUrl(raw);
	if (!url) return { ok: false, reason: 'invalid-url' };

	const segments = url.pathname.split('/').filter(Boolean);
	const pathType = segments.at(-2);
	if (pathType !== 'orders' && pathType !== 'order') {
		return { ok: false, reason: 'not-order-path' };
	}

	const rawOrderId = segments.at(-1);
	if (!rawOrderId || !/^\d+$/.test(rawOrderId)) {
		return { ok: false, reason: 'invalid-id' };
	}
	const orderId = Number(rawOrderId);
	if (!Number.isSafeInteger(orderId) || orderId <= 0) return { ok: false, reason: 'invalid-id' };

	const exp = url.searchParams.get('exp');
	if (!exp) return { ok: false, reason: 'missing-exp' };
	if (!/^\d+$/.test(exp)) return { ok: false, reason: 'invalid-exp' };
	const expNumber = Number(exp);
	if (!Number.isSafeInteger(expNumber) || expNumber <= 0) {
		return { ok: false, reason: 'invalid-exp' };
	}

	const sig = url.searchParams.get('sig');
	if (!sig) return { ok: false, reason: 'missing-sig' };

	return { ok: true, link: { orderId, exp, sig } };
}

/**
 * Converts a validated signed link into the frontend receipt URL
 * `{baseUrl}/order/{id}?exp=...&sig=...` without changing the query values.
 */
export function orderLinkToReceiptUrl(link: SignedOrderLink, baseUrl: string): string {
	const url = parseAbsoluteHttpUrl(baseUrl);
	if (!url) {
		throw new Error('Receipt base URL must use http(s).');
	}
	url.pathname = `${url.pathname.replace(/\/+$/, '')}/order/${link.orderId}`;
	url.search = '';
	url.hash = '';
	url.searchParams.set('exp', link.exp);
	url.searchParams.set('sig', link.sig);
	return url.toString();
}

/**
 * True when the signed link's `exp` (unix seconds) is in the past relative to
 * `nowSeconds` (defaults to the current wall clock).
 */
export function isOrderLinkExpired(
	link: SignedOrderLink,
	nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
	const exp = /^\d+$/.test(link.exp) ? Number(link.exp) : Number.NaN;
	return !Number.isSafeInteger(exp) || nowSeconds >= exp;
}
