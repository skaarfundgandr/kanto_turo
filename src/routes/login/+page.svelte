<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { ApiError } from '$lib/api/errors';
	import Button from '$lib/components/shared/Button.svelte';
	import InlineAlert from '$lib/components/shared/InlineAlert.svelte';
	import PaintedSign from '$lib/components/shared/PaintedSign.svelte';
	import PaperPanel from '$lib/components/shared/PaperPanel.svelte';
	import Skeleton from '$lib/components/shared/Skeleton.svelte';
	import { authStore, initAuth, login, logout, type AuthState } from '$lib/stores/auth';

	type LoginViewState = 'loading' | 'form' | 'forbidden';

	let viewState: LoginViewState = 'loading';
	let username = '';
	let password = '';
	let submitting = false;
	let errorTitle = '';
	let errorMessage = '';
	let mounted = true;
	let redirecting = false;
	let authRetrying = false;

	onMount(() => {
		const unsubscribe = authStore.subscribe((state) => {
			handleAuthState(state);
		});

		void initAuth();
		return () => {
			mounted = false;
			unsubscribe();
		};
	});

	function handleAuthState(state: AuthState): void {
		if (!mounted) return;
		const hasAdminPermission = state.user?.role?.permissions.includes('ADMIN') ?? false;
		if (state.status === 'authenticated' && hasAdminPermission) {
			redirectToAdmin();
		} else if (state.status === 'forbidden' || state.status === 'authenticated') {
			viewState = 'forbidden';
		} else if (state.status === 'anonymous') {
			viewState = 'form';
		}
	}

	function redirectToAdmin(): void {
		if (redirecting) return;
		redirecting = true;
		viewState = 'loading';
		void goto(resolve('/admin'));
	}

	function showLoginForm(): void {
		if (submitting || redirecting) return;
		// Invalidate a slow hydration request before starting an explicit login.
		logout();
		viewState = 'form';
		errorTitle = '';
		errorMessage = '';
	}

	async function retryAuth(): Promise<void> {
		if (authRetrying || submitting || redirecting) return;
		authRetrying = true;
		errorTitle = '';
		errorMessage = '';
		try {
			const state = await initAuth();
			if (mounted) handleAuthState(state);
		} catch (error) {
			if (!mounted) return;
			const mapped = loginErrorFor(error);
			errorTitle = mapped.title;
			errorMessage = mapped.message;
		} finally {
			if (mounted) authRetrying = false;
		}
	}

	function loginErrorFor(error: unknown): { title: string; message: string } {
		if (!(error instanceof ApiError)) {
			return {
				title: 'Hindi makapag-login',
				message: 'May problema sa pag-login. Subukan muli.'
			};
		}

		switch (error.status) {
			case 0:
				return {
					title: 'Walang koneksyon',
					message: 'Suriin ang internet connection at subukan muli kapag online na.'
				};
			case 401:
				return {
					title: 'Hindi makapag-login (401)',
					message: 'Mali ang username o password.'
				};
			case 404:
				return {
					title: 'Hindi nakita ang account (404)',
					message: 'Walang user na tumutugma sa username na ito.'
				};
			case 429:
				return {
					title: 'Sandali muna (429)',
					message: 'Masyadong maraming pagtatangka. Maghintay bago subukan muli.'
				};
			default:
				return {
					title: `Hindi makapag-login (${error.status})`,
					message: error.message || 'May problema sa server. Subukan muli.'
				};
		}
	}

	async function submitLogin(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (submitting || !username.trim() || !password) return;

		submitting = true;
		errorTitle = '';
		errorMessage = '';

		try {
			const state = await login(username.trim(), password);
			if (!mounted) return;
			if (state.status === 'authenticated' && state.user?.role?.permissions.includes('ADMIN')) {
				redirectToAdmin();
			} else if (state.status === 'forbidden') {
				viewState = 'forbidden';
				errorTitle = '403 · Walang access sa kusina';
				errorMessage = 'Valid ang account, pero kailangan ang ADMIN permission para magpatuloy.';
			}
		} catch (error) {
			if (!mounted) return;
			const mapped = loginErrorFor(error);
			errorTitle = mapped.title;
			errorMessage = mapped.message;
			viewState = 'form';
		} finally {
			if (mounted) submitting = false;
		}
	}

	function clearForbiddenSession(): void {
		logout();
		viewState = 'form';
		errorTitle = '';
		errorMessage = '';
	}
</script>

<svelte:head>
	<title>Kanto Turo-Turo - Kusina Login</title>
</svelte:head>

<section class="login-stage" aria-labelledby="login-title" aria-busy={viewState === 'loading'}>
	<div class="section-heading">
		<PaintedSign id="login-title" text="KUSINA LOGIN" delay="0.05s" />
		<span class="section-sidenote">para sa counter</span>
	</div>

	{#if viewState === 'loading'}
		<PaperPanel ariaLabel="Login session loading">
			<Skeleton lines={4} label="Sinusuri ang login session" />
			<p class="login-intro">
				Awtomatikong sinusubukan muli ang session. Maaari kang mag-login ngayon kung hindi ito
				matapos.
			</p>
			{#if errorMessage}
				<InlineAlert tone="error" title={errorTitle}>{errorMessage}</InlineAlert>
			{/if}
			<div class="login-actions">
				<Button variant="ghost" href={resolve('/')}>Bumalik sa menu</Button>
				<Button
					variant="ghost"
					disabled={authRetrying}
					busy={authRetrying}
					onclick={() => void retryAuth()}
				>
					{authRetrying ? 'Sinusubukan...' : 'Subukan muli ang session'}
				</Button>
				<Button onclick={showLoginForm}>Mag-login ngayon</Button>
			</div>
		</PaperPanel>
	{:else if viewState === 'forbidden'}
		<PaperPanel ariaLabel="Admin login access denied">
			<InlineAlert tone="error" title={errorTitle || '403 · Walang access sa kusina'}>
				{errorMessage || 'Valid ang session, pero hindi ito admin account.'}
			</InlineAlert>
			<div class="login-actions">
				<Button variant="ghost" href={resolve('/')}>Bumalik sa menu</Button>
				<Button onclick={clearForbiddenSession}>Mag-login sa ibang account</Button>
			</div>
		</PaperPanel>
	{:else}
		<PaperPanel className="login-panel" ariaLabel="Kusina login form">
			<p class="login-intro">
				Ilagay ang admin account para makita ang live na order board. Ang access ay sinusuri mula sa
				server bago ka papasukin.
			</p>

			{#if errorMessage}
				<InlineAlert tone="error" title={errorTitle}>{errorMessage}</InlineAlert>
			{/if}

			<form class="login-form" onsubmit={submitLogin}>
				<label class="login-field">
					<span>Username</span>
					<input
						name="username"
						autocomplete="username"
						bind:value={username}
						required
						disabled={submitting}
					/>
				</label>
				<label class="login-field">
					<span>Password</span>
					<input
						type="password"
						name="password"
						autocomplete="current-password"
						bind:value={password}
						required
						disabled={submitting}
					/>
				</label>
				<div class="login-actions">
					<Button variant="ghost" href={resolve('/')}>Bumalik sa menu</Button>
					<Button type="submit" disabled={submitting} busy={submitting}>
						{submitting ? 'Sinusuri...' : 'Pumasok sa kusina'}
					</Button>
				</div>
			</form>
		</PaperPanel>
	{/if}
</section>
