import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { getRequestEvent } from "$app/server";
import db from "./db";
import * as schema from "./db/schema";
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL } from "$env/static/private";

export const auth = betterAuth({
    secret: BETTER_AUTH_SECRET,
    baseURL: BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
        provider: "mysql",
        schema: {
            ...schema
        }
    }),
    emailAndPassword: {
        enabled: true
    },
    plugins: [
        sveltekitCookies(getRequestEvent)
    ]
});