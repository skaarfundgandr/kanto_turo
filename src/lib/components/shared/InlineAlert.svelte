<script lang="ts">
	export let tone: 'info' | 'success' | 'warning' | 'error' = 'info';
	export let title = '';

	let live: 'polite' | 'assertive';
	$: role = tone === 'error' ? 'alert' : 'status';
	$: live = tone === 'error' ? 'assertive' : 'polite';
</script>

<div class={`inline-alert inline-alert--${tone}`} {role} aria-live={live}>
	{#if title}<strong class="inline-alert__title">{title}</strong>{/if}
	<div class="inline-alert__body"><slot /></div>
</div>
