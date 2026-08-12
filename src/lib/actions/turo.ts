const CIRCLES = [
	'M14 30 C10 13 36 4 57 6 C82 8 96 18 94 32 C92 48 68 57 45 55 C22 53 5 45 12 27',
	'M88 26 C90 12 64 5 43 7 C18 9 6 20 8 34 C10 50 34 58 57 55 C80 52 95 42 88 26'
] as const;

let nextCircleVariant: 0 | 1 = 0;

export interface TuroOptions {
	/** The label or heading that receives the ink circle. */
	target?: HTMLElement | null;
	/** The positioned host where the SVG is painted. */
	host?: HTMLElement | null;
	/** Keeps the circle visible after the pointer leaves. */
	selected?: boolean;
	/** Explicitly choose one of the two hand-drawn ellipse variants. */
	variant?: 0 | 1;
	/** Set to false to ink only the picked/selected state, never hover/focus previews. */
	preview?: boolean;
	/** Called when the action host is activated. */
	onPick?: () => void;
}

export interface CopyOptions {
	value: string;
	/** Visible label to update without replacing other button or link children. */
	label?: HTMLElement | null;
	idleLabel?: string;
	copiedLabel?: string;
	failedLabel?: string;
	timeoutMs?: number;
	onResult?: (copied: boolean) => void;
}

function nextFrame(callback: () => void): void {
	if (typeof requestAnimationFrame === 'function') {
		requestAnimationFrame(callback);
	} else {
		callback();
	}
}

type CopyLabelTarget = HTMLElement | Text;

interface ResolvedCopyLabel {
	target: CopyLabelTarget;
	generated: boolean;
}

function resolveCopyLabel(
	node: HTMLElement,
	options: CopyOptions,
	existingGeneratedLabel: HTMLElement | null = null
): ResolvedCopyLabel {
	if (options.label) return { target: options.label, generated: false };
	if (existingGeneratedLabel && node.contains(existingGeneratedLabel)) {
		return { target: existingGeneratedLabel, generated: true };
	}

	const dataLabel = node.querySelector<HTMLElement>('[data-copy-label]');
	if (dataLabel) return { target: dataLabel, generated: false };

	const textNode = Array.from(node.childNodes).find(
		(child): child is Text => child.nodeType === 3 && Boolean(child.textContent?.trim())
	);
	if (textNode) return { target: textNode, generated: false };
	if (node.childNodes.length === 0) return { target: node, generated: false };

	const generatedLabel = node.ownerDocument.createElement('span');
	generatedLabel.dataset.copyLabel = 'true';
	node.append(generatedLabel);
	return { target: generatedLabel, generated: true };
}

function labelText(target: CopyLabelTarget): string {
	return target.textContent?.trim() ?? '';
}

function setLabelText(target: CopyLabelTarget, value: string): void {
	if (target instanceof Text) {
		target.textContent = value;
		return;
	}

	const textNode = Array.from(target.childNodes).find(
		(child): child is Text => child.nodeType === 3 && Boolean(child.textContent?.trim())
	);
	if (textNode) textNode.textContent = value;
	else if (target.childNodes.length === 0) target.textContent = value;
	else target.append(target.ownerDocument.createTextNode(value));
}

function resolveTarget(node: HTMLElement, options: TuroOptions): HTMLElement {
	return options.target ?? node.querySelector<HTMLElement>('[data-turo-target]') ?? node;
}

function resolveHost(node: HTMLElement, target: HTMLElement, options: TuroOptions): HTMLElement {
	return options.host ?? target.closest<HTMLElement>('[data-turo-host]') ?? node;
}

