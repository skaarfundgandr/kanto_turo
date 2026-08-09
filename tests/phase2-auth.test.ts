import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

function encodeSegment(value: unknown): string {
	return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(exp: number, sub = 7, extra: Record<string, unknown> = {}): string {
	return `${encodeSegment({ alg: 'none', typ: 'JWT' })}.${encodeSegment({ sub, exp, ...extra })}.signature`;
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

async function flushPromises(): Promise<void> {
	for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe('JWT decoding and auth lifecycle', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let auth: typeof import('../src/lib/stores/auth') | null = null;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.resetModules();
		localStorage.clear();
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		auth?.logout();
		auth = null;
		vi.clearAllTimers();
		vi.useRealTimers();
		localStorage.clear();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('hydrates ADMIN only from server permissions, not JWT role claims', async () => {
		const token = makeToken(Math.floor(Date.now() / 1000) + 120, 7, { roles: [999] });
		fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/auth/login')) return jsonResponse({ token, message: 'ok' });
			if (path.endsWith('/users/7')) {
				return jsonResponse({ user_id: 7, username: 'admin', role: { permissions: ['ADMIN'] } });
			}
			return jsonResponse({});
		});

		auth = await import('../src/lib/stores/auth');
		const state = await auth.login('admin', 'secret');

		expect(state.status).toBe('authenticated');
		expect(get(auth.authStore).status).toBe('authenticated');
		expect(localStorage.getItem('kanto:auth:token')).toBe(token);
	});

	it('does not reuse anonymous initialization after a successful login', async () => {
		const token = makeToken(Math.floor(Date.now() / 1000) + 120);
		fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/auth/login')) return jsonResponse({ token });
			if (path.endsWith('/users/7')) return jsonResponse({ role: { permissions: ['ADMIN'] } });
			return jsonResponse({});
		});

		auth = await import('../src/lib/stores/auth');
		await expect(auth.initAuth()).resolves.toMatchObject({ status: 'anonymous' });
		await expect(auth.login('admin', 'secret')).resolves.toMatchObject({
			status: 'authenticated'
		});
		await expect(auth.initAuth()).resolves.toMatchObject({ status: 'authenticated' });
	});

	it('treats missing login tokens and missing role permissions as safe failures', async () => {
		fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/auth/login')) return jsonResponse({ message: 'logged in' });
			return jsonResponse({});
		});
		auth = await import('../src/lib/stores/auth');

		await expect(auth.login('admin', 'secret')).rejects.toMatchObject({
			status: 502,
			message: 'Login response did not include a token.'
		});
		expect(localStorage.getItem('kanto:auth:token')).toBeNull();

		const token = makeToken(Math.floor(Date.now() / 1000) + 120, 7, { role: 'ADMIN' });
		fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/auth/login')) return jsonResponse({ token });
			if (path.endsWith('/users/7')) return jsonResponse({ role: {} });
			return jsonResponse({});
		});

		const state = await auth.login('customer', 'secret');
		expect(state.status).toBe('forbidden');
	});

	it('removes expired stored tokens during initialization', async () => {
		localStorage.setItem('kanto:auth:token', makeToken(Math.floor(Date.now() / 1000) - 1));
		auth = await import('../src/lib/stores/auth');

		await expect(auth.initAuth()).resolves.toMatchObject({ status: 'anonymous', user: null });
		expect(localStorage.getItem('kanto:auth:token')).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([401, 404])(
		'clears a session gone response during initial hydration (%s)',
		async (status) => {
			const token = makeToken(Math.floor(Date.now() / 1000) + 120);
			const redirect = vi.fn();
			localStorage.setItem('kanto:auth:token', token);
			fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
				if (new URL(String(input)).pathname.endsWith('/users/7')) {
					return new Response('', { status });
				}
				return jsonResponse({});
			});

			auth = await import('../src/lib/stores/auth');
			auth.setAuthRedirectHandler(redirect);

			await expect(auth.initAuth()).resolves.toEqual({ status: 'anonymous', user: null });
			expect(localStorage.getItem('kanto:auth:token')).toBeNull();
			expect(redirect).toHaveBeenCalledTimes(1);
		}
	);

	it('logs out once on a token-matched protected 401 without attempting refresh', async () => {
		const token = makeToken(Math.floor(Date.now() / 1000) + 120);
		const redirect = vi.fn();
		fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/auth/login')) return jsonResponse({ token });
			if (path.endsWith('/users/7')) return jsonResponse({ role: { permissions: ['ADMIN'] } });
			if (path.endsWith('/protected')) return new Response('', { status: 401 });
			if (path.endsWith('/auth/refresh')) return jsonResponse({ token });
			return jsonResponse({});
		});

		auth = await import('../src/lib/stores/auth');
		auth.setAuthRedirectHandler(redirect);
		await auth.login('admin', 'secret');
		const { apiRequest } = await import('../src/lib/api/client');

		await expect(apiRequest('/protected', { auth: 'required' })).rejects.toMatchObject({
			status: 401
		});
		vi.advanceTimersByTime(60_000);
		await flushPromises();

		expect(get(auth.authStore)).toEqual({ status: 'anonymous', user: null });
		expect(localStorage.getItem('kanto:auth:token')).toBeNull();
		expect(redirect).toHaveBeenCalledTimes(1);
		expect(
			fetchMock.mock.calls.filter((call) => String(call[0]).includes('/auth/refresh'))
		).toHaveLength(0);
	});

	it('refreshes proactively once and replaces the stored token', async () => {
		const now = Math.floor(Date.now() / 1000);
		const currentToken = makeToken(now + 120, 7, { roles: [1] });
		const nextToken = makeToken(now + 300, 7, { roles: [2] });
		let resolveRefresh: ((response: Response) => void) | undefined;
		const refreshPending = new Promise<Response>((resolve) => {
			resolveRefresh = resolve;
		});
		fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/auth/login')) return jsonResponse({ token: currentToken });
			if (path.endsWith('/users/7')) return jsonResponse({ role: { permissions: ['ADMIN'] } });
			if (path.endsWith('/auth/refresh')) return refreshPending;
			return jsonResponse({});
		});

		auth = await import('../src/lib/stores/auth');
		await auth.login('admin', 'secret');
		vi.advanceTimersByTime(60_000);
		await flushPromises();

		const refreshCalls = () =>
			fetchMock.mock.calls.filter((call) => String(call[0]).includes('/auth/refresh'));
		expect(refreshCalls()).toHaveLength(1);
		document.dispatchEvent(new Event('visibilitychange'));
		await flushPromises();
		expect(refreshCalls()).toHaveLength(1);

		resolveRefresh?.(jsonResponse({ token: nextToken }));
		await flushPromises();
		expect(localStorage.getItem('kanto:auth:token')).toBe(nextToken);
	});

	it.each([401, 404])(
		'logs out on an expired refresh response (%s) or a missing rotated token',
		async (status) => {
			const now = Math.floor(Date.now() / 1000);
			const token = makeToken(now + 120);
			const redirect = vi.fn();
			fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
				const path = new URL(String(input)).pathname;
				if (path.endsWith('/auth/login')) return jsonResponse({ token });
				if (path.endsWith('/users/7')) return jsonResponse({ role: { permissions: ['ADMIN'] } });
				if (path.endsWith('/auth/refresh')) return new Response('', { status });
				return jsonResponse({});
			});

			auth = await import('../src/lib/stores/auth');
			auth.setAuthRedirectHandler(redirect);
			await auth.login('admin', 'secret');
			vi.advanceTimersByTime(60_000);
			await flushPromises();

			expect(get(auth.authStore)).toEqual({ status: 'anonymous', user: null });
			expect(localStorage.getItem('kanto:auth:token')).toBeNull();
			expect(redirect).toHaveBeenCalledTimes(1);

			const nextToken = makeToken(Math.floor(Date.now() / 1000) + 120);
			fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
				const path = new URL(String(input)).pathname;
				if (path.endsWith('/auth/login')) return jsonResponse({ token: nextToken });
				if (path.endsWith('/users/7')) return jsonResponse({ role: { permissions: ['ADMIN'] } });
				if (path.endsWith('/auth/refresh')) return jsonResponse({ message: 'missing token' });
				return jsonResponse({});
			});
			await auth.login('admin', 'secret');
			vi.advanceTimersByTime(60_000);
			await flushPromises();
			expect(get(auth.authStore).status).toBe('anonymous');
		}
	);

	it('keeps a still-valid token after a transient refresh failure for retry', async () => {
		const token = makeToken(Math.floor(Date.now() / 1000) + 120);
		fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/auth/login')) return jsonResponse({ token });
			if (path.endsWith('/users/7')) return jsonResponse({ role: { permissions: ['ADMIN'] } });
			if (path.endsWith('/auth/refresh')) return new Response('', { status: 503 });
			return jsonResponse({});
		});

		auth = await import('../src/lib/stores/auth');
		await auth.login('admin', 'secret');
		vi.advanceTimersByTime(60_000);
		await flushPromises();

		expect(get(auth.authStore).status).toBe('authenticated');
		expect(localStorage.getItem('kanto:auth:token')).toBe(token);
	});

	it('keeps hydration loading through a transient failure and retries it', async () => {
		const token = makeToken(Math.floor(Date.now() / 1000) + 180);
		let userCalls = 0;
		localStorage.setItem('kanto:auth:token', token);
		fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/users/7')) {
				userCalls += 1;
				if (userCalls === 1) return new Response('', { status: 503 });
				return jsonResponse({ role: { permissions: ['ADMIN'] } });
			}
			return jsonResponse({});
		});

		auth = await import('../src/lib/stores/auth');
		await expect(auth.initAuth()).resolves.toEqual({ status: 'loading', user: null });
		expect(get(auth.authStore)).toEqual({ status: 'loading', user: null });

		vi.advanceTimersByTime(60_000);
		await flushPromises();
		expect(userCalls).toBe(2);
		expect(get(auth.authStore).status).toBe('authenticated');
	});

	it('does not silently authenticate after transient login hydration failure', async () => {
		const token = makeToken(Math.floor(Date.now() / 1000) + 180);
		let userCalls = 0;
		fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/auth/login')) return jsonResponse({ token });
			if (path.endsWith('/users/7')) {
				userCalls += 1;
				if (userCalls === 1) return new Response('', { status: 503 });
				return jsonResponse({ role: { permissions: ['ADMIN'] } });
			}
			return jsonResponse({});
		});

		auth = await import('../src/lib/stores/auth');
		await expect(auth.login('admin', 'secret')).rejects.toMatchObject({ status: 503 });
		expect(get(auth.authStore)).toEqual({ status: 'anonymous', user: null });
		expect(localStorage.getItem('kanto:auth:token')).toBe(token);

		vi.advanceTimersByTime(60_000);
		await flushPromises();
		expect(userCalls).toBe(1);
		expect(get(auth.authStore).status).toBe('anonymous');

		await expect(auth.initAuth()).resolves.toMatchObject({ status: 'authenticated' });
		expect(userCalls).toBe(2);
	});

	it('does not let an old refresh 401 clear a session established by login', async () => {
		const now = Math.floor(Date.now() / 1000);
		const oldToken = makeToken(now + 120);
		const newToken = makeToken(now + 300);
		let loginCalls = 0;
		let resolveRefresh: ((response: Response) => void) | undefined;
		const refreshPending = new Promise<Response>((resolve) => {
			resolveRefresh = resolve;
		});
		const redirect = vi.fn();
		fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/auth/login')) {
				loginCalls += 1;
				return jsonResponse({ token: loginCalls === 1 ? oldToken : newToken });
			}
			if (path.endsWith('/users/7')) return jsonResponse({ role: { permissions: ['ADMIN'] } });
			if (path.endsWith('/auth/refresh')) return refreshPending;
			return jsonResponse({});
		});

		auth = await import('../src/lib/stores/auth');
		auth.setAuthRedirectHandler(redirect);
		await auth.login('admin', 'secret');
		vi.advanceTimersByTime(60_000);
		await flushPromises();

		await auth.login('admin', 'new-secret');
		resolveRefresh?.(new Response('', { status: 401 }));
		await flushPromises();

		expect(get(auth.authStore).status).toBe('authenticated');
		expect(localStorage.getItem('kanto:auth:token')).toBe(newToken);
		expect(redirect).not.toHaveBeenCalled();
	});
});

describe('JWT claim parsing', () => {
	it('accepts only numeric subject and expiry claims', async () => {
		const { decodeJwtClaims } = await import('../src/lib/api/jwt');
		const token = makeToken(1700000000, 12, { role_ids: ['ADMIN'] });
		expect(decodeJwtClaims(token)).toEqual({ sub: 12, exp: 1700000000 });
		expect(
			decodeJwtClaims(
				`${encodeSegment({ alg: 'none' })}.${encodeSegment({ sub: '12', exp: 1700000000 })}.sig`
			)
		).toBeNull();
		expect(
			decodeJwtClaims(
				`${encodeSegment({ alg: 'none' })}.${encodeSegment({ sub: 12, exp: 1700000000.5 })}.sig`
			)
		).toBeNull();
		expect(decodeJwtClaims('not-a-jwt')).toBeNull();
	});
});
