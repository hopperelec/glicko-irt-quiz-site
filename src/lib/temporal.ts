// sveltekit-temporal: managed block
// Conditionally load the Temporal polyfill when the runtime lacks native support.
// Native (Chrome 144+, Firefox 139+) keeps zero overhead — the dynamic import is
// code-split by Vite and only fetched on browsers that need it.

if (typeof globalThis.Temporal === "undefined") {
	const { Temporal, toTemporalInstant } = await import("temporal-polyfill");
	globalThis.Temporal = Temporal;
	Date.prototype.toTemporalInstant = toTemporalInstant;
}

export {};
