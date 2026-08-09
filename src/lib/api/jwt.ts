import type { JwtClaims } from './types';

/**
 * Decodes ONLY the numeric `sub` and `exp` claims from a JWT payload.
 * The signature is never verified here and role/permission claims are never
 * trusted: authorization is always derived from the server-validated user
 * returned by `GET /users/{sub}`. Returns `null` for any malformed input.
 */
export function decodeJwtClaims(token: string): JwtClaims | null {
	if (typeof token !== 'string') return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;

	let payloadText: string;
	try {
		payloadText = base64UrlDecode(parts[1]);
	} catch {
		return null;
	}

	let payload: unknown;
	try {
		payload = JSON.parse(payloadText);
	} catch {
		return null;
	}

	if (!isRecord(payload)) return null;
	const { sub, exp } = payload;
	if (typeof sub !== 'number' || typeof exp !== 'number') return null;
	if (!Number.isSafeInteger(sub) || sub <= 0 || !Number.isSafeInteger(exp) || exp <= 0) return null;

	return { sub, exp };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function base64UrlDecode(input: string): string {
	if (!/^[A-Za-z0-9_-]*$/.test(input)) throw new Error('Invalid base64url payload.');
	const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}
