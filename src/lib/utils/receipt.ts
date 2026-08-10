import { ApiError } from '../api/errors';

/** Problems that can be shown without exposing signed query values. */
export type ReceiptProblem =
	'forbidden' | 'tampered' | 'not-found' | 'expired' | 'offline' | 'retryable';

/** The receipt refresh cadence required by the guest order flow. */
export const RECEIPT_POLL_INTERVAL_MS = 8000;

export function receiptProblemFor(error: unknown): ReceiptProblem {
	if (!(error instanceof ApiError)) return 'retryable';

	switch (error.status) {
		case 0:
			return 'offline';
		case 400:
			return 'tampered';
		case 403:
			return 'forbidden';
		case 404:
			return 'not-found';
		case 410:
			return 'expired';
		default:
			return 'retryable';
	}
}

/** Signed-link errors cannot become valid through another poll. */
export function isUnrecoverableReceiptError(error: unknown): boolean {
	const problem = receiptProblemFor(error);
	return (
		problem === 'forbidden' ||
		problem === 'tampered' ||
		problem === 'not-found' ||
		problem === 'expired'
	);
}
