<script lang="ts">
	export let status: 'paid' | 'failed' | null = null;
	export let animate = true;
	export let paidLabel = 'BAYAD NA';
	export let failedLabel = 'HINDI TINANGGAP';
</script>

<div class="stamp-zone" aria-live="polite">
	{#if status}
		{#key status}
			<span
				class:stamp--paid={status === 'paid'}
				class:stamp--failed={status === 'failed'}
				class:stamp--slam={animate}
				class="stamp"
			>
				{status === 'paid' ? paidLabel : failedLabel}
			</span>
		{/key}
	{/if}
</div>
