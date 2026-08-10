<script lang="ts">
	import { base, resolve } from '$app/paths';
	import { page } from '$app/state';
	import Wordmark from './Wordmark.svelte';

	interface BandNavItem {
		href: string;
		label: string;
	}

	export let variant: 'public' | 'kusina' = 'public';
	export let href = '/';
	export let subtitle = '';
	export let note = '';
	export let navItems: readonly BandNavItem[] = [];
	export let navLabel = 'Pangunahing nabigasyon';

	function resolvedSubtitle(): string {
		return subtitle || (variant === 'kusina' ? 'Kusina · Admin Board' : 'Turo-Turo · Karinderya');
	}

	function normalizePathname(pathname: string): string {
		const normalizedBase = base.replace(/\/+$/, '');
		if (!normalizedBase || normalizedBase === '/') return pathname || '/';
		if (pathname === normalizedBase || pathname.startsWith(`${normalizedBase}/`)) {
			return pathname.slice(normalizedBase.length) || '/';
		}
		return pathname || '/';
	}

	function isCurrent(path: string): boolean {
		const currentPath = normalizePathname(page.url.pathname as string);
		const targetPath = normalizePathname(path);
		return targetPath === '/'
			? currentPath === '/'
			: currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
	}
</script>

<header class="band" class:band--kusina={variant === 'kusina'}>
	<div class="page-frame band__inner">
		<Wordmark
			{href}
			subtitle={resolvedSubtitle()}
			ariaLabel={variant === 'kusina' ? 'Kanto Kusina' : 'Kanto Turo-Turo'}
		/>
		{#if note}
			<p class="band-note">{note}</p>
		{/if}
		{#if navItems.length > 0}
			<nav class="band__nav" aria-label={navLabel}>
				<ul class="band__nav-list">
					{#each navItems as item (item.href)}
						<li>
							<a
								class="band__nav-link"
								href={resolve(item.href as '/')}
								aria-current={isCurrent(item.href) ? 'page' : undefined}
							>
								{item.label}
							</a>
						</li>
					{/each}
				</ul>
			</nav>
		{/if}
	</div>
</header>
