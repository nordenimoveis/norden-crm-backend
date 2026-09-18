import { env } from '../config.js';
import { toE164 } from '../lib/phone.js';

/**
 * Cliente da API do Chatwoot (Application API).
 * IMPORTANTE: tokens do Chatwoot só circulam aqui no back-end. O navegador nunca os recebe.
 *
 * Os formatos abaixo seguem a API v1 do Chatwoot 4.x. Ao atualizar o Chatwoot,
 * rode o roteiro de validação do README (seção "Testes de integração").
 */

export class ChatwootError extends Error {
  constructor(
    public status: number,
    public body: string,
    path: string,
  ) {
    super(`Chatwoot ${status} em ${path}: ${body.slice(0, 300)}`);
  }
}

export interface ChatwootMessage {
  id: number;
  content: string | null;
  message_type: number | string; // 0 incoming, 1 outgoing, 2 activity, 3 template
  private: boolean;
  created_at: number;
  sender?: { id: number; name?: string; type?: string } | null;
  attachments?: Array<{ id: number; file_type: string; data_url: string; thumb_url?: string }>;
  status?: string;
}

export interface TemplateSend {
  name: string;
  /** Valores das variáveis do template, na ordem {{1}}, {{2}}... */
  params: string[];
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export class ChatwootClient {
  private base: string;
  private accountId: number;
  private inboxId: number;
  private adminToken: string;

  constructor(opts?: { baseUrl?: string; accountId?: number; inboxId?: number; adminToken?: string }) {
    const e = env();
    this.base = (opts?.baseUrl ?? e.CHATWOOT_BASE_URL).replace(/\/$/, '');
    this.accountId = opts?.accountId ?? e.CHATWOOT_ACCOUNT_ID;
    this.inboxId = opts?.inboxId ?? e.CHATWOOT_INBOX_ID;
    this.adminToken = opts?.adminToken ?? e.CHATWOOT_ADMIN_TOKEN;
  }

  private async request<T>(method: Method, path: string, body?: unknown, token?: string): Promise<T> {
    const url = `${this.base}/api/v1/accounts/${this.accountId}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        api_access_token: token ?? this.adminToken,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new ChatwootError(res.status, text, path);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /* ---------------- Contatos e conversas ---------------- */

  async searchContactByPhone(phone: string): Promise<{ id: number } | null> {
    const q = encodeURIComponent(toE164(phone));
    const res = await this.request<{ payload: Array<{ id: number; phone_number: string | null }> }>(
      'GET',
      `/contacts/search?q=${q}`,
    );
    return res.payload.find((c) => c.phone_number === toE164(phone)) ?? null;
  }

  async createContact(input: { name: string; phone: string; email?: string | null }): Promise<{ id: number }> {
    const res = await this.request<{ payload: { contact: { id: number } } }>('POST', '/contacts', {
      inbox_id: this.inboxId,
      name: input.name,
      phone_number: toE164(input.phone),
      email: input.email || undefined,
    });
    return { id: res.payload.contact.id };
  }

  async findOrCreateContact(input: { name: string; phone: string; email?: string | null }): Promise<{ id: number }> {
    const existing = await this.searchContactByPhone(input.phone);
    if (existing) return existing;
    try {
      return await this.createContact(input);
    } catch (err) {
      // Corrida: outro processo criou o contato entre a busca e a criação
      if (err instanceof ChatwootError && err.status === 422) {
        const again = await this.searchContactByPhone(input.phone);
        if (again) return again;
      }
      throw err;
    }
  }

  /**
   * Cria uma conversa na caixa do WhatsApp. No canal WhatsApp o source_id é o telefone só com dígitos.
   * A atribuição é feita aqui para o Chatwoot já registrar o corretor responsável.
   */
  async createConversation(input: { contactId: number; phone: string; assigneeId?: number | null }): Promise<{ id: number }> {
    const res = await this.request<{ id: number }>('POST', '/conversations', {
      inbox_id: this.inboxId,
      contact_id: input.contactId,
      source_id: input.phone,
      assignee_id: input.assigneeId ?? undefined,
      status: 'open',
    });
    return { id: res.id };
  }

  async assign(conversationId: number, agentId: number): Promise<void> {
    await this.request('POST', `/conversations/${conversationId}/assignments`, { assignee_id: agentId });
  }

  /** Acrescenta etiquetas sem apagar as existentes (a API do Chatwoot substitui a lista inteira). */
  async addLabels(conversationId: number, labels: string[]): Promise<void> {
    const current = await this.request<{ payload: string[] }>('GET', `/conversations/${conversationId}/labels`);
    const merged = Array.from(new Set([...current.payload, ...labels]));
    await this.request('POST', `/conversations/${conversationId}/labels`, { labels: merged });
  }

  async removeLabels(conversationId: number, labels: string[]): Promise<void> {
    const current = await this.request<{ payload: string[] }>('GET', `/conversations/${conversationId}/labels`);
    const kept = current.payload.filter((l) => !labels.includes(l));
    await this.request('POST', `/conversations/${conversationId}/labels`, { labels: kept });
  }

  /* ---------------- Mensagens ---------------- */

  async listMessages(conversationId: number, opts: { before?: number; token?: string } = {}): Promise<ChatwootMessage[]> {
    const qs = opts.before ? `?before=${opts.before}` : '';
    const res = await this.request<{ payload: ChatwootMessage[] }>(
      'GET',
      `/conversations/${conversationId}/messages${qs}`,
      undefined,
      opts.token,
    );
    return res.payload;
  }

  async sendText(conversationId: number, content: string, opts: { token?: string; private?: boolean } = {}): Promise<ChatwootMessage> {
    return this.request<ChatwootMessage>(
      'POST',
      `/conversations/${conversationId}/messages`,
      { content, message_type: 'outgoing', private: opts.private ?? false },
      opts.token,
    );
  }

  /**
   * Envia um template aprovado pela Meta.
   * Usa o formato de parâmetros numerados ({"1": "...", "2": "..."}), aceito pelo Chatwoot 4.x.
   * `previewText` é o texto que aparece no histórico do Chatwoot.
   */
  async sendTemplate(conversationId: number, tpl: TemplateSend, previewText: string, token?: string): Promise<ChatwootMessage> {
    const e = env();
    const processed: Record<string, string> = {};
    tpl.params.forEach((v, i) => (processed[String(i + 1)] = v));
    return this.request<ChatwootMessage>(
      'POST',
      `/conversations/${conversationId}/messages`,
      {
        content: previewText,
        message_type: 'outgoing',
        template_params: {
          name: tpl.name,
          category: e.TEMPLATE_CATEGORY,
          language: e.TEMPLATE_LANGUAGE,
          processed_params: processed,
        },
      },
      token,
    );
  }
}

let singleton: ChatwootClient | undefined;
export function chatwoot(): ChatwootClient {
  if (!singleton) singleton = new ChatwootClient();
  return singleton;
}

/** Etiquetas usadas no Chatwoot (crie-as em Configurações > Etiquetas). */
export const LABELS = {
  atendimentoHumano: 'atendimento-humano',
  baseAntiga: 'base-antiga',
  leadFrio: 'lead-frio',
} as const;
