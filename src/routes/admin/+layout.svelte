<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type { AuthState, AuthStatus } from '$lib/stores/auth';
	import { authStore, logout } from '$lib/stores/auth';
	import Button from '$lib/components/shared/Button.svelte';
	import InlineAlert from '$lib/components/shared/InlineAlert.svelte';
	import PaperPanel from '$lib/components/shared/PaperPanel.svelte';

	export let data: { authStatus: AuthStatus; user: AuthState['user'] } = {
		authStatus: 'loading',
		user: null
	};

	let status: AuthStatus = data.authStatus;
	let user = data.user;
	let storeReady = false;
	let redirecting = false;

	$: hasAdminPermission =
		status === 'authenticated' && (user?.role?.permissions.includes('ADMIN') ?? false);

	onMount(() => {
		let mounted = true;
		const unsubscribe = authStore.subscribe((next) => {
			if (!mounted) return;
			status = next.status;
			user = next.user;
			storeReady = true;
			if (next.status === 'anonymous') redirectToLogin();
		});

		return () => {
			mounted = false;
			unsubscribe();
		};
	});

	function redirectToLogin(): void {
		if (redirecting) return;
		redirecting = true;
		void goto(resolve('/login'));
	}

	function handleLogout(): void {
		logout();
		redirectToLogin();
	}
</script>

<div class="admin-guard" data-admin-guard data-auth-state={status}>
	{#if !storeReady || status === 'loading'}
		<main class="admin-guard__state" data-admin-loading aria-busy="true">
			<PaperPanel ariaLabel="Sinusuri ang access sa kusina">
				<p class="eyebrow">Kusina access</p>
				<h1 class="sign-type">Sandali lang...</h1>
				<p>Sinusuri muna ang session bago buksan ang order board.</p>
			</PaperPanel>
		</main>
	{:else if status === 'forbidden' || !hasAdminPermission}
		<main class="admin-guard__state" data-admin-forbidden aria-labelledby="admin-forbidden-title">
			<PaperPanel ariaLabel="Admin access denied">
				<p class="eyebrow">403 · Walang access</p>
				<h1 class="sign-type" id="admin-forbidden-title">Hindi para sa role na ito.</h1>
				<InlineAlert tone="error" title="Kusina access denied">
					Valid ang session, pero kailangan ang ADMIN permission para makita ang order board.
				</InlineAlert>
				<div class="admin-guard__actions">
					<Button variant="ghost" href={resolve('/')}>Bumalik sa menu</Button>
					<Button onclick={handleLogout}>Mag-logout</Button>
				</div>
			</PaperPanel>
		</main>
	{:else}
		<slot />
	{/if}
</div>
