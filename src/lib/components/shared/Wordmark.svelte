<script lang="ts">
	import { resolve } from '$app/paths';

	export let href = '/';
	export let subtitle = 'Turo-Turo · Karinderya';
	export let ariaLabel = 'Kanto Turo-Turo';
</script>

<a class="wordmark" href={resolve(href as '/')} aria-label={ariaLabel}>
	<span class="wordmark__name" aria-hidden="true">KANTO</span>
	<span class="wordmark__subtitle">{subtitle}</span>
</a>
