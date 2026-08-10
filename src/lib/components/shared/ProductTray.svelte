<script lang="ts">
	export let className = '';
	export let selected = false;
	export let ariaLabel: string | undefined = undefined;

	$: trayClass = `product-tray${selected ? ' product-tray--selected' : ''}${className ? ` ${className}` : ''}`;
</script>

<div class={trayClass} role={ariaLabel ? 'group' : undefined} aria-label={ariaLabel}>
	<div class="product-tray__floor">
		<slot />
	</div>
</div>
