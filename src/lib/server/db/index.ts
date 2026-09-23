import { drizzle } from 'drizzle-orm/bun-sql/mysql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not defined');

export default drizzle(DATABASE_URL);
