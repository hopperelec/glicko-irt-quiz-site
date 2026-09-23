import { defineConfig } from 'drizzle-kit';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not defined');

export default defineConfig({
    out: './drizzle',
    schema: './src/lib/server/db/schema.ts',
    dialect: 'mysql',
    dbCredentials: {
        url: DATABASE_URL,
    },
});
