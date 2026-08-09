import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBaseUrl(raw: string) {
	vi.resetModules();
	vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_API_BASE_URL: raw } }));
	return import('../src/lib/api/base-url');
}

afterEach(() => {
	vi.doUnmock('$env/dynamic/public');
	vi.resetModules();
});

describe('API base URL validation', () => {
	it('rejects raw trailing query and hash markers', async () => {
		await expect(loadBaseUrl('https://api.example.test/api/v1?')).rejects.toThrow(
			'must not contain a query string or hash'
		);
		await expect(loadBaseUrl('https://api.example.test/api/v1#')).rejects.toThrow(
			'must not contain a query string or hash'
		);
	});

	it('rejects parsed query and hash values', async () => {
		await expect(loadBaseUrl('https://api.example.test/api/v1?source=test')).rejects.toThrow(
			'must not contain a query string or hash'
		);
		await expect(loadBaseUrl('https://api.example.test/api/v1#fragment')).rejects.toThrow(
			'must not contain a query string or hash'
		);
	});

	it('normalizes only the documented API path suffix', async () => {
		const { PUBLIC_API_BASE_URL } = await loadBaseUrl('https://api.example.test/api/v1///');
		expect(PUBLIC_API_BASE_URL).toBe('https://api.example.test/api/v1');
	});
});
