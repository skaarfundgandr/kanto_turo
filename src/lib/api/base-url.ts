import { env } from '$env/dynamic/public';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000/api/v1';
const API_PREFIX = '/api/v1';

function describeValue(value: string): string {
	return JSON.stringify(value);
}

/**
 * Normalizes `PUBLIC_API_BASE_URL` (defaulting to the local backend) and fails
 * fast with a development error when the value is malformed. The result is
 * always an absolute http(s) URL ending exactly in `/api/v1` with no trailing
 * slash, query string, or hash.
 */
function normalizeBaseUrl(raw: string | undefined): string {
	const value = raw?.trim() || DEFAULT_BASE_URL;

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(
			`PUBLIC_API_BASE_URL is not a valid URL: ${describeValue(value)}. ` +
				`Set it in .env to an absolute http(s) URL ending in ${API_PREFIX}, e.g. ${DEFAULT_BASE_URL}.`
		);
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(
			`PUBLIC_API_BASE_URL must be http(s): ${describeValue(value)}. ` +
				`Set it in .env to e.g. ${DEFAULT_BASE_URL}.`
		);
	}

	if (url.search !== '' || url.hash !== '') {
		throw new Error(
			`PUBLIC_API_BASE_URL must not contain a query string or hash: ${describeValue(value)}. ` +
				`Set it in .env to e.g. ${DEFAULT_BASE_URL}.`
		);
	}

	const normalized = value.replace(/\/+$/, '');
	if (!normalized.endsWith(API_PREFIX)) {
		throw new Error(
			`PUBLIC_API_BASE_URL must end with ${API_PREFIX} (no extra path): ${describeValue(value)}. ` +
				`Set it in .env to e.g. ${DEFAULT_BASE_URL}.`
		);
	}

	return normalized;
}

/** Backend API base URL, validated once at module load. */
export const PUBLIC_API_BASE_URL: string = normalizeBaseUrl(env.PUBLIC_API_BASE_URL);
