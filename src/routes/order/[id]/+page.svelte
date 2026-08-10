<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { base, resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import QRCode from 'qrcode';
	import { getSignedOrder, paySignedOrder } from '$lib/api/endpoints';
	import { ApiError } from '$lib/api/errors';
	import type { Order, SignedOrderLink } from '$lib/api/types';
	import { copy } from '$lib/actions/turo';
	import Button from '$lib/components/shared/Button.svelte';
	import InlineAlert from '$lib/components/shared/InlineAlert.svelte';
	import PaintedSign from '$lib/components/shared/PaintedSign.svelte';
	import PaperPanel from '$lib/components/shared/PaperPanel.svelte';
	import Skeleton from '$lib/components/shared/Skeleton.svelte';
	import Stamp from '$lib/components/shared/Stamp.svelte';
	import StatusChip from '$lib/components/shared/StatusChip.svelte';
	import StatusSteps from '$lib/components/shared/StatusSteps.svelte';
	import ThermalReceipt from '$lib/components/shared/ThermalReceipt.svelte';
	import { formatPeso, parsePriceToCents } from '$lib/utils/money';
	import { orderLinkToReceiptUrl, parseOrderLink } from '$lib/utils/order-link';
	import { isOrderStatus, isTerminalOrderStatus, ORDER_STATUS_LABELS } from '$lib/utils/status';
	import {
		isUnrecoverableReceiptError,
		receiptProblemFor,
		RECEIPT_POLL_INTERVAL_MS,
		type ReceiptProblem
	} from '$lib/utils/receipt';
	import { startPolling, type PollingHandle } from '$lib/utils/polling';

	type ReceiptViewState = 'loading' | 'ready' | ReceiptProblem;
	type OrderUpdateSource = 'initial' | 'poll' | 'payment' | 'conflict-refresh';

	const progressSteps: readonly { value: string; label: string }[] = (
		['Pending', 'Accepted', 'Ready', 'Completed'] as const
	).map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }));

	let viewState: ReceiptViewState = 'loading';
	let receiptProblem: ReceiptProblem | null = null;
	let receiptMessage = '';
	let pollError = '';
	let paymentError = '';
	let paymentMessage = '';
	let order: Order | null = null;
	let signedLink: SignedOrderLink | null = null;
	let receiptUrl = '';
	let qrDataUrl: string | null = null;
	let qrError = '';
	let paying = false;
	let mounted = true;
	let requestNumber = 0;
	let polling: PollingHandle | null = null;
	let paymentAttempt = 0;
	let paymentFeedback: HTMLElement | null = null;
	let currentLocationKey = receiptLocationKey();

	$: copyOptions = {
		value: receiptUrl,
		idleLabel: 'Kopyahin ang link',
		copiedLabel: 'Nakopya na',
		failedLabel: 'Hindi nakopya'
	};

	afterNavigate(() => {
		if (!mounted) return;
		const nextLocationKey = receiptLocationKey();
		if (nextLocationKey === currentLocationKey) return;
		currentLocationKey = nextLocationKey;
		void initialise();
	});

	onMount(() => {
		const handlePopState = () => {
			const nextLocationKey = receiptLocationKey();
			if (nextLocationKey === currentLocationKey) return;
			currentLocationKey = nextLocationKey;
			void initialise();
		};

		window.addEventListener('popstate', handlePopState);
		void initialise();

		return () => {
			window.removeEventListener('popstate', handlePopState);
			mounted = false;
			requestNumber += 1;
			stopReceiptPolling();
		};
	});

	function receiptLocationKey(): string {
		return `${page.url.toString()}|${String(page.params?.id ?? '')}`;
	}

	function setLinkProblem(message: string, problem: ReceiptProblem = 'forbidden'): void {
		stopReceiptPolling();
		viewState = problem;
		receiptProblem = problem;
		receiptMessage = message;
		order = null;
		paymentError = '';
		paymentMessage = '';
		pollError = '';
	}

	function signedLinkFromLocation(): SignedOrderLink | null {
		const parsed = parseOrderLink(page.url.toString());
		if (!parsed.ok) {
			setLinkProblem(
				'Hindi kumpleto o malformed ang signed receipt link. Kailangan ang buong link para sa resibo.'
			);
			return null;
		}

		const routeId = page.params?.id;
		if (routeId !== undefined && routeId !== String(parsed.link.orderId)) {
			setLinkProblem('Hindi tumutugma ang order ID sa signed receipt link.', 'tampered');
			return null;
		}

		return parsed.link;
	}

	async function initialise(): Promise<void> {
		const currentRequest = ++requestNumber;
		paymentAttempt += 1;
		stopReceiptPolling();
		viewState = 'loading';
		receiptProblem = null;
		receiptMessage = '';
		pollError = '';
		paymentError = '';
		paymentMessage = '';
		order = null;
		signedLink = null;
		receiptUrl = '';
		qrDataUrl = null;
		qrError = '';
		paying = false;

		const link = signedLinkFromLocation();
		if (!link || !mounted || currentRequest !== requestNumber) return;

		signedLink = link;
		try {
			receiptUrl = orderLinkToReceiptUrl(link, `${page.url.origin}${base}`);
		} catch {
			setLinkProblem('Hindi mabuo ang frontend receipt link.', 'forbidden');
			return;
		}

		try {
			const loaded = await fetchSignedOrder(link);
			if (!mounted || currentRequest !== requestNumber) return;
			applyOrder(loaded, 'initial');
			startReceiptPolling(loaded, link, currentRequest);
			await generateQr(receiptUrl, currentRequest);
		} catch (error) {
			if (!mounted || currentRequest !== requestNumber) return;
			setProblemFromError(error);
		}
	}

	async function fetchSignedOrder(link: SignedOrderLink): Promise<Order> {
		const loaded = await getSignedOrder(link.orderId, link.exp, link.sig);
		if (loaded.order_id !== link.orderId) {
			throw new ApiError(400, 'The receipt order ID does not match the signed link.');
		}
		return loaded;
	}

	function applyOrder(next: Order, source: OrderUpdateSource): void {
		const previousPaymentStatus = order?.payment_status;
		const paymentStatusChanged =
			previousPaymentStatus !== undefined && previousPaymentStatus !== next.payment_status;
		order = next;
		viewState = 'ready';
		receiptProblem = null;
		receiptMessage = '';
		pollError = '';
		if (source !== 'poll') {
			paymentError = '';
			paymentMessage = '';
		} else if (paymentStatusChanged) {
			// A changed server payment status supersedes feedback for the old status.
			paymentError = '';
			paymentMessage = '';
		}
		if (next.status !== null && isTerminalOrderStatus(next.status)) {
			stopReceiptPolling();
		}
	}

	function stopReceiptPolling(): void {
		polling?.stop();
		polling = null;
	}

	function startReceiptPolling(initial: Order, link: SignedOrderLink, generation: number): void {
		if (polling || (initial.status !== null && isTerminalOrderStatus(initial.status))) return;

		let pollPaymentAttempt = paymentAttempt;
		let startedWhilePaying = false;
		polling = startPolling(
			async () => {
				pollPaymentAttempt = paymentAttempt;
				startedWhilePaying = paying;
				try {
					const next = await fetchSignedOrder(link);
					if (
						mounted &&
						generation === requestNumber &&
						!startedWhilePaying &&
						!paying &&
						pollPaymentAttempt === paymentAttempt
					) {
						applyOrder(next, 'poll');
					}
					return next;
				} catch (error) {
					if (
						mounted &&
						generation === requestNumber &&
						!startedWhilePaying &&
						!paying &&
						pollPaymentAttempt === paymentAttempt
					) {
						handlePollingError(error, generation);
					}
					throw error;
				}
			},
			(next) =>
				mounted &&
				generation === requestNumber &&
				!startedWhilePaying &&
				!paying &&
				pollPaymentAttempt === paymentAttempt &&
				next.status !== null &&
				isTerminalOrderStatus(next.status),
			{
				intervalMs: RECEIPT_POLL_INTERVAL_MS,
				shouldPoll: () => mounted && generation === requestNumber && !paying,
				shouldStopOnError: isUnrecoverableReceiptError
			}
		);
	}

	function setProblemFromError(error: unknown): void {
		const problem = receiptProblemFor(error);
		setLinkProblem(error instanceof Error ? error.message : 'Hindi ma-load ang resibo.', problem);
	}

	function handlePollingError(error: unknown, generation: number): void {
		if (generation !== requestNumber) return;
		if (isUnrecoverableReceiptError(error)) {
			setProblemFromError(error);
			return;
		}
		pollError = error instanceof Error ? error.message : 'Hindi pa na-update ang resibo.';
	}

	async function generateQr(payload: string, currentRequest: number): Promise<void> {
		try {
			const dataUrl = await QRCode.toDataURL(payload, {
				errorCorrectionLevel: 'M',
				margin: 1,
				width: 220
			});
			if (mounted && currentRequest === requestNumber) qrDataUrl = dataUrl;
		} catch {
			if (mounted && currentRequest === requestNumber) {
				qrError = 'Hindi nabuo ang QR ngayon, pero gumagana pa rin ang resibo.';
			}
		}
	}

	function retryableProblem(): boolean {
		return receiptProblem === 'offline' || receiptProblem === 'retryable';
	}

	async function focusPaymentFeedback(generation: number): Promise<void> {
		await tick();
		if (mounted && generation === requestNumber) paymentFeedback?.focus();
	}

	function problemTitle(problem: ReceiptProblem): string {
		switch (problem) {
			case 'forbidden':
				return 'Hindi makuha ang resibo (403)';
			case 'tampered':
				return 'Hindi wasto ang signed link (400)';
			case 'not-found':
				return 'Hindi mahanap ang order (404)';
			case 'expired':
				return 'Nag-expire ang signed link (410)';
			case 'offline':
				return 'Walang koneksyon';
			case 'retryable':
				return 'Sandaling hindi available ang resibo';
		}
	}

	function problemCopy(problem: ReceiptProblem): string {
		switch (problem) {
			case 'forbidden':
				return 'Hindi kumpleto o malformed ang signed receipt link. Buksan ang buong link; hindi kailangan ng login.';
			case 'tampered':
				return 'Hindi tumugma ang pirma sa order na ito.';
			case 'not-found':
				return 'Wala na o hindi kailanman nagkaroon ng order sa ID na ito.';
			case 'expired':
				return 'Humingi ng bagong receipt link kung kailangan mong makita ang order.';
			case 'offline':
				return 'Suriin ang koneksyon at subukan muli kapag online na.';
			case 'retryable':
				return receiptMessage || 'May pansamantalang problema sa server.';
		}
	}

	function paymentFailureCopy(error: unknown): string {
		if (!(error instanceof ApiError)) return 'Hindi natuloy ang bayad. Nananatili ang resibo.';
		switch (error.status) {
			case 0:
				return 'Walang koneksyon. Nananatili ang resibo; subukan muli kapag online na.';
			case 400:
				return 'Hindi wasto ang signed link. Nananatili ang resibo.';
			case 403:
				return 'Hindi na maaaring gamitin ang signed link para magbayad.';
			case 404:
				return 'Hindi mahanap ang order. Nananatili ang huling resibo.';
			case 410:
				return 'Nag-expire ang signed link. Nananatili ang huling resibo.';
			default:
				return 'Hindi natuloy ang bayad. Nananatili ang resibo.';
		}
	}

	async function pay(event: MouseEvent): Promise<void> {
		event.preventDefault();
		const currentOrder = order;
		const link = signedLink;
		const currentRequest = requestNumber;
		if (
			paying ||
			!currentOrder ||
			!link ||
			currentOrder.payment_status === 'paid' ||
			currentOrder.status === 'Cancelled'
		)
			return;

		paymentAttempt += 1;
		paying = true;
		paymentError = '';
		paymentMessage = '';

		try {
			const response = await paySignedOrder(link.orderId, link.exp, link.sig);
			if (!mounted || currentRequest !== requestNumber) return;
			if (response.order_id !== currentOrder.order_id) {
				throw new ApiError(502, 'The payment response order ID does not match the receipt.');
			}

			applyOrder({ ...currentOrder, payment_status: response.payment_status }, 'payment');
			paymentMessage =
				response.message ||
				(response.payment_status === 'paid'
					? 'Bayad na ang order.'
					: 'Hindi tinanggap ang mock payment.');
			await focusPaymentFeedback(currentRequest);
		} catch (error) {
			if (!mounted || currentRequest !== requestNumber) return;

			if (error instanceof ApiError && error.status === 409) {
				try {
					const refreshed = await fetchSignedOrder(link);
					if (!mounted || currentRequest !== requestNumber) return;
					applyOrder(refreshed, 'conflict-refresh');
					paymentMessage =
						refreshed.payment_status === 'paid'
							? 'Bayad na ang order.'
							: 'Na-update ang resibo. Suriin muli ang status ng bayad.';
					await focusPaymentFeedback(currentRequest);
				} catch (refreshError) {
					if (!mounted || currentRequest !== requestNumber) return;
					if (isUnrecoverableReceiptError(refreshError)) {
						setProblemFromError(refreshError);
					} else {
						paymentError = paymentFailureCopy(refreshError);
					}
				}
			} else {
				if (isUnrecoverableReceiptError(error)) {
					setProblemFromError(error);
				} else {
					paymentError = paymentFailureCopy(error);
				}
			}
		} finally {
			if (mounted && currentRequest === requestNumber) paying = false;
		}
	}
