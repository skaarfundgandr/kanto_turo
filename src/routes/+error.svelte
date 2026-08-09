<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Kanto Turo-Turo — Error</title>
</svelte:head>

<h1>Error {page.status}</h1>
<p>{page.error?.message ?? 'Something went wrong.'}</p>
