<script lang="ts">
	export let title = 'Walang laman';
	export let description = '';
	export let titleId: string | undefined = undefined;
	export let mark = 'turo lang';
</script>

<section class="empty-state" aria-labelledby={titleId} aria-label={titleId ? undefined : title}>
	<span class="empty-state__mark" aria-hidden="true">{mark}</span>
	<h2 class="empty-state__title" id={titleId}>{title}</h2>
	{#if description}<p class="empty-state__description">{description}</p>{/if}
	<div class="empty-state__action"><slot name="action" /></div>
</section>
