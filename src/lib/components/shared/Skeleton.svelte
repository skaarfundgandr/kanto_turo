<script lang="ts">
	export let lines = 3;
	export let label = 'Naglo-load';

	$: safeLines = Math.max(1, Math.min(8, Math.floor(lines)));
</script>

<div class="skeleton" role="status" aria-busy="true" aria-label={label}>
	<span class="sr-only">{label}</span>
	{#each Array.from({ length: safeLines }, (_, index) => index) as line (line)}
		<span class="skeleton__line" aria-hidden="true"></span>
	{/each}
</div>
