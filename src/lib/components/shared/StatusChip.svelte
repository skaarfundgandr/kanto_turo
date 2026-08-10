<script lang="ts">
	import type { OrderStatus, PaymentStatus } from '$lib/api/types';
	import {
		ORDER_STATUS_LABELS,
		ORDER_STATUS_TONES,
		PAYMENT_STATUS_LABELS,
		PAYMENT_STATUS_TONES
	} from '$lib/utils/status';

	export let kind: 'order' | 'payment' = 'order';
	export let status: OrderStatus | PaymentStatus = 'Pending';

	$: chipLabel =
		kind === 'order'
			? ORDER_STATUS_LABELS[status as OrderStatus]
			: PAYMENT_STATUS_LABELS[status as PaymentStatus];
	$: tone =
		kind === 'order'
			? ORDER_STATUS_TONES[status as OrderStatus]
			: PAYMENT_STATUS_TONES[status as PaymentStatus];
	$: safeLabel = chipLabel ?? String(status);
</script>

<span class={`chip chip--${tone ?? 'neutral'}`} role="status">
	<span class="sr-only">{kind === 'order' ? 'Status ng order' : 'Status ng bayad'}: </span>
	{safeLabel}
</span>
