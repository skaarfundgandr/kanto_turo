/**
 * Module-scoped token holder and auth-event bridge.
 *
 * The client never imports stores and stores never import the client, so the
 * current Bearer token and the "session invalidated by a 401" signal travel
 * through this tiny seam. The auth store owns the token lifecycle and
 * registers itself here; tests can set both directly.
 */

let currentToken: string | null = null;
let unauthorizedHandler: ((token: string | null) => void) | null = null;

export function setStoredToken(token: string | null): void {
	currentToken = token;
}

export function getStoredToken(): string | null {
	return currentToken;
}

export function setUnauthorizedHandler(handler: ((token: string | null) => void) | null): void {
	unauthorizedHandler = handler;
}

export function notifyUnauthorized(token: string | null = null): void {
	unauthorizedHandler?.(token);
}
