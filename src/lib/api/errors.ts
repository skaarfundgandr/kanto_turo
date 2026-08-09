/**
 * API error type shared by the client and the rest of the app.
 * `status` is the HTTP status, or 0 for network failures that never
 * produced a response. `message` is the backend plain-text body when one
 * exists, otherwise a safe status-based fallback copy.
 */
export class ApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

/** True when `error` came from aborting a request via an `AbortSignal`. */
export function isAbortError(error: unknown): boolean {
	return (
		typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
	);
}
