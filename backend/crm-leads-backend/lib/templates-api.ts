import { apiFetch } from './api-client';
import { TemplateMensagem, MidiaTipo } from './types';

export type CriarTemplateInput = {
  nome: string;
  conteudo: string;
  metaTemplateName?: string;
  aprovadoMeta: boolean;
  midiaTipo?: MidiaTipo | null;
};

export type AtualizarTemplateInput = Partial<CriarTemplateInput>;

export async function listarTemplates(): Promise<TemplateMensagem[]> {
  return apiFetch<TemplateMensagem[]>('/api/templates-mensagem');
}

export async function criarTemplate(input: CriarTemplateInput): Promise<TemplateMensagem> {
  return apiFetch<TemplateMensagem>('/api/templates-mensagem', { method: 'POST', body: input });
}

export async function atualizarTemplate(id: string, input: AtualizarTemplateInput): Promise<TemplateMensagem> {
  return apiFetch<TemplateMensagem>(`/api/templates-mensagem/${id}`, { method: 'PATCH', body: input });
}
