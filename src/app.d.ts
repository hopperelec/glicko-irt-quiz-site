import type {auth} from "./lib/server/auth";

declare global {
	namespace App {
		interface Locals {
			user: typeof auth.$Infer.Session.user | null;
			session: typeof auth.$Infer.Session.session | null;
		}
	}
}

// sveltekit-temporal: managed block
import type { Temporal as TemporalNS } from "temporal-polyfill";

declare global {
	const Temporal: typeof TemporalNS;

	interface Date {
		toTemporalInstant(): TemporalNS.Instant;
	}
}
// end sveltekit-temporal managed block
