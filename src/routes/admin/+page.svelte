<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { ApiError } from '$lib/api/errors';
	import {
		cancelOrder,
		deleteOrder,
		getOrderingQr,
		listOrders,
		payOrder,
		updateOrderStatus
	} from '$lib/api/endpoints';
	import type { Order, OrderStatus } from '$lib/api/types';
	import Button from '$lib/components/shared/Button.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import InlineAlert from '$lib/components/shared/InlineAlert.svelte';
	import KpiCard from '$lib/components/shared/KpiCard.svelte';
	import PaintedSign from '$lib/components/shared/PaintedSign.svelte';
	import PaperPanel from '$lib/components/shared/PaperPanel.svelte';
	import Skeleton from '$lib/components/shared/Skeleton.svelte';
	import StatusChip from '$lib/components/shared/StatusChip.svelte';
	import { authStore, logout, type AuthStatus } from '$lib/stores/auth';
	import {
		ADMIN_ORDER_FILTERS,
		ADMIN_POLL_INTERVAL_MS,
		adminOrderFilterLabel,
		deriveAdminKpis,
		formatAdminDate,
		formatAdminDateTime,
		sortOrdersNewestFirst,
		type AdminOrderFilter
	} from '$lib/utils/admin-orders';
	import { formatPeso, parsePriceToCents } from '$lib/utils/money';
	import { canCancelOrder, nextOrderStatus, ORDER_STATUS_LABELS } from '$lib/utils/status';
	import { startPolling, type PollingHandle } from '$lib/utils/polling';

	type BoardState = 'loading' | 'ready' | 'error';
	type RowAction = 'advance' | 'pay' | 'cancel' | 'delete';

	let filter: AdminOrderFilter = 'all';
	let orders: Order[] = [];
	let kpiOrders: Order[] = [];
	let boardState: BoardState = 'loading';
	let boardError = '';
	let boardErrorTitle = 'Hindi ma-load ang board';
	let boardBusy = false;
	let rowErrors: Record<number, string> = {};
	let busyRows: Record<number, boolean> = {};
	let kpiStale = true;
	let currentAuthStatus: AuthStatus = 'loading';
	let mounted = true;
	let boardRequest = 0;
	let adminPolling: PollingHandle | null = null;

	let orderingQrUrl: string | null = null;
	let orderingQrBlob: Blob | null = null;
	let orderingQrError = '';
	let orderingQrBusy = false;
	let orderingQrRequest = 0;

	$: sortedOrders = sortOrdersNewestFirst(orders);
	$: kpis = deriveAdminKpis(kpiOrders);

	onMount(() => {
		const unsubscribe = authStore.subscribe((state) => {
			currentAuthStatus = state.status;
			if (state.status !== 'authenticated') {
				stopAdminPolling();
				boardRequest += 1;
				clearOrderingQr();
			}
		});

		if (currentAuthStatus === 'authenticated') {
			void loadOrders(true);
			void refreshOrderingQr();
			adminPolling = startPolling(
				async () => {
					await loadOrders(false);
					return false;
				},
				() => false,
				{
					intervalMs: ADMIN_POLL_INTERVAL_MS,
					shouldPoll: () => mounted && currentAuthStatus === 'authenticated' && !boardBusy
				}
			);
		}

		return () => {
			mounted = false;
			boardRequest += 1;
			stopAdminPolling();
			unsubscribe();
			clearOrderingQr();
		};
	});

	function stopAdminPolling(): void {
		adminPolling?.stop();
		adminPolling = null;
	}

	function isOffline(): boolean {
		return typeof navigator !== 'undefined' && navigator.onLine === false;
	}

	function loadErrorMessage(error: unknown): string {
		if (!(error instanceof ApiError)) return 'Hindi ma-load ang mga order. Subukan muli.';
		switch (error.status) {
			case 0:
				return 'Walang koneksyon. Suriin ang internet at subukan muli.';
			case 403:
				return 'Walang pahintulot na makita ang mga order (403).';
			case 429:
				return 'Masyadong maraming request (429). Maghintay bago mag-refresh.';
			default:
				return error.message || `Hindi ma-load ang mga order (${error.status}).`;
		}
	}

	async function loadOrders(showLoading = false): Promise<boolean> {
		if (currentAuthStatus !== 'authenticated') return true;
		const request = ++boardRequest;
		if (showLoading || orders.length === 0) boardState = 'loading';
		boardBusy = true;
		boardError = '';
		boardErrorTitle = 'Hindi ma-load ang board';
		kpiStale = true;

		if (isOffline()) {
			if (request === boardRequest && mounted) {
				boardState = orders.length > 0 ? 'ready' : 'error';
				boardError = 'Walang koneksyon. Suriin ang internet at subukan muli.';
				boardBusy = false;
			}
			return false;
		}

		try {
			const requestedStatus = filter === 'all' ? undefined : filter;
			let loaded: Order[];
			let fullOrders: Order[] | null;
			if (requestedStatus === undefined) {
				loaded = await listOrders();
				fullOrders = loaded;
			} else {
				// Keep a successfully server-filtered ledger visible if its independent KPI fetch fails.
				const [filteredResult, fullResult] = await Promise.allSettled([
					listOrders(requestedStatus),
					listOrders()
				]);
				if (filteredResult.status === 'rejected') throw filteredResult.reason;
				loaded = filteredResult.value;
				fullOrders = fullResult.status === 'fulfilled' ? fullResult.value : null;
			}
			if (!mounted || request !== boardRequest) return true;
			orders = sortOrdersNewestFirst(loaded);
			if (fullOrders) {
				kpiOrders = sortOrdersNewestFirst(fullOrders);
				kpiStale = false;
			} else {
				boardErrorTitle = 'Nakuha ang mga order, pero hindi ang KPI';
				boardError = 'I-refresh muli para makuha ang pinakabagong mga bilang.';
				kpiStale = true;
			}
			boardState = 'ready';
			return true;
		} catch (error) {
			if (!mounted || request !== boardRequest) return true;
			boardState = orders.length > 0 ? 'ready' : 'error';
			boardError = loadErrorMessage(error);
			boardErrorTitle = 'Hindi ma-load ang board';
			kpiStale = true;
			return false;
		} finally {
			if (request === boardRequest) boardBusy = false;
		}
	}

	function isAdminOrderFilter(value: string): value is AdminOrderFilter {
		return ADMIN_ORDER_FILTERS.some((option) => option === value);
	}

	function selectFilter(value: string): void {
		if (!isAdminOrderFilter(value) || value === filter) return;
		filter = value;
		orders = [];
		rowErrors = {};
		kpiStale = true;
		boardState = 'loading';
		void loadOrders(true);
	}

	function refreshBoard(): void {
		if (!boardBusy) void loadOrders(false);
	}

	function rowActionError(error: unknown, action: RowAction): string {
		if (!(error instanceof ApiError)) return `Hindi natuloy ang ${action} action.`;
		switch (error.status) {
			case 0:
				return 'Walang koneksyon. Walang binagong server state; subukan muli kapag online na.';
			case 403:
				return `Walang pahintulot sa aksyon na ito (403). Walang binagong server state.`;
			case 409:
				return 'Nagbago ang order bago nakumpleto ang aksyon (409). I-refresh ang row at subukan muli.';
			case 429:
				return 'Masyadong maraming request (429). Maghintay bago subukan muli.';
			default:
				return error.message || `Hindi natuloy ang aksyon (${error.status}).`;
		}
	}

	function setRowBusy(orderId: number, busy: boolean): void {
		const next = { ...busyRows };
		if (busy) next[orderId] = true;
		else delete next[orderId];
		busyRows = next;
	}

	function clearRowError(orderId: number): void {
		const next = { ...rowErrors };
		delete next[orderId];
		rowErrors = next;
	}

	function confirmDestructiveAction(order: Order, action: 'cancel' | 'delete'): boolean {
		if (typeof window === 'undefined') return true;
		return window.confirm(
			action === 'cancel'
				? `Kanselahin ang order #${order.order_id}? Hindi na ito maibabalik.`
				: `Burahin ang order #${order.order_id}? Hindi na ito maibabalik.`
		);
	}

	async function runRowAction(order: Order, action: RowAction): Promise<void> {
		if (busyRows[order.order_id] === true) return;
		if ((action === 'cancel' || action === 'delete') && !confirmDestructiveAction(order, action)) {
			return;
		}

		const nextStatus = order.status === null ? null : nextOrderStatus(order.status);
		if (action === 'advance' && nextStatus === null) return;
		if (action === 'cancel' && (order.status === null || !canCancelOrder(order.status))) return;
		if (action === 'pay' && (order.payment_status === 'paid' || order.status === 'Cancelled'))
			return;

		setRowBusy(order.order_id, true);
		clearRowError(order.order_id);

		try {
			try {
				switch (action) {
					case 'advance':
						await updateOrderStatus(order.order_id, nextStatus as OrderStatus);
						break;
					case 'pay':
						await payOrder(order.order_id);
						break;
					case 'cancel':
						await cancelOrder(order.order_id);
						break;
					case 'delete':
						await deleteOrder(order.order_id);
						break;
				}
			} catch (error) {
				if (mounted) rowErrors = { ...rowErrors, [order.order_id]: rowActionError(error, action) };
				return;
			}

			// Never infer the new row from the action response; reload the server view.
			const refreshed = await loadOrders(false);
			if (!refreshed && mounted) {
				boardErrorTitle = 'Aksyon matagumpay, pero hindi na-refresh ang board';
				boardError =
					'Maaaring luma ang ipinapakitang data. I-refresh muli para makumpirma ang server state.';
			}
		} finally {
			if (mounted) setRowBusy(order.order_id, false);
		}
	}

	function nextLabel(status: OrderStatus | null): string {
		if (status === null) return '';
		const next = nextOrderStatus(status);
		return next ? `→ ${ORDER_STATUS_LABELS[next]}` : '';
	}

	function actionAriaLabel(action: RowAction, order: Order): string {
		switch (action) {
			case 'advance': {
				const next = order.status === null ? null : nextOrderStatus(order.status);
				return `Isulong ang order #${order.order_id} sa ${
					next ? ORDER_STATUS_LABELS[next] : 'susunod na status'
				}`;
			}
			case 'pay':
				return `Markahang bayad ang order #${order.order_id}`;
			case 'cancel':
				return `Kanselahin ang order #${order.order_id}`;
			case 'delete':
				return `Burahin ang order #${order.order_id}`;
		}
	}

	function formatRowDate(order: Order): string {
		return formatAdminDate(order.created_at ?? order.updated_at);
	}

	function orderTotalCents(order: Order): number {
		try {
			return parsePriceToCents(order.total_amount);
		} catch {
			return 0;
		}
	}

	function orderItemsLabel(order: Order): string {
		if (order.products.length === 0) return 'Walang item';
		return order.products
			.map((item) => `${item.product?.name ?? 'Putahe'} × ${item.quantity}`)
			.join(', ');
	}

	function emptyOrdersTitle(): string {
		return filter === 'all'
			? 'Walang order'
			: `Walang order sa status na ${adminOrderFilterLabel(filter)}`;
	}

	function clearOrderingQr(): void {
		orderingQrRequest += 1;
		if (orderingQrUrl && typeof URL.revokeObjectURL === 'function') {
			URL.revokeObjectURL(orderingQrUrl);
		}
		orderingQrUrl = null;
		orderingQrBlob = null;
		orderingQrBusy = false;
		orderingQrError = '';
	}

	function downloadOrderingQr(): void {
		if (
			!orderingQrBlob ||
			typeof document === 'undefined' ||
			typeof URL.createObjectURL !== 'function'
		)
			return;

		const downloadUrl = URL.createObjectURL(orderingQrBlob);
		const link = document.createElement('a');
		link.href = downloadUrl;
		link.download = 'kanto-ordering-qr.svg';
		link.click();
		window.setTimeout(() => {
			if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(downloadUrl);
		}, 60_000);
	}

	function qrErrorMessage(error: unknown): string {
		if (!(error instanceof ApiError)) return 'Hindi ma-load ang ordering QR. Subukan muli.';
		switch (error.status) {
			case 0:
				return 'Walang koneksyon. Subukan muli kapag online na.';
			case 403:
				return 'Walang pahintulot na kumuha ng ordering QR (403).';
			case 429:
				return 'Masyadong maraming request (429). Maghintay bago mag-refresh.';
			default:
				return error.message || `Hindi ma-load ang ordering QR (${error.status}).`;
		}
	}

	async function refreshOrderingQr(): Promise<void> {
		if (currentAuthStatus !== 'authenticated' || orderingQrBusy) return;
		const request = ++orderingQrRequest;
		orderingQrBusy = true;
		orderingQrError = '';

		if (isOffline()) {
			orderingQrError = 'Walang koneksyon. Subukan muli kapag online na.';
			orderingQrBusy = false;
			return;
		}

		try {
			const blob = await getOrderingQr();
			if (
				!mounted ||
				request !== orderingQrRequest ||
				currentAuthStatus !== 'authenticated' ||
				typeof URL.createObjectURL !== 'function'
			) {
				return;
			}
			const nextUrl = URL.createObjectURL(blob);
			const previousUrl = orderingQrUrl;
			orderingQrUrl = nextUrl;
			orderingQrBlob = blob;
			if (previousUrl && typeof URL.revokeObjectURL === 'function') {
				URL.revokeObjectURL(previousUrl);
			}
		} catch (error) {
			if (mounted && request === orderingQrRequest) orderingQrError = qrErrorMessage(error);
		} finally {
			if (mounted && request === orderingQrRequest) orderingQrBusy = false;
		}
	}

	function logoutAndLeave(): void {
		logout();
		void goto(resolve('/login'));
	}
