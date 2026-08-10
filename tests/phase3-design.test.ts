import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Button from '../src/lib/components/shared/Button.svelte';
import EmptyState from '../src/lib/components/shared/EmptyState.svelte';
import InlineAlert from '../src/lib/components/shared/InlineAlert.svelte';
import ProductTray from '../src/lib/components/shared/ProductTray.svelte';
import QuantityStepper from '../src/lib/components/shared/QuantityStepper.svelte';
import StatusChip from '../src/lib/components/shared/StatusChip.svelte';
import StorefrontBand from '../src/lib/components/shared/StorefrontBand.svelte';
import Tabs from '../src/lib/components/shared/Tabs.svelte';
import KusinaShell from '../src/lib/components/shell/KusinaShell.svelte';
import PublicShell from '../src/lib/components/shell/PublicShell.svelte';
import { bump, copy, motion, turo } from '../src/lib/actions/turo';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/') }
}));

const projectRoot = process.cwd();

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	document.body.replaceChildren();
});

describe('Phase 3 visual contract', () => {
	it('keeps the global motion and touch-target guardrails', () => {
		const tokens = readFileSync(resolve(projectRoot, 'src/lib/design/tokens.css'), 'utf8');
		const globalStyles = readFileSync(resolve(projectRoot, 'src/lib/design/global.css'), 'utf8');

		expect(tokens).toContain('--hit: 44px');
		expect(globalStyles).toContain('@media (hover: hover) and (pointer: fine)');
		expect(globalStyles).toContain('@media (prefers-reduced-motion: reduce)');
	});

	it('contains product photos within their frame so card copy stays readable', () => {
		const globalStyles = readFileSync(resolve(projectRoot, 'src/lib/design/global.css'), 'utf8');

		expect(globalStyles).toMatch(/\.product-plate__photo\s*{[^}]*overflow:\s*hidden;/s);
	});

	it('keeps the Design2 admin and Kusina login sizing contracts', () => {
		const globalStyles = readFileSync(resolve(projectRoot, 'src/lib/design/global.css'), 'utf8');

		expect(globalStyles).toMatch(
			/\.login-actions--pair \.btn\s*{[^}]*width:\s*100%;[^}]*min-height:\s*52px;[^}]*padding:\s*12px 18px;/s
		);
		expect(globalStyles).toMatch(
			/@media \(max-width: 390px\)[\s\S]*?\.login-actions--pair \.btn,[\s\S]*?\.login-actions--recovery \.btn\s*{[^}]*width:\s*100%;/s
		);
		expect(globalStyles).toMatch(/\.admin-status-tab\s*{[^}]*min-height:\s*var\(--hit\);/s);
		expect(globalStyles).toMatch(
			/\.admin-icon-button\s*{[^}]*width:\s*var\(--hit\);[^}]*height:\s*var\(--hit\);/s
		);
		expect(globalStyles).toMatch(/\.admin-ledger-wrap\s*{[^}]*overflow-x:\s*auto;/s);
		expect(globalStyles).toMatch(/\.admin-menu-ledger-wrap\s*{[^}]*overflow-x:\s*auto;/s);
		expect(globalStyles).toMatch(
			/\.admin-menu-field input:not\(\[type='file'\]\),[\s\S]*?min-height:\s*var\(--hit\);/s
		);
	});

	it('renders distinct shells and keeps the sticky cart tied to menu intent', () => {
		const publicMenu = render(PublicShell, { showCartBar: true });
		expect(publicMenu.container.querySelector('.public-shell')).not.toBeNull();
		expect(publicMenu.container.querySelector('[data-cart-bar]')).not.toBeNull();

		cleanup();
		const publicPage = render(PublicShell, { showCartBar: false });
		expect(publicPage.container.querySelector('.public-shell')).not.toBeNull();
		expect(publicPage.container.querySelector('[data-cart-bar]')).toBeNull();

		cleanup();
		const kusina = render(KusinaShell);
		expect(kusina.container.querySelector('.kusina-shell')).not.toBeNull();
		expect(kusina.container.querySelector('.theme-kusina')).not.toBeNull();
	});

	it('renders Button as a button or link and prevents disabled link activation', () => {
		const buttonView = render(Button, { ariaLabel: 'Magpatuloy' });
		const button = within(buttonView.container).getByRole('button', { name: 'Magpatuloy' });
		expect(button.getAttribute('type')).toBe('button');

		cleanup();
		const linkView = render(Button, { href: '/cart', ariaLabel: 'Buksan ang slip' });
		const link = within(linkView.container).getByRole('link', { name: 'Buksan ang slip' });
		expect(link.getAttribute('href')).toBe('/cart');

		cleanup();
		const disabledView = render(Button, {
			href: '/cart',
			disabled: true,
			ariaLabel: 'Buksan ang slip'
		});
		const disabledLink = within(disabledView.container).getByRole('link', {
			name: 'Buksan ang slip'
		});
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		disabledLink.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect(disabledLink.getAttribute('aria-disabled')).toBe('true');
		expect(disabledLink.getAttribute('tabindex')).toBe('-1');
	});

	it('renders and updates the ProductTray selected state', async () => {
		const { container, rerender } = render(ProductTray, {
			ariaLabel: 'Chicken adobo',
			selected: false
		});
		let tray = container.querySelector('[role="group"]') as HTMLElement;

		expect(tray.classList.contains('product-tray')).toBe(true);
		expect(tray.classList.contains('product-tray--selected')).toBe(false);
		expect(container.querySelector('.product-tray__floor')).not.toBeNull();

		await rerender({ selected: true });
		tray = container.querySelector('[role="group"]') as HTMLElement;
		expect(tray.classList.contains('product-tray--selected')).toBe(true);
	});

	it('exposes tab state through aria-pressed and reports the selected value', async () => {
		const onSelect = vi.fn();
		const { container, rerender } = render(Tabs, {
			label: 'Mga kategorya',
			options: [
				{ value: 'all', label: 'Lahat' },
				{ value: 'ulam', label: 'Ulam' },
				{ value: 'drinks', label: 'Inumin', disabled: true }
			],
			selected: 'all',
			onSelect
		});
		const tabs = within(container).getByRole('navigation', { name: 'Mga kategorya' });
		const buttons = within(tabs).getAllByRole('button');

		expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
		expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
		expect((buttons[2] as HTMLButtonElement).disabled).toBe(true);

		await fireEvent.click(buttons[1]);
		expect(onSelect).toHaveBeenCalledWith('ulam');

		await rerender({ selected: 'ulam' });
		expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
		expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
	});

	it('marks the current StorefrontBand navigation link and its landmarks', () => {
		const { container } = render(StorefrontBand, {
			navItems: [
				{ href: '/', label: 'Current' },
				{ href: '/not-current', label: 'Other' }
			],
			navLabel: 'Pangunahing nabigasyon'
		});
		const nav = within(container).getByRole('navigation', { name: 'Pangunahing nabigasyon' });
		const currentLink = within(nav).getByRole('link', { name: 'Current' });

		expect(currentLink.getAttribute('aria-current')).toBe('page');
		expect(
			within(nav).getByRole('link', { name: 'Other' }).getAttribute('aria-current')
		).toBeNull();
		expect(within(container).getByRole('link', { name: 'Kanto Turo-Turo' })).not.toBeNull();
	});

	it('uses semantic status and alert live regions and avoids duplicate empty-state IDs', () => {
		const statusView = render(StatusChip, { kind: 'order', status: 'Pending' });
		const status = statusView.container.querySelector('[role="status"]') as HTMLElement;
		expect(status).not.toBeNull();
		expect(status.getAttribute('aria-label')).toBeNull();
		expect(status.textContent).toContain('Tinanggap');
		expect(status.textContent).toContain('Status ng order');

		cleanup();
		const infoView = render(InlineAlert, { tone: 'info', title: 'Paalala' });
		const info = infoView.container.querySelector('.inline-alert') as HTMLElement;
		expect(info.getAttribute('role')).toBe('status');
		expect(info.getAttribute('aria-live')).toBe('polite');

		cleanup();
		const errorView = render(InlineAlert, { tone: 'error', title: 'May problema' });
		const error = errorView.container.querySelector('.inline-alert') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.getAttribute('aria-live')).toBe('assertive');

		cleanup();
		const first = render(EmptyState, { title: 'Unang estado' });
		const firstSection = first.container.querySelector('section') as HTMLElement;
		expect(firstSection.getAttribute('aria-label')).toBe('Unang estado');
		expect(firstSection.getAttribute('aria-labelledby')).toBeNull();
		expect(firstSection.querySelector('h2')?.id).toBe('');

		cleanup();
		const custom = render(EmptyState, { title: 'May label', titleId: 'custom-empty-title' });
		const customSection = custom.container.querySelector('section') as HTMLElement;
		expect(customSection.getAttribute('aria-labelledby')).toBe('custom-empty-title');
		expect(customSection.querySelector('h2')?.id).toBe('custom-empty-title');

		cleanup();
		const stepper = render(QuantityStepper, { label: 'Dami', quantity: 1 });
		const group = within(stepper.container).getByRole('group', { name: 'Dami' });
		expect(group.querySelector('output')?.getAttribute('aria-live')).toBe('polite');
		expect((within(group).getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(true);
	});

	it('repositions an active turo circle on resize and scroll, then cleans up listeners', () => {
		const host = document.createElement('div');
		const target = document.createElement('h3');
		host.append(target);
		document.body.append(host);
		let targetLeft = 10;
		vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
			() => ({ left: targetLeft, top: 20, width: 100, height: 30 }) as DOMRect
		);
		vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
			left: 0,
			top: 0,
			width: 200,
			height: 100
		} as DOMRect);

		const action = turo(host, { target, host, selected: true, variant: 0 });
		expect(host.querySelector('svg')?.getAttribute('style')).toContain('left: 3px');

		targetLeft = 24;
		window.dispatchEvent(new Event('resize'));
		expect(host.querySelector('svg')?.getAttribute('style')).toContain('left: 17px');

		targetLeft = 30;
		window.dispatchEvent(new Event('scroll'));
		expect(host.querySelector('svg')?.getAttribute('style')).toContain('left: 23px');

		action.destroy();
		targetLeft = 40;
		window.dispatchEvent(new Event('resize'));
		expect(host.querySelector('svg')).toBeNull();
	});

	it('paints both turo variants and keeps a picked circle visible', () => {
		const host = document.createElement('div');
		const target = document.createElement('h3');
		host.append(target);
		document.body.append(host);

		const action = turo(host, { target, host, variant: 0 });
		host.dispatchEvent(new Event('pointerenter'));
		expect(host.querySelector('path')?.getAttribute('d')).toContain('M14 30');

		action.update({ target, host, variant: 1, selected: true });
		expect(host.querySelector('path')?.getAttribute('d')).toContain('M88 26');
		host.dispatchEvent(new Event('pointerleave'));
		expect(host.querySelector('svg')).not.toBeNull();
		action.destroy();
		expect(host.querySelector('svg')).toBeNull();
	});

	it('reports copy feedback without replacing child DOM and updates a dedicated label safely', async () => {
		vi.useFakeTimers();
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText }
		});
		const button = document.createElement('button');
		const icon = document.createElement('span');
		icon.dataset.icon = 'copy';
		const label = document.createElement('span');
		label.textContent = 'Kopyahin ang link';
		button.setAttribute('aria-label', 'Kopyahin ang link');
		button.append(icon, label);
		document.body.append(button);
		const onResult = vi.fn();
		const action = copy(button, {
			value: 'opaque-signed-value',
			label,
			timeoutMs: 20,
			onResult
		});

		expect(button.getAttribute('aria-live')).toBe('polite');
		expect(button.getAttribute('aria-atomic')).toBe('true');
		button.click();
		await Promise.resolve();
		await Promise.resolve();
		expect(writeText).toHaveBeenCalledWith('opaque-signed-value');
		expect(button.dataset.copyState).toBe('copied');
		expect(label.textContent).toBe('Nakopya na');
		expect(button.getAttribute('aria-label')).toBe('Nakopya na');
		expect(button.contains(icon)).toBe(true);
		expect(button.textContent).not.toContain('opaque-signed-value');
		expect(onResult).toHaveBeenCalledWith(true);

		vi.advanceTimersByTime(20);
		expect(button.dataset.copyState).toBe('idle');
		expect(label.textContent).toBe('Kopyahin ang link');
		expect(button.getAttribute('aria-label')).toBe('Kopyahin ang link');

		action.update({
			value: 'new-opaque-value',
			label,
			idleLabel: 'Kopyahin ulit',
			copiedLabel: 'Na-copy',
			timeoutMs: 20
		});
		button.click();
		await Promise.resolve();
		await Promise.resolve();
		expect(writeText).toHaveBeenLastCalledWith('new-opaque-value');
		expect(label.textContent).toBe('Na-copy');
		expect(button.getAttribute('aria-label')).toBe('Na-copy');
		vi.advanceTimersByTime(20);
		expect(label.textContent).toBe('Kopyahin ulit');

		action.destroy();
		expect(button.contains(icon)).toBe(true);
		expect(button.getAttribute('aria-label')).toBe('Kopyahin ang link');
		expect(button.getAttribute('aria-live')).toBeNull();
		expect(button.getAttribute('aria-atomic')).toBeNull();
	});

	it('shows a safe failure label without exposing the copied value', async () => {
		const writeText = vi.fn().mockRejectedValue(new Error('Clipboard unavailable'));
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText }
		});
		const button = document.createElement('button');
		const label = document.createElement('span');
		label.textContent = 'Kopyahin ang link';
		button.append(label);
		document.body.append(button);
		const onResult = vi.fn();
		const action = copy(button, {
			value: 'opaque-signed-value',
			label,
			failedLabel: 'Hindi nakopya',
			onResult
		});

		button.click();
		await Promise.resolve();
		await Promise.resolve();
		expect(label.textContent).toBe('Hindi nakopya');
		expect(label.textContent).not.toContain('opaque-signed-value');
		expect(button.dataset.copyState).toBe('failed');
		expect(onResult).toHaveBeenCalledWith(false);
		action.destroy();
	});

	it('replays the slip bump only when its trigger changes', () => {
		vi.useFakeTimers();
		const node = document.createElement('div');
		document.body.append(node);
		const action = bump(node, 0);

		action.update(0);
		expect(node.classList.contains('is-bumping')).toBe(false);
		action.update(1);
		expect(node.classList.contains('is-bumping')).toBe(true);
		vi.advanceTimersByTime(400);
		expect(node.classList.contains('is-bumping')).toBe(false);
		action.destroy();
	});

	it('adds and removes the live reduced-motion gate classes', () => {
		const node = document.createElement('div');
		const action = motion(node);
		expect(node.classList.contains('motion-ok') || node.classList.contains('no-motion')).toBe(true);
		action.destroy();
		expect(node.classList.contains('motion-ok')).toBe(false);
		expect(node.classList.contains('no-motion')).toBe(false);
	});
});
