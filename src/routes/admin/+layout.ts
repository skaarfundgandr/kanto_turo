import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import { initAuth } from '$lib/stores/auth';

/** Resolve the auth state before the admin subtree gets a chance to render. */
export async function load() {
	const state = await initAuth();
	if (state.status === 'anonymous') {
		const normalizedBase = base.replace(/\/+$/, '');
		throw redirect(307, `${normalizedBase}/login`);
	}

	return {
		authStatus: state.status,
		user: state.user
	};
}
