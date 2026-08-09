import { PUBLIC_API_BASE_URL } from './base-url';
import { ApiError, isAbortError } from './errors';
import { getStoredToken, notifyUnauthorized } from './token';

/** Explicit auth policy for every request. Defaults to `none`. */
export type AuthMode = 'none' | 'required';

export type ResponseMode = 'json' | 'text' | 'blob';

export interface ApiRequestOptions {
	/** `none` (default) never attaches Authorization, even with a stored token. */
	auth?: AuthMode;
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	/** JSON-serializable request body. */
	body?: unknown;
	/** Extra query parameters; `undefined` values are skipped. */
	query?: Record<string, string | number | undefined>;
	as?: ResponseMode;
	signal?: AbortSignal;
}

const DEFAULT_METHOD = 'GET';
const DEFAULT_MODE: ResponseMode = 'json';

/** Safe fallback copy for plain-text or empty error bodies, keyed by status. */
const FALLBACK_MESSAGES: Record<number, string> = {
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

const UNKNOWN_FALLBACK = 'Request failed.';

/**
 * The only fetch wrapper in the app. Routes and stores must never call
 * `fetch` directly; they go through `src/lib/api/endpoints.ts`.
 */
export async function apiRequest(path: string, options: ApiRequestOptions = {}): Promise<unknown> {
	const auth = options.auth ?? 'none';
	const method = options.method ?? DEFAULT_METHOD;
	const mode = options.as ?? DEFAULT_MODE;

	const url = new URL(`${PUBLIC_API_BASE_URL}${path}`);
	if (options.query) {
		for (const [key, value] of Object.entries(options.query)) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}
	}

	const headers: Record<string, string> = {};
	let requestToken: string | null = null;
	if (options.body !== undefined) headers['Content-Type'] = 'application/json';
	if (auth === 'required') {
		const token = getStoredToken();
		if (!token) {
			// Fail fast locally: a protected call without a token is a 401,
			// never a network request that the backend must reject.
			throw new ApiError(401, FALLBACK_MESSAGES[401]);
		}
		requestToken = token;
		headers['Authorization'] = `Bearer ${token}`;
	}

	let response: Response;
	try {
		response = await fetch(url, {
			method,
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			signal: options.signal
		});
	} catch (error) {
		if (isAbortError(error)) throw error;
		throw new ApiError(0, 'Network error.');
	}

	if (response.status >= 200 && response.status < 300) {
		return parseSuccess(response, mode);
	}

	const body = await response.text();
	const message = body.trim() ? body : (FALLBACK_MESSAGES[response.status] ?? UNKNOWN_FALLBACK);
	if (response.status === 401 && auth === 'required') notifyUnauthorized(requestToken);
	throw new ApiError(response.status, message);
}

async function parseSuccess(response: Response, mode: ResponseMode): Promise<unknown> {
	if (mode === 'text') return response.text();
	if (mode === 'blob') return response.blob();

	const text = await response.text();
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		throw new ApiError(response.status, 'Unexpected response format.');
	}
}
