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
	import AdminMenuBoard from '$lib/components/admin/AdminMenuBoard.svelte';
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
		formatAdminDateTime,
		parseAdminDate,
		sortOrdersNewestFirst,
		type AdminOrderFilter
	} from '$lib/utils/admin-orders';
	import { formatPeso, parsePriceToCents } from '$lib/utils/money';
	import { canCancelOrder, nextOrderStatus, ORDER_STATUS_LABELS } from '$lib/utils/status';
	import { startPolling, type PollingHandle } from '$lib/utils/polling';

	type BoardState = 'loading' | 'ready' | 'error';
	type RowAction = 'advance' | 'pay' | 'cancel' | 'delete';
	type AdminStation = 'orders' | 'menu' | 'qr';

	const ADMIN_STATIONS: readonly AdminStation[] = ['orders', 'menu', 'qr'];
	const ADMIN_TIME_FORMATTER = new Intl.DateTimeFormat('fil-PH', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});

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
	let activeStation: AdminStation = 'orders';

	$: sortedOrders = sortOrdersNewestFirst(orders);
	$: kpis = deriveAdminKpis(kpiOrders);

	onMount(() => {
		const syncStationFromHash = (): void => {
			activeStation = stationFromHash(window.location.hash);
		};
		window.addEventListener('hashchange', syncStationFromHash);
		syncStationFromHash();

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
			window.removeEventListener('hashchange', syncStationFromHash);
			clearOrderingQr();
		};
	});

	function stationFromHash(hash: string): AdminStation {
		switch (hash.replace(/^#/, '').toLowerCase()) {
			case 'menu':
				return 'menu';
			case 'qr':
				return 'qr';
			default:
				return 'orders';
		}
	}

	function stationTabId(station: AdminStation): string {
		return `admin-tab-${station}`;
	}

	function stationLabel(station: AdminStation): string {
		switch (station) {
			case 'orders':
				return 'MGA ORDER';
			case 'menu':
				return 'MENU';
			case 'qr':
				return 'QR NG MESA';
		}
	}

	function stationNote(station: AdminStation): string {
		switch (station) {
			case 'orders':
				return kpiStale ? 'naglo-load' : `${kpis.todayOrders} ngayon`;
			case 'menu':
				return 'setup ng ulam';
			case 'qr':
				return '';
		}
	}

	function filterCount(option: AdminOrderFilter): string {
		if (kpiStale) return '—';
		if (option === 'all') return String(kpiOrders.length);
		return String(kpiOrders.filter((order) => order.status === option).length);
	}

	function selectStation(station: AdminStation, updateHash = true): void {
		activeStation = station;
		if (!updateHash || typeof window === 'undefined') return;

		const nextHash = station === 'orders' ? '' : `#${station}`;
		if (window.location.hash === nextHash) return;
		window.history.replaceState(
			null,
			'',
			`${window.location.pathname}${window.location.search}${nextHash}`
		);
	}

	function handleStationKeydown(event: KeyboardEvent, station: AdminStation): void {
		const currentIndex = ADMIN_STATIONS.indexOf(station);
		let nextIndex: number;
		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				nextIndex = (currentIndex + 1) % ADMIN_STATIONS.length;
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				nextIndex = (currentIndex - 1 + ADMIN_STATIONS.length) % ADMIN_STATIONS.length;
				break;
			case 'Home':
				nextIndex = 0;
				break;
			case 'End':
				nextIndex = ADMIN_STATIONS.length - 1;
				break;
			default:
				return;
		}

		event.preventDefault();
		const nextStation = ADMIN_STATIONS[nextIndex];
		selectStation(nextStation);
		window.setTimeout(() => document.getElementById(stationTabId(nextStation))?.focus());
	}

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

	function formatRowTime(order: Order): string {
		const date = parseAdminDate(order.created_at ?? order.updated_at);
		if (!date) return '—';
		return ADMIN_TIME_FORMATTER.format(date);
	}

	function formatOrderNumber(orderId: number): string {
		return String(orderId).padStart(4, '0');
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
			.map((item) => `${item.product?.name ?? 'Putahe'} ×${item.quantity}`)
			.join(' · ');
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

<div class="admin-board">
	<h1 class="sr-only">Kusina — admin board</h1>

	<section
		class="kpi-grid"
		aria-label="Buod ngayong araw"
		aria-busy={boardBusy}
		data-kpi-stale={kpiStale}
	>
		<KpiCard
			label="Order ngayong araw"
			value={kpiStale ? '—' : String(kpis.todayOrders)}
			detail={kpiStale ? 'Hindi napapanahon; i-refresh ang board.' : ''}
		/>
		<KpiCard
			label="Benta (bayad na)"
			value={kpiStale ? '—' : formatPeso(kpis.paidRevenueCents)}
			detail={kpiStale ? 'Hindi napapanahon; i-refresh ang board.' : ''}
		/>
		<KpiCard
			label="Hinihintay ang bayad"
			value={kpiStale ? '—' : String(kpis.unpaidOrFailed)}
			detail={kpiStale ? 'Hindi napapanahon; i-refresh ang board.' : ''}
		/>
	</section>

	<div class="admin-binder admin-workspace" data-admin-binder>
		<div class="admin-binder-tabs" role="tablist" aria-label="Mga istasyon ng counter">
			{#each ADMIN_STATIONS as station (station)}
				<button
					class="admin-binder-tab"
					type="button"
					role="tab"
					id={stationTabId(station)}
					aria-controls={`admin-station-${station}`}
					aria-selected={activeStation === station}
					tabindex={activeStation === station ? 0 : -1}
					onclick={() => selectStation(station)}
					onkeydown={(event) => handleStationKeydown(event, station)}
				>
					<span class="admin-binder-tab__label">{stationLabel(station)}</span>
					{#if stationNote(station)}
						<span class="admin-binder-tab__note hand">{stationNote(station)}</span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
		<section
			class="admin-station admin-station--orders"
			role="tabpanel"
			id="admin-station-orders"
			aria-labelledby="admin-tab-orders"
			hidden={activeStation !== 'orders'}
		>
			<section class="admin-orders" aria-labelledby="admin-title" aria-busy={boardBusy}>
				<header class="admin-orders__header">
					<div class="section-heading">
						<PaintedSign id="admin-title" text="MGA ORDER" level="h2" delay="0.08s" />
						<span class="section-sidenote">live board ng kusina</span>
					</div>
					<Button variant="quiet" size="small" onclick={logoutAndLeave}>Mag-logout</Button>
				</header>

				<div class="admin-filter-row admin-station-bar">
					<nav class="admin-status-tabs" aria-label="Salain ayon sa status ng kusina">
						{#each ADMIN_ORDER_FILTERS as option (option)}
							<button
								class="admin-status-tab"
								type="button"
								aria-label={adminOrderFilterLabel(option)}
								aria-pressed={filter === option}
								onclick={() => selectFilter(option)}
							>
								<span class="admin-status-tab__name">{adminOrderFilterLabel(option)}</span>
								<span class="admin-status-tab__count till" aria-hidden="true"
									>{filterCount(option)}</span
								>
							</button>
						{/each}
					</nav>
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

				{#if boardError}
					<InlineAlert tone="error" title={boardErrorTitle}>{boardError}</InlineAlert>
				{/if}

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
					<p class="admin-ledger-hint" id="admin-ledger-hint">
						I-scroll pahalang para makita ang status, bayad, at mga aksyon.
					</p>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to horizontal overflow) -->
					<div
						class="admin-ledger-wrap"
						role="region"
						aria-label="Scrollable na ledger ng mga order"
						aria-describedby="admin-ledger-hint"
						tabindex="0"
					>
						<table class="admin-ledger">
							<caption class="sr-only">Mga order, pinakabago muna</caption>
							<thead>
								<tr>
									<th scope="col">Oras</th>
									<th scope="col">#</th>
									<th scope="col">Laman</th>
									<th scope="col">Kabuuan</th>
									<th scope="col">Kusina</th>
									<th scope="col">Bayad</th>
									<th scope="col">Aksyon</th>
								</tr>
							</thead>
							<tbody>
								{#each sortedOrders as order (order.order_id)}
									{@const nextStatus = order.status === null ? null : nextOrderStatus(order.status)}
									{@const rowBusy = busyRows[order.order_id] === true}
									<tr data-order-id={order.order_id}>
										<td class="admin-ledger__time">
											<time datetime={formatAdminDateTime(order.created_at ?? order.updated_at)}
												>{formatRowTime(order)}</time
											>
										</td>
										<td class="admin-ledger__number">{formatOrderNumber(order.order_id)}</td>
										<td>{orderItemsLabel(order)}</td>
										<td class="admin-ledger__total">{formatPeso(orderTotalCents(order))}</td>
										<td>
											{#if order.status}
												<StatusChip status={order.status} />
											{:else}
												<span class="admin-unknown-status">Walang status</span>
											{/if}
										</td>
										<td><StatusChip kind="payment" status={order.payment_status} /></td>
										<td class="admin-ledger__actions">
											<div class="admin-row-actions">
												{#if nextStatus}
													<button
														class="admin-icon-button"
														type="button"
														disabled={rowBusy}
														aria-busy={rowBusy}
														aria-label={actionAriaLabel('advance', order)}
														title={actionAriaLabel('advance', order)}
														onclick={() => void runRowAction(order, 'advance')}
													>
														<svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
															<path
																d="M4 12.5c5-.7 9-.3 14.5-.7M15 7.5c1.8 1.7 3 2.9 4.5 4.5-1.5 1.6-2.9 2.9-4.5 4.3"
															/>
														</svg>
													</button>
												{/if}
												{#if order.status !== 'Cancelled' && order.payment_status !== 'paid'}
													<button
														class="admin-icon-button"
														type="button"
														disabled={rowBusy}
														aria-busy={rowBusy}
														aria-label={actionAriaLabel('pay', order)}
														title={actionAriaLabel('pay', order)}
														onclick={() => void runRowAction(order, 'pay')}
													>
														<svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
															<path />
														</svg>
													</button>
												{/if}
												{#if order.status && canCancelOrder(order.status)}
													<button
														class="admin-icon-button admin-icon-button--danger"
														type="button"
														disabled={rowBusy}
														aria-busy={rowBusy}
														aria-label={actionAriaLabel('cancel', order)}
														title={actionAriaLabel('cancel', order)}
														onclick={() => void runRowAction(order, 'cancel')}
													>
														<svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
															<path
																d="M6.5 6.8c3.5 3.2 7.5 7.4 11 10.5M17.3 6.5c-3.5 3.7-7 7.5-10.5 11"
															/>
														</svg>
													</button>
												{/if}
												<button
													class="admin-icon-button admin-icon-button--danger"
													type="button"
													disabled={rowBusy}
													aria-busy={rowBusy}
													aria-label={actionAriaLabel('delete', order)}
													title={actionAriaLabel('delete', order)}
													onclick={() => void runRowAction(order, 'delete')}
												>
													<svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
														<path
															d="M5 7c4.5-.4 9.5-.3 14 .1M9.5 6.8l.5-3 4.2.2.5 2.9M7 7.5 8.2 20h7.7L17 7.4M10.5 10.5l.5 6.5M14 10.4l-.4 6.6"
														/>
													</svg>
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
				{/if}
				<p class="admin-ledger-note">
					Ang “Bayad” ay payment status mula sa server: unpaid, paid, o failed.
				</p>
			</section>
		</section>

		<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
		<section
			class="admin-station admin-station--menu"
			role="tabpanel"
			id="admin-station-menu"
			aria-labelledby="admin-tab-menu"
			hidden={activeStation !== 'menu'}
		>
			<AdminMenuBoard active={currentAuthStatus === 'authenticated' && activeStation === 'menu'} />
		</section>

		<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
		<section
			class="admin-station admin-station--qr"
			role="tabpanel"
			id="admin-station-qr"
			aria-labelledby="admin-tab-qr"
			hidden={activeStation !== 'qr'}
		>
			<div class="admin-qr-wrap">
				<aside class="admin-qr-panel paper-panel" aria-labelledby="ordering-qr-title">
					<h2 class="sign-type admin-qr-panel__title" id="ordering-qr-title">QR NG MESA</h2>
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
					<p class="admin-qr-panel__route">General ordering QR · walang table identity o expiry.</p>
					<p class="admin-qr-panel__note">i-print, idikit sa mesa — 'yan na ang “waiter” ninyo</p>
					{#if orderingQrError}
						<InlineAlert tone="error" title="Hindi ma-load ang QR">{orderingQrError}</InlineAlert>
					{/if}
					<div class="admin-qr-panel__actions">
						<Button
							variant="enamel"
							disabled={orderingQrBusy}
							busy={orderingQrBusy}
							onclick={refreshOrderingQr}
						>
							{orderingQrBusy ? 'Kinukuha...' : 'Kumuha ng bagong QR'}
						</Button>
						{#if orderingQrUrl && orderingQrBlob}
							<Button variant="ghost" onclick={downloadOrderingQr}>I-download ang SVG</Button>
						{/if}
					</div>
					<p class="admin-qr-panel__footnote">
						Isang QR para sa buong kainan. Ang pagkuha nito ay para sa admin lang.
					</p>
				</aside>
			</div>
		</section>
	</div>
</div>
