import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { products, type Product } from '../db/schema.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';

export function listProducts(): Promise<Product[]> {
  return db.select().from(products).orderBy(asc(products.position), asc(products.createdAt));
}

/** Nomes + apelidos dos produtos ATIVOS, para reconhecer o produto no WhatsApp. */
export async function knownProductNames(): Promise<string[]> {
  const rows = await db.select().from(products).where(eq(products.active, true));
  const names = new Set<string>();
  for (const p of rows) {
    if (p.name.trim()) names.add(p.name.trim());
    for (const a of p.aliases) if (a.trim()) names.add(a.trim());
  }
  return [...names];
}

function cleanAliases(aliases?: string[] | null): string[] {
  return Array.from(new Set((aliases ?? []).map((a) => a.trim()).filter(Boolean))).slice(0, 20);
}

export async function createProduct(input: { name: string; aliases?: string[] }): Promise<Product> {
  const name = input.name.trim();
  if (!name) throw badRequest('Informe o nome do empreendimento');
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${products.position}), 0)` }).from(products);
  try {
    const [row] = await db
      .insert(products)
      .values({ name, aliases: cleanAliases(input.aliases), position: Number(max) + 1 })
      .returning();
    return row!;
  } catch (err) {
    // unique(name)
    if (String(err).includes('duplicate') || String(err).includes('unique')) {
      throw new HttpError(409, 'Já existe um empreendimento com esse nome.');
    }
    throw err;
  }
}

export async function updateProduct(
  id: string,
  patch: { name?: string; aliases?: string[]; active?: boolean },
): Promise<Product> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw badRequest('Informe o nome do empreendimento');
    set.name = name;
  }
  if (patch.aliases !== undefined) set.aliases = cleanAliases(patch.aliases);
  if (patch.active !== undefined) set.active = patch.active;
  if (Object.keys(set).length === 1) throw badRequest('Nada para atualizar');

  try {
    const [row] = await db.update(products).set(set).where(eq(products.id, id)).returning();
    if (!row) throw notFound('Empreendimento');
    return row;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (String(err).includes('duplicate') || String(err).includes('unique')) {
      throw new HttpError(409, 'Já existe um empreendimento com esse nome.');
    }
    throw err;
  }
}

export async function deleteProduct(id: string): Promise<void> {
  const deleted = await db.delete(products).where(eq(products.id, id)).returning();
  if (deleted.length === 0) throw notFound('Empreendimento');
}
