<script lang="ts">
	export let variant: 'panel' | 'slip' = 'panel';
	export let className = '';
	export let ariaLabel: string | undefined = undefined;

	$: panelClass = `paper-panel paper-panel--${variant}${className ? ` ${className}` : ''}`;
</script>

<div class={panelClass} role={ariaLabel ? 'group' : undefined} aria-label={ariaLabel}>
	<slot />
</div>