</script>

<svelte:head>
	<title>Kanto Turo-Turo - Resibo</title>
</svelte:head>

<section
	class="receipt-stage"
	data-receipt-state={viewState}
	aria-labelledby="receipt-title"
	aria-busy={viewState === 'loading' || paying}
>
	<div class="section-heading">
		<PaintedSign id="receipt-title" text="RESIBO" delay="0.05s" />
		<span class="section-sidenote">tago ang link para sa susunod na tingin</span>
	</div>

	{#if viewState === 'loading'}
		<Skeleton lines={7} label="Kinukuha ang resibo" />
	{:else if viewState !== 'ready' && receiptProblem}
		<PaperPanel>
			<InlineAlert tone="error" title={problemTitle(receiptProblem)}>
				{problemCopy(receiptProblem)}
			</InlineAlert>
			{#if retryableProblem()}
				<div class="receipt-state__actions">
					<button class="btn btn--ghost" type="button" onclick={() => initialise()}
						>Subukan muli</button
					>
				</div>
			{/if}
		</PaperPanel>
	{:else if order}
		{#if pollError}
			<InlineAlert tone="warning" title="Hindi pa na-update ang resibo">{pollError}</InlineAlert>
		{/if}

		<div class="receipt-layout">
			<ThermalReceipt
				title="RESIBO"
				subtitle={`Order #${order.order_id}`}
				ariaLabel="Order receipt"
			>
				<div class="receipt-badges" aria-label="Status ng order at bayad">
					{#if order.status && isOrderStatus(order.status)}
						<StatusChip kind="order" status={order.status} />
					{:else}
						<span class="chip chip--neutral" role="status">Status hindi pa nakatalaga</span>
					{/if}
					<StatusChip kind="payment" status={order.payment_status} />
				</div>

				<hr />
				<ul class="receipt-lines" aria-label="Mga laman ng resibo">
					{#each order.products as item, index (index)}
						<li class="receipt-row receipt-line">
							<span>
								<strong>{item.product?.name ?? 'Putahe'}</strong>
								<small>{item.quantity} × {formatPeso(parsePriceToCents(item.unit_price))}</small>
							</span>
							<strong>{formatPeso(parsePriceToCents(item.line_total))}</strong>
						</li>
					{/each}
				</ul>

				<div class="receipt-row receipt-total">
					<span>Total</span>
					<strong>{formatPeso(parsePriceToCents(order.total_amount))}</strong>
				</div>
				<p class="receipt-note">Presyo at total mula sa server.</p>
				<Stamp
					status={order.payment_status === 'paid' || order.payment_status === 'failed'
						? order.payment_status
						: null}
				/>
				{#if paymentMessage}
					<p class="receipt-note" role="status" tabindex="-1" bind:this={paymentFeedback}>
						{paymentMessage}
					</p>
				{/if}
			</ThermalReceipt>

			<div class="receipt-side">
				<PaperPanel ariaLabel="Order status and receipt actions">
					{#if order.status === 'Cancelled'}
						<InlineAlert tone="error" title="Kinansela">Ang order na ito ay Kinansela.</InlineAlert>
					{:else}
						<StatusSteps steps={progressSteps} current={order.status ?? ''} />
					{/if}

					{#if order.status !== 'Cancelled' && order.payment_status !== 'paid'}
						<div class="receipt-payment">
							<Button
								type="button"
								disabled={paying}
								busy={paying}
								onclick={pay}
								ariaLabel={paying
									? 'Pinoproseso ang bayad'
									: order.payment_status === 'failed'
										? 'Subukan muli ang bayad'
										: 'Bayaran ang order'}
							>
								{paying
									? 'Pinoproseso...'
									: order.payment_status === 'failed'
										? 'Subukan muli ang bayad'
										: 'Bayaran ang order'}
							</Button>
						</div>
					{/if}

					{#if paymentError}
						<InlineAlert tone="error" title="Hindi natuloy ang bayad">{paymentError}</InlineAlert>
					{/if}

					<div class="receipt-link-panel">
						{#if qrDataUrl}
							<img class="receipt-qr" src={qrDataUrl} alt="QR code para sa buong link ng resibo" />
						{:else if qrError}
							<p class="receipt-note" role="status">{qrError}</p>
						{:else}
							<p class="receipt-note" role="status">Inihahanda ang QR...</p>
						{/if}
						{#if receiptUrl}
							<button class="btn btn--quiet receipt-copy" type="button" use:copy={copyOptions}>
								<span data-copy-label>Kopyahin ang link</span>
							</button>
						{/if}
					</div>
				</PaperPanel>
				<a class="btn btn--quiet receipt-menu-link" href={resolve('/')}>Bumalik sa menu</a>
			</div>
		</div>
	{/if}
</section>