function drawCircle(
	node: HTMLElement,
	options: TuroOptions,
	currentSvg: SVGSVGElement | null
): SVGSVGElement {
	currentSvg?.remove();

	const target = resolveTarget(node, options);
	const host = resolveHost(node, target, options);
	const padding = 7;
	const targetRect = target.getBoundingClientRect();
	const hostRect = host.getBoundingClientRect();
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	const variant = options.variant ?? nextCircleVariant;
	if (options.variant === undefined) nextCircleVariant = variant === 0 ? 1 : 0;

	if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

	svg.classList.add('turo-ink');
	svg.setAttribute('viewBox', '0 0 100 60');
	svg.setAttribute('preserveAspectRatio', 'none');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('data-turo-circle', 'true');
	svg.style.left = `${targetRect.left - hostRect.left - padding}px`;
	svg.style.top = `${targetRect.top - hostRect.top - padding * 0.7}px`;
	svg.style.width = `${targetRect.width + padding * 2}px`;
	svg.style.height = `${targetRect.height + padding * 1.4}px`;

	path.setAttribute('d', CIRCLES[variant]);
	path.setAttribute('pathLength', '1');
	path.setAttribute('vector-effect', 'non-scaling-stroke');
	svg.append(path);
	host.append(svg);

	// Two frames let the stroke-dash transition start from its hidden state.
	nextFrame(() => nextFrame(() => svg.classList.add('draw')));
	return svg;
}

/** Paints the ballpen turo circle on hover, focus, and activation. */
export function turo(node: HTMLElement, initial: TuroOptions = {}) {
	let options = initial;
	let svg: SVGSVGElement | null = null;
	const view = node.ownerDocument.defaultView;

	const draw = () => {
		svg = drawCircle(node, options, svg);
	};
	const erase = () => {
		if (options.selected) return;
		svg?.remove();
		svg = null;
	};
	const onPointerEnter = () => {
		if (options.preview !== false) draw();
	};
	const onPointerLeave = () => erase();
	const onFocusIn = () => {
		if (options.preview !== false) draw();
	};
	const onFocusOut = (event: FocusEvent) => {
		if (!node.contains(event.relatedTarget as Node | null)) erase();
	};
	const onClick = (event: MouseEvent) => {
		draw();
		const target = event.target instanceof Element ? event.target : null;
		const isTrigger = node instanceof HTMLButtonElement || target?.closest('[data-turo-trigger]');
		if (isTrigger) options.onPick?.();
	};
	const onViewportChange = () => {
		if (svg) draw();
	};

	if (options.selected) draw();
	node.addEventListener('pointerenter', onPointerEnter);
	node.addEventListener('pointerleave', onPointerLeave);
	node.addEventListener('focusin', onFocusIn);
	node.addEventListener('focusout', onFocusOut);
	node.addEventListener('click', onClick);
	view?.addEventListener('resize', onViewportChange);
	view?.addEventListener('scroll', onViewportChange, true);

	return {
		update(next: TuroOptions = {}) {
			options = next;
			if (options.selected) draw();
			else if (!node.matches(':hover') && !node.matches(':focus-within')) erase();
		},
		destroy() {
			node.removeEventListener('pointerenter', onPointerEnter);
			node.removeEventListener('pointerleave', onPointerLeave);
			node.removeEventListener('focusin', onFocusIn);
			node.removeEventListener('focusout', onFocusOut);
			node.removeEventListener('click', onClick);
			view?.removeEventListener('resize', onViewportChange);
			view?.removeEventListener('scroll', onViewportChange, true);
			svg?.remove();
		}
	};
}

