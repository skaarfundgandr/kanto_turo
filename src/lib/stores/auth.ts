import { writable, get } from 'svelte/store';
import { decodeJwtClaims } from '../api/jwt';
import { ApiError } from '../api/errors';
import { getUser, login as apiLogin, refreshToken } from '../api/endpoints';
import { getStoredToken, setStoredToken, setUnauthorizedHandler } from '../api/token';
import type { User } from '../api/types';

/**
 * Token-based admin auth store.
 *
 * - The token is persisted; only its numeric `sub` and `exp` claims are ever
 *   decoded client-side (for hydration lookup and rotation scheduling).
 *   Role/permission claims inside the JWT are never trusted for
 *   authorization — ADMIN is derived exclusively from the server-validated
 *   user returned by `GET /users/{sub}`.
 * - Rotation is proactive and single-flight: while the current token is
 *   still valid we refresh shortly before `exp` via authenticated
 *   `GET /auth/refresh`, reschedule from the new `exp`, and re-check on
 *   app load and visibility resume. The refresh endpoint itself rejects
 *   expired tokens, so an expired token or a protected-request 401 clears
 *   the session instead of attempting an impossible refresh/retry loop.
 */

const TOKEN_STORAGE_KEY = 'kanto:auth:token';
/** Refresh this long before expiry while the token is still valid. */
const REFRESH_LEAD_MS = 60_000;
/** Backoff for transient (network/server) refresh failures. */
const RETRY_DELAY_MS = 60_000;

export type AuthStatus = 'loading' | 'authenticated' | 'forbidden' | 'anonymous';

export interface AuthState {
	status: AuthStatus;
	user: User | null;
}

const INITIAL_STATE: AuthState = { status: 'loading', user: null };

function readStoredToken(): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(TOKEN_STORAGE_KEY);
	} catch {
		return null;
	}
}

function writeStoredToken(token: string | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
		if (token === null) {
			localStorage.removeItem(TOKEN_STORAGE_KEY);
		} else {
			localStorage.setItem(TOKEN_STORAGE_KEY, token);
		}
	} catch {
		// Storage unavailable: the in-memory token still drives this session.
	}
}

let redirectHandler: (() => void) | null = null;

/** Route layer wires this to `goto('/login')`; default is a no-op. */
export function setAuthRedirectHandler(handler: (() => void) | null): void {
	redirectHandler = handler;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let rotationInFlight: Promise<string | null> | null = null;
let initPromise: Promise<AuthState> | null = null;
let loginInFlight: Promise<AuthState> | null = null;
let redirectFired = false;
let sessionVersion = 0;
let authOperationVersion = 0;
let visibilityListenerAttached = false;

function cancelTimer(): void {
	if (refreshTimer !== null) {
		clearTimeout(refreshTimer);
		refreshTimer = null;
	}
}

function expireSoon(claims: { exp: number }): boolean {
	return claims.exp * 1000 - Date.now() <= REFRESH_LEAD_MS;
}

function isExpired(claims: { exp: number }): boolean {
	return claims.exp * 1000 <= Date.now();
}

function clearSession(): void {
	const currentStatus = get(authState).status;
	const hadSession =
		getStoredToken() !== null || currentStatus === 'authenticated' || currentStatus === 'forbidden';
	sessionVersion += 1;
	authOperationVersion += 1;
	cancelTimer();
	detachVisibilityListener();
	initPromise = null;
	setStoredToken(null);
	writeStoredToken(null);
	authState.set({ status: 'anonymous', user: null });
	if (hadSession && redirectHandler && !redirectFired) {
		redirectFired = true;
		redirectHandler();
	}
}

function scheduleRotation(expSeconds: number): void {
	cancelTimer();
	const delay = Math.max(0, expSeconds * 1000 - Date.now() - REFRESH_LEAD_MS);
	refreshTimer = setTimeout(() => {
		void rotateToken();
	}, delay);
}

function isCurrentSession(runVersion: number, token: string): boolean {
	return runVersion === sessionVersion && getStoredToken() === token;
}

function scheduleHydrationRetry(token: string): void {
	cancelTimer();
	refreshTimer = setTimeout(() => {
		refreshTimer = null;
		if (getStoredToken() !== token) return;
		const claims = decodeJwtClaims(token);
		if (!claims || isExpired(claims)) {
			clearSession();
			return;
		}
		initPromise = null;
		void initAuth();
	}, RETRY_DELAY_MS);
}

/** Single-flight proactive refresh. Returns the new token, or null on failure. */
async function rotateToken(): Promise<string | null> {
	if (rotationInFlight) return rotationInFlight;
	const runVersion = sessionVersion;
	const run = (async () => {
		const token = getStoredToken();
		if (!token) return null;
		const claims = decodeJwtClaims(token);
		if (!claims || isExpired(claims)) {
			clearSession();
			return null;
		}
		try {
			const response = await refreshToken();
			if (!response.token) {
				if (isCurrentSession(runVersion, token)) clearSession();
				return null;
			}
			const nextToken = response.token;
			const nextClaims = decodeJwtClaims(nextToken);
			if (!nextClaims) {
				if (isCurrentSession(runVersion, token)) clearSession();
				return null;
			}
			if (!isCurrentSession(runVersion, token)) return null;
			setStoredToken(nextToken);
			writeStoredToken(nextToken);
			scheduleRotation(nextClaims.exp);
			return nextToken;
		} catch (error) {
			if (
				error instanceof ApiError &&
				(error.status === 401 || error.status === 404) &&
				isCurrentSession(runVersion, token)
			) {
				// Expired, revoked, or missing: the backend rejected the session itself.
				clearSession();
				return null;
			}
			if (!isCurrentSession(runVersion, token)) return null;
			// Transient failure: keep the still-valid token and retry later.
			refreshTimer = setTimeout(() => {
				void rotateToken();
			}, RETRY_DELAY_MS);
			return null;
		}
	})();
	rotationInFlight = run;
	try {
		return await run;
	} finally {
		if (rotationInFlight === run) rotationInFlight = null;
	}
}

/** Hydrates the server-validated user and derives ADMIN from its role. */
async function hydrateUser(sub: number): Promise<AuthState> {
	const user = await getUser(sub);
	const isAdmin = user.role?.permissions?.includes('ADMIN') ?? false;
	return isAdmin ? { status: 'authenticated', user } : { status: 'forbidden', user };
}

async function doInitAuth(): Promise<AuthState> {
	const token = readStoredToken();
	if (!token) {
		cancelTimer();
		detachVisibilityListener();
		setStoredToken(null);
		authState.set({ status: 'anonymous', user: null });
		return get(authState);
	}

	const claims = decodeJwtClaims(token);
	if (!claims || isExpired(claims)) {
		clearSession();
		return get(authState);
	}

	setStoredToken(token);
	attachVisibilityListener();
	const runVersion = sessionVersion;
	try {
		const state = await hydrateUser(claims.sub);
		if (!isCurrentSession(runVersion, token)) return get(authState);
		authState.set(state);
		scheduleRotation(claims.exp);
		return state;
	} catch (error) {
		if (!isCurrentSession(runVersion, token)) return get(authState);
		if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
			// Session is gone server-side: clear and let the route redirect.
			clearSession();
		} else {
			// Keep the token and loading state so route guards do not redirect
			// during a temporary hydration outage; retry automatically.
			initPromise = null;
			authState.set(INITIAL_STATE);
			scheduleHydrationRetry(token);
		}
		return get(authState);
	}
}

