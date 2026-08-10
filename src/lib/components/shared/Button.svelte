<script lang="ts">
	type ButtonVariant = 'enamel' | 'ghost' | 'quiet';

	export let variant: ButtonVariant = 'enamel';
	export let size: 'default' | 'small' = 'default';
	export let href: string | null = null;
	export let type: 'button' | 'submit' = 'button';
	export let disabled = false;
	export let busy = false;
	export let ariaLabel: string | undefined = undefined;

	$: buttonClass = `btn btn--${variant}${size === 'small' ? ' btn--small' : ''}`;
</script>

{#if href}
	<a
		class={buttonClass}
		{href}
		aria-label={ariaLabel}
		aria-disabled={disabled ? 'true' : undefined}
		aria-busy={busy ? 'true' : undefined}
		tabindex={disabled ? -1 : undefined}
		onclick={disabled ? (event) => event.preventDefault() : undefined}
	>
		<slot />
	</a>
{:else}
	<button
		class={buttonClass}
		{type}
		{disabled}
		aria-label={ariaLabel}
		aria-busy={busy ? 'true' : undefined}
	>
		<slot />
	</button>
{/if}
