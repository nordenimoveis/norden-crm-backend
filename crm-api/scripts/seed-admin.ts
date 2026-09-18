import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { closeDb, db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

/**
 * Cria o usuário DONO inicial.
 * Uso: SEED_NAME="..." SEED_EMAIL="..." SEED_PASSWORD="..." npm run seed:admin
 */
const name = process.env.SEED_NAME;
const email = process.env.SEED_EMAIL?.toLowerCase();
const password = process.env.SEED_PASSWORD;
if (!name || !email || !password || password.length < 10) {
  console.error('Defina SEED_NAME, SEED_EMAIL e SEED_PASSWORD (mínimo 10 caracteres).');
  process.exit(1);
}

const [existing] = await db.select().from(users).where(eq(users.email, email));
if (existing) {
  console.log(`Usuário ${email} já existe.`);
} else {
  await db.insert(users).values({
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'DONO',
    inRotation: false,
  });
  console.log(`Usuário DONO ${email} criado. Para ele receber leads na roleta, ative "inRotation".`);
}
await closeDb();