function onVisibilityChange(): void {
	if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
	const token = getStoredToken();
	if (!token) return;
	const claims = decodeJwtClaims(token);
	if (!claims) {
		clearSession();
		return;
	}
	if (isExpired(claims)) {
		clearSession();
		return;
	}
	if (expireSoon(claims)) void rotateToken();
}

function attachVisibilityListener(): void {
	if (visibilityListenerAttached || typeof document === 'undefined') return;
	document.addEventListener('visibilitychange', onVisibilityChange);
	visibilityListenerAttached = true;
}

function detachVisibilityListener(): void {
	if (!visibilityListenerAttached || typeof document === 'undefined') return;
	document.removeEventListener('visibilitychange', onVisibilityChange);
	visibilityListenerAttached = false;
}

setUnauthorizedHandler((failedToken) => {
	if (failedToken === null || failedToken === getStoredToken()) clearSession();
});

const { subscribe, set } = writable<AuthState>(INITIAL_STATE);
const authState = { subscribe, set };

export function initAuth(): Promise<AuthState> {
	if (loginInFlight) return loginInFlight;
	initPromise ??= doInitAuth();
	return initPromise;
}

export async function login(username: string, password: string): Promise<AuthState> {
	const operationVersion = ++authOperationVersion;
	initPromise = null;
	const run = (async (): Promise<AuthState> => {
		const response = await apiLogin(username, password);
		if (!response.token) {
			throw new ApiError(502, 'Login response did not include a token.');
		}
		const token = response.token;
		const claims = decodeJwtClaims(token);
		if (!claims) {
			throw new ApiError(502, 'Login response contained an invalid token.');
		}
		if (operationVersion !== authOperationVersion) return get(authState);
		sessionVersion += 1;
		cancelTimer();
		setStoredToken(token);
		writeStoredToken(token);
		attachVisibilityListener();
		const runVersion = sessionVersion;
		try {
			const state = await hydrateUser(claims.sub);
			if (operationVersion !== authOperationVersion || !isCurrentSession(runVersion, token)) {
				return get(authState);
			}
			authState.set(state);
			redirectFired = false;
			scheduleRotation(claims.exp);
			initPromise = Promise.resolve(state);
			return state;
		} catch (error) {
			if (!isCurrentSession(runVersion, token)) throw error;
			if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
				clearSession();
			} else {
				// A failed login must not reject while a silent retry later authenticates.
				// Keep the token only for an explicit initAuth() rehydration attempt.
				initPromise = null;
				authState.set({ status: 'anonymous', user: null });
				detachVisibilityListener();
			}
			throw error;
		}
	})();
	loginInFlight = run;
	try {
		return await run;
	} finally {
		if (loginInFlight === run) loginInFlight = null;
	}
}

export function logout(): void {
	clearSession();
}

export const authStore = authState;