/** Copies an opaque value and exposes temporary, accessible button feedback. */
export function copy(node: HTMLElement, initial: CopyOptions) {
	let options = initial;
	let resolvedLabel = resolveCopyLabel(node, options);
	let labelTarget = resolvedLabel.target;
	let generatedLabel = resolvedLabel.generated ? (labelTarget as HTMLElement) : null;
	let idleLabel = options.idleLabel ?? (labelText(labelTarget) || 'Kopyahin');
	const hadLiveRegion = node.hasAttribute('aria-live');
	const hadAtomic = node.hasAttribute('aria-atomic');
	const hadAriaLabel = node.hasAttribute('aria-label');
	const initialAriaLabel = node.getAttribute('aria-label');
	let resetTimer: ReturnType<typeof setTimeout> | null = null;

	const setLabel = (label: string) => {
		setLabelText(labelTarget, label);
		if (hadAriaLabel) node.setAttribute('aria-label', label);
	};
	const reset = () => {
		setLabel(options.idleLabel ?? idleLabel);
		node.dataset.copyState = 'idle';
		resetTimer = null;
	};
	const onClick = async (event: MouseEvent) => {
		if (node instanceof HTMLAnchorElement) event.preventDefault();
		try {
			if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable.');
			await navigator.clipboard.writeText(options.value);
			setLabel(options.copiedLabel ?? 'Nakopya na');
			node.dataset.copyState = 'copied';
			options.onResult?.(true);
		} catch {
			setLabel(options.failedLabel ?? 'Hindi nakopya');
			node.dataset.copyState = 'failed';
			options.onResult?.(false);
		}
		if (resetTimer !== null) clearTimeout(resetTimer);
		resetTimer = setTimeout(reset, options.timeoutMs ?? 1400);
	};

	if (!hadLiveRegion) node.setAttribute('aria-live', 'polite');
	if (!hadAtomic) node.setAttribute('aria-atomic', 'true');
	if (resolvedLabel.generated || options.idleLabel !== undefined) setLabel(idleLabel);
	node.dataset.copyState = 'idle';
	node.addEventListener('click', onClick);

	return {
		update(next: CopyOptions) {
			const previousTarget = labelTarget;
			options = next;
			resolvedLabel = resolveCopyLabel(node, options, generatedLabel);
			if (generatedLabel && resolvedLabel.target !== generatedLabel) generatedLabel.remove();
			labelTarget = resolvedLabel.target;
			generatedLabel = resolvedLabel.generated ? (labelTarget as HTMLElement) : null;
			if (next.idleLabel !== undefined) idleLabel = next.idleLabel;
			else if (labelTarget !== previousTarget) idleLabel = labelText(labelTarget) || idleLabel;
		},
		destroy() {
			node.removeEventListener('click', onClick);
			if (resetTimer !== null) clearTimeout(resetTimer);
			generatedLabel?.remove();
			if (!hadLiveRegion) node.removeAttribute('aria-live');
			if (!hadAtomic) node.removeAttribute('aria-atomic');
			if (hadAriaLabel) {
				if (initialAriaLabel === null) node.removeAttribute('aria-label');
				else node.setAttribute('aria-label', initialAriaLabel);
			}
			delete node.dataset.copyState;
		}
	};
}

/** Replays the restrained order-slip bump when its trigger value changes. */
export function bump(node: HTMLElement, initial: unknown) {
	let value = initial;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const replay = () => {
		node.classList.remove('is-bumping');
		void node.offsetWidth;
		node.classList.add('is-bumping');
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			node.classList.remove('is-bumping');
			timer = null;
		}, 400);
	};

	return {
		update(next: unknown) {
			if (next === value) return;
			value = next;
			replay();
		},
		destroy() {
			if (timer !== null) clearTimeout(timer);
			node.classList.remove('is-bumping');
		}
	};
}

/** Adds the motion gate classes and tracks live reduced-motion preference changes. */
export function motion(node: HTMLElement) {
	const media =
		typeof window !== 'undefined' && typeof window.matchMedia === 'function'
			? window.matchMedia('(prefers-reduced-motion: reduce)')
			: null;

	const apply = () => {
		const reduced = media?.matches ?? false;
		node.classList.toggle('motion-ok', !reduced);
		node.classList.toggle('no-motion', reduced);
	};
	const onChange = () => apply();

	apply();
	media?.addEventListener('change', onChange);

	return {
		destroy() {
			media?.removeEventListener('change', onChange);
			node.classList.remove('motion-ok', 'no-motion');
		}
	};
}