</script>

<svelte:head>
	<title>Kanto Kusina - Order Board</title>
</svelte:head>

<section class="admin-board" aria-labelledby="admin-title">
	<header class="admin-board__header">
		<div>
			<p class="eyebrow">Kusina · live board</p>
			<h1 class="hero__title" id="admin-title">
				<span class="hero__word">ORDER</span>
				<span class="hero__word hero__word--hot">BOARD.</span>
			</h1>
			<p class="hero__note">Mga order lang mula sa server. Walang hula sa status.</p>
		</div>
		<div class="admin-board__header-actions">
			<Button variant="ghost" href={resolve('/')}>Menu</Button>
			<Button variant="quiet" onclick={logoutAndLeave}>Mag-logout</Button>
		</div>
	</header>

	<section
		class="kpi-grid"
		aria-label="Mga pangunahing bilang"
		aria-busy={boardBusy}
		data-kpi-stale={kpiStale}
	>
		<KpiCard
			label="Orders ngayong araw"
			value={kpiStale ? '—' : String(kpis.todayOrders)}
			detail={kpiStale ? 'Hindi napapanahon; i-refresh ang board.' : ''}
		/>
		<KpiCard
			label="Bayad na revenue"
			value={kpiStale ? '—' : formatPeso(kpis.paidRevenueCents)}
			detail={kpiStale ? 'Hindi napapanahon; i-refresh ang board.' : ''}
		/>
		<KpiCard
			label="Hindi bayad o failed"
			value={kpiStale ? '—' : String(kpis.unpaidOrFailed)}
			detail={kpiStale ? 'Hindi napapanahon; i-refresh ang board.' : ''}
		/>
	</section>

	<section class="admin-filter-panel paper-panel" aria-labelledby="filter-title">
		<div class="admin-filter-panel__copy">
			<p class="eyebrow" id="filter-title">Salain ang ledger</p>
			<p>Pinipili ang eksaktong status na ipinapadala sa backend.</p>
		</div>
		<div class="admin-filter-panel__controls">
			<label for="order-status-filter">Status ng order</label>
			<select
				id="order-status-filter"
				aria-label="Salain ang status ng order"
				value={filter}
				onchange={(event) => selectFilter((event.currentTarget as HTMLSelectElement).value)}
			>
				{#each ADMIN_ORDER_FILTERS as option (option)}
					<option value={option}>{adminOrderFilterLabel(option)}</option>
				{/each}
			</select>
			<Button
				variant="quiet"
				size="small"
				disabled={boardBusy}
				busy={boardBusy}
				onclick={refreshBoard}
			>
				{boardBusy ? 'Nagre-refresh...' : 'I-refresh'}
			</Button>
		</div>
	</section>

	{#if boardError}
		<InlineAlert tone="error" title={boardErrorTitle}>{boardError}</InlineAlert>
	{/if}

	<section class="admin-orders" aria-labelledby="orders-title" aria-busy={boardBusy}>
		<div class="section-heading">
			<PaintedSign id="orders-title" text="MGA ORDER" delay="0.08s" />
			<span class="section-sidenote">pinakabago muna</span>
		</div>

		{#if boardState === 'loading' && sortedOrders.length === 0}
			<Skeleton lines={7} label="Naglo-load ang mga order" />
		{:else if boardState === 'error' && sortedOrders.length === 0}
			<PaperPanel>
				<EmptyState
					title="Hindi pa mabuksan ang ledger"
					description="Subukan muli kapag handa na ang kusina connection."
					titleId="orders-error-title"
				/>
				<div class="admin-state__action">
					<Button variant="ghost" onclick={refreshBoard}>Subukan muli</Button>
				</div>
			</PaperPanel>
		{:else if sortedOrders.length === 0}
			<PaperPanel>
				<EmptyState
					title={emptyOrdersTitle()}
					description="Walang row na bumalik mula sa kasalukuyang filter."
					titleId="orders-empty-title"
				/>
			</PaperPanel>
		{:else}
			<div class="admin-ledger-wrap">
				<table class="admin-ledger">
					<caption class="sr-only">Mga order, pinakabago muna</caption>
					<thead>
						<tr>
							<th scope="col">Order</th>
							<th scope="col">Mga putahe</th>
							<th scope="col">Status</th>
							<th scope="col">Bayad</th>
							<th scope="col">Total</th>
							<th scope="col">Aksyon</th>
						</tr>
					</thead>
					<tbody>
						{#each sortedOrders as order (order.order_id)}
							{@const nextStatus = order.status === null ? null : nextOrderStatus(order.status)}
							{@const rowBusy = busyRows[order.order_id] === true}
							<tr data-order-id={order.order_id}>
								<td>
									<strong>#{order.order_id}</strong>
									<time datetime={formatAdminDateTime(order.created_at ?? order.updated_at)}
										>{formatRowDate(order)}</time
									>
								</td>
								<td>{orderItemsLabel(order)}</td>
								<td>
									{#if order.status}
										<StatusChip status={order.status} />
									{:else}
										<span class="admin-unknown-status">Walang status</span>
									{/if}
								</td>
								<td><StatusChip kind="payment" status={order.payment_status} /></td>
								<td class="admin-ledger__total">{formatPeso(orderTotalCents(order))}</td>
								<td class="admin-ledger__actions">
									<div class="admin-row-actions">
										{#if nextStatus}
											<button
												class="btn btn--enamel btn--small"
												type="button"
												disabled={rowBusy}
												aria-busy={rowBusy}
												aria-label={actionAriaLabel('advance', order)}
												onclick={() => void runRowAction(order, 'advance')}
											>
												{nextLabel(order.status)}
											</button>
										{/if}
										{#if order.status !== 'Cancelled' && order.payment_status !== 'paid'}
											<button
												class="btn btn--ghost btn--small"
												type="button"
												disabled={rowBusy}
												aria-label={actionAriaLabel('pay', order)}
												onclick={() => void runRowAction(order, 'pay')}
											>
												Markahang bayad
											</button>
										{/if}
										{#if order.status && canCancelOrder(order.status)}
											<button
												class="btn btn--quiet btn--small"
												type="button"
												disabled={rowBusy}
												aria-label={actionAriaLabel('cancel', order)}
												onclick={() => void runRowAction(order, 'cancel')}
											>
												Kanselahin
											</button>
										{/if}
										<button
											class="btn btn--quiet btn--small admin-delete-action"
											type="button"
											disabled={rowBusy}
											aria-label={actionAriaLabel('delete', order)}
											onclick={() => void runRowAction(order, 'delete')}
										>
											Burahin
										</button>
									</div>
									{#if rowErrors[order.order_id]}
										<div class="admin-row-error">
											<InlineAlert tone="error" title={`Order #${order.order_id}`}>
												{rowErrors[order.order_id]}
											</InlineAlert>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<section class="admin-order-cards" aria-label="Mga order sa mobile">
				{#each sortedOrders as order (order.order_id)}
					{@const nextStatus = order.status === null ? null : nextOrderStatus(order.status)}
					{@const rowBusy = busyRows[order.order_id] === true}
					<article
						class="admin-order-card"
						data-order-card-id={order.order_id}
						aria-label={`Order #${order.order_id}`}
					>
						<header class="admin-order-card__header">
							<div>
								<span class="eyebrow">Order</span>
								<h2>#{order.order_id}</h2>
								<time datetime={formatAdminDateTime(order.created_at ?? order.updated_at)}
									>{formatRowDate(order)}</time
								>
							</div>
							<strong class="admin-order-card__total">{formatPeso(orderTotalCents(order))}</strong>
						</header>
						<dl class="admin-order-card__facts">
							<div>
								<dt>Mga putahe</dt>
								<dd>{orderItemsLabel(order)}</dd>
							</div>
							<div>
								<dt>Status</dt>
								<dd>
									{#if order.status}
										<StatusChip status={order.status} />
									{:else}
										<span class="admin-unknown-status">Walang status</span>
									{/if}
								</dd>
							</div>
							<div>
								<dt>Bayad</dt>
								<dd><StatusChip kind="payment" status={order.payment_status} /></dd>
							</div>
						</dl>
						<div class="admin-row-actions">
							{#if nextStatus}
								<button
									class="btn btn--enamel btn--small"
									type="button"
									disabled={rowBusy}
									aria-busy={rowBusy}
									aria-label={actionAriaLabel('advance', order)}
									onclick={() => void runRowAction(order, 'advance')}
								>
									{nextLabel(order.status)}
								</button>
							{/if}
							{#if order.status !== 'Cancelled' && order.payment_status !== 'paid'}
								<button
									class="btn btn--ghost btn--small"
									type="button"
									disabled={rowBusy}
									aria-label={actionAriaLabel('pay', order)}
									onclick={() => void runRowAction(order, 'pay')}
								>
									Markahang bayad
								</button>
							{/if}
							{#if order.status && canCancelOrder(order.status)}
								<button
									class="btn btn--quiet btn--small"
									type="button"
									disabled={rowBusy}
									aria-label={actionAriaLabel('cancel', order)}
									onclick={() => void runRowAction(order, 'cancel')}
								>
									Kanselahin
								</button>
							{/if}
							<button
								class="btn btn--quiet btn--small admin-delete-action"
								type="button"
								disabled={rowBusy}
								aria-label={actionAriaLabel('delete', order)}
								onclick={() => void runRowAction(order, 'delete')}
							>
								Burahin
							</button>
						</div>
						{#if rowErrors[order.order_id]}
							<div class="admin-row-error">
								<InlineAlert tone="error" title={`Order #${order.order_id}`}>
									{rowErrors[order.order_id]}
								</InlineAlert>
							</div>
						{/if}
					</article>
				{/each}
			</section>
		{/if}
	</section>

	<section class="admin-qr-panel paper-panel" aria-labelledby="ordering-qr-title">
		<div class="section-heading">
			<PaintedSign id="ordering-qr-title" text="ORDERING QR" delay="0.1s" />
			<span class="section-sidenote">general menu access</span>
		</div>
		<p class="admin-qr-panel__intro">
			Ito ang general ordering/menu QR ng restaurant. Hindi ito table-specific at walang table
			identity ang backend order contract.
		</p>
		<div class="admin-qr-panel__body">
			<div class="admin-qr-panel__preview">
				{#if orderingQrUrl}
					<img
						class="ordering-qr"
						src={orderingQrUrl}
						alt="QR code para sa general ordering menu"
					/>
				{:else if orderingQrBusy}
					<Skeleton lines={3} label="Naglo-load ang ordering QR" />
				{:else}
					<p class="admin-qr-panel__empty">Walang QR na ipinapakita ngayon.</p>
				{/if}
			</div>
			<div class="admin-qr-panel__actions">
				{#if orderingQrError}
					<InlineAlert tone="error" title="Hindi ma-load ang QR">{orderingQrError}</InlineAlert>
				{/if}
				<div class="admin-row-actions">
					<Button
						variant="ghost"
						size="small"
						disabled={orderingQrBusy}
						busy={orderingQrBusy}
						onclick={refreshOrderingQr}
					>
						{orderingQrBusy ? 'Kinukuha...' : 'I-refresh ang QR'}
					</Button>
					{#if orderingQrUrl && orderingQrBlob}
						<Button variant="quiet" size="small" onclick={downloadOrderingQr}>
							I-download ang SVG
						</Button>
					{/if}
				</div>
			</div>
		</div>
	</section>
</section>
