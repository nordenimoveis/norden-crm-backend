import { z } from 'zod';

/**
 * Estrutura real de telefone do Imobzi (`PhoneSchema` no OpenAPI deles) —
 * vem como objeto ({ number, country_code, type, ... }), não como string simples.
 */
export const imobziPhoneSchema = z.object({
  type: z.string().nullable().optional(),
  number: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(),
});

/**
 * Contato/Lead do Imobzi — schema `ContactFieldsSchema` / `PersonsFieldsSchema`
 * do OpenAPI oficial deles (confirmado a partir do arquivo enviado). É o
 * mesmo formato tanto no payload do webhook (`lead_created`) quanto nos itens
 * retornados por `GET /v1/contacts`. Mantemos aqui só os campos que usamos.
 */
export const imobziContatoSchema = z.object({
  db_id: z.union([z.string(), z.number()]),
  name: z.string().nullable().optional(),
  fullname: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  cellphone: imobziPhoneSchema.nullable().optional(),
  contact_type: z.string().nullable().optional(),
  media_source: z.string().nullable().optional(),
});

export type ImobziContato = z.infer<typeof imobziContatoSchema>;

/**
 * Resposta de GET /v1/contacts (schema `ResponseContact` do OpenAPI):
 * paginação por CURSOR (não por número de página).
 */
export const imobziListaContatosSchema = z.object({
  contacts: z.array(imobziContatoSchema).default([]),
  cursor: z.string().nullable().optional(),
});

/**
 * Monta um telefone em formato E.164-like a partir do objeto `cellphone` do
 * Imobzi. Sem `country_code` explícito, assume Brasil (+55) — ajuste se a
 * imobiliária também atender leads de fora do país.
 */
export function extrairTelefone(contato: ImobziContato): string | null {
  const numero = contato.cellphone?.number?.replace(/\D/g, '');
  if (!numero) return null;

  const ddi = contato.cellphone?.country_code?.replace(/\D/g, '') || '55';
  return `+${ddi}${numero}`;
}

/** Traduz o contato do Imobzi para o formato normalizado que o LeadsService espera. */
export function paraLeadNormalizado(contato: ImobziContato) {
  const telefone = extrairTelefone(contato);
  return {
    imobziId: String(contato.db_id),
    nome: contato.fullname ?? contato.name ?? undefined,
    telefone,
    email: contato.email ?? undefined,
  };
}
