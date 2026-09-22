// sveltekit-temporal: managed block
import type { Temporal as TemporalNS } from "temporal-polyfill";

declare global {
	const Temporal: typeof TemporalNS;

	interface Date {
		toTemporalInstant(): TemporalNS.Instant;
	}
}
// end sveltekit-temporal managed block
