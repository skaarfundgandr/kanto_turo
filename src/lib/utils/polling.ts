/**
 * Bounded, visibility-aware polling for order status updates.
 * Ticks are skipped while the document is hidden or the browser is offline;
 * becoming visible resumes immediately with a fresh poll. Polling stops only
 * via `stop()` (terminal fulfillment or an unrecoverable state).
 */

export interface PollingOptions {
	/** Milliseconds between ticks. Defaults to 8000. */
	intervalMs?: number;
	/** Visibility predicate; default reads `document.visibilityState`. */
	isVisible?: () => boolean;
	/** Online predicate; default reads `navigator.onLine`. */
	isOnline?: () => boolean;
	/** Returns false while the caller has a higher-priority request in flight. */
	shouldPoll?: () => boolean;
	/** Returns true when a rejected fetch should stop polling permanently. */
	shouldStopOnError?: (error: unknown) => boolean;
}

export interface PollingHandle {
	stop(): void;
}

function defaultIsVisible(): boolean {
	return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function defaultIsOnline(): boolean {
	return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function startPolling<T>(
	fetchResult: () => Promise<T>,
	shouldStop: (value: T) => boolean,
	options: PollingOptions = {}
): PollingHandle {
	const intervalMs = options.intervalMs ?? 8000;
	const isVisible = options.isVisible ?? defaultIsVisible;
	const isOnline = options.isOnline ?? defaultIsOnline;
	const shouldPoll = options.shouldPoll ?? (() => true);
	const shouldStopOnError = options.shouldStopOnError;

	let stopped = false;
	let timer: ReturnType<typeof setInterval> | null = null;
	let tickInFlight = false;

	const stop = () => {
		if (stopped) return;
		stopped = true;
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', onVisibilityChange);
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener('online', onNetworkChange);
		}
	};

	const tick = async () => {
		if (stopped || tickInFlight) return;
		if (!shouldPoll()) return;
		if (!isVisible() || !isOnline()) return;
		tickInFlight = true;
		try {
			const value = await fetchResult();
			if (!stopped && shouldStop(value)) stop();
		} catch (error) {
			if (!stopped && shouldStopOnError?.(error)) stop();
		} finally {
			tickInFlight = false;
		}
	};

	const onVisibilityChange = () => {
		if (isVisible() && isOnline()) void tick();
	};

	const onNetworkChange = () => {
		if (isVisible() && isOnline()) void tick();
	};

	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', onVisibilityChange);
	}
	if (typeof window !== 'undefined') {
		window.addEventListener('online', onNetworkChange);
	}
	timer = setInterval(tick, intervalMs);

	return { stop };
}
