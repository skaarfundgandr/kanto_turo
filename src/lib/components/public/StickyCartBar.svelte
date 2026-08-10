<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
</script>

<aside class="cart-bar" data-cart-bar aria-label="Order slip">
	<div class="page-frame cart-bar__inner">
		<div class="cart-bar__copy">
			<span class="cart-bar__label">order slip</span>
			<span class="cart-bar__note">Handa para sa iyong mga turo.</span>
		</div>
		<Button href="/cart" size="small" ariaLabel="Buksan ang order slip">Buksan ang slip</Button>
	</div>
</aside>
