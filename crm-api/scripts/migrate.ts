import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** Aplica as migrações da pasta drizzle/. Executado automaticamente ao subir o contêiner. */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida');

const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
await client.end();
console.log('Migrações aplicadas.');
