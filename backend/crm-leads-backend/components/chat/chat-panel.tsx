'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, X, Loader2, AlertCircle, MapPin, Flame, Thermometer, Snowflake, Pencil } from 'lucide-react';
import { useLeadDetalhado } from '@/hooks/use-lead-detalhado';
import { useEnviarMensagem } from '@/hooks/use-enviar-mensagem';
import { useChatRealtime } from '@/hooks/use-chat-realtime';
import { useQuickReplies } from '@/hooks/use-quick-replies';
import { useAuthStore } from '@/store/auth-store';
import { useUiStore } from '@/store/ui-store';
import { substituirVariaveis } from '@/lib/template-variaveis';
import { MessageBubble } from './message-bubble';
import { QuickReplyPopover } from './quick-reply-popover';
import { EditLeadDialog } from './edit-lead-dialog';
import { OrigemBadge } from '@/components/kanban/origem-badge';
import { TransferirCorretorSelect } from '@/components/leads-table/transferir-corretor-select';
import { QuickReply } from '@/lib/types';
import { cn } from '@/lib/utils';

const iconeTemperatura = { frio: Snowflake, morno: Thermometer, quente: Flame } as const;

export function ChatPanel({ leadId, onFechar }: { leadId: string; onFechar: () => void }) {
  const { data: lead, isLoading } = useLeadDetalhado(leadId);
  useChatRealtime(leadId);

  const usuario = useAuthStore((state) => state.usuario);
  const enviarMensagem = useEnviarMensagem(leadId, lead?.telefone ?? '');

  const [texto, setTexto] = useState('');
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const [editandoLead, setEditandoLead] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mensagensFimRef = useRef<HTMLDivElement>(null);

  const gatilhoAtivo = texto.startsWith('/');
  const termoBusca = gatilhoAtivo ? texto.slice(1) : '';

  // Busca a lista completa uma vez (busca vazia) e filtra localmente —
  // evita um request por tecla digitada, já que a lista tende a ser curta.
  const { data: quickRepliesTodos } = useQuickReplies('', true);
  const quickRepliesFiltrados = useMemo(() => {
    if (!quickRepliesTodos) return [];
    if (!termoBusca) return quickRepliesTodos;
    const termo = termoBusca.toLowerCase();
    return quickRepliesTodos.filter((qr) => qr.titulo.toLowerCase().includes(termo));
  }, [quickRepliesTodos, termoBusca]);

  // Auto-scroll: sempre que o número de mensagens mudar (enviada, recebida,
  // ou reconciliação do envio otimista), rola pro final da conversa.
  useEffect(() => {
    mensagensFimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lead?.mensagens.length]);

  useEffect(() => {
    setIndiceAtivo(0);
  }, [termoBusca]);

  // Consome a mensagem sugerida pelo board (ex: pedido de avaliação Google
  // ao fechar negócio), se houver uma pendente pra ESTE lead especificamente.
  // "Consumir" = usar e limpar — não deve reaparecer se o corretor fechar e
  // reabrir o chat depois.
  const mensagemSugerida = useUiStore((state) => state.mensagemSugerida);
  const definirMensagemSugerida = useUiStore((state) => state.definirMensagemSugerida);

  useEffect(() => {
    if (mensagemSugerida && mensagemSugerida.leadId === leadId) {
      setTexto(mensagemSugerida.texto);
      definirMensagemSugerida(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  function selecionarQuickReply(item: QuickReply) {
    const textoSubstituido = substituirVariaveis(item.textoMensagem, {
      lead_name: lead?.nome ?? undefined,
      broker_name: usuario?.nome ?? undefined,
    });
    setTexto(textoSubstituido);
    textareaRef.current?.focus();
  }

  function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || enviarMensagem.isPending) return;

    enviarMensagem.mutate(conteudo);
    setTexto('');
  }

  function aoTeclar(evento: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (gatilhoAtivo && quickRepliesFiltrados.length > 0) {
      if (evento.key === 'ArrowDown') {
        evento.preventDefault();
        setIndiceAtivo((i) => (i + 1) % quickRepliesFiltrados.length);
        return;
      }
      if (evento.key === 'ArrowUp') {
        evento.preventDefault();
        setIndiceAtivo((i) => (i - 1 + quickRepliesFiltrados.length) % quickRepliesFiltrados.length);
        return;
      }
      if (evento.key === 'Enter') {
        evento.preventDefault();
        selecionarQuickReply(quickRepliesFiltrados[indiceAtivo]);
        return;
      }
      if (evento.key === 'Escape') {
        evento.preventDefault();
        setTexto('');
        return;
      }
    }

    if (evento.key === 'Enter' && !evento.shiftKey && !gatilhoAtivo) {
      evento.preventDefault();
      enviar();
    }
  }

  if (isLoading || !lead) {
    return (
      <div className="flex w-[380px] shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const IconeTemp = lead.temperatura !== 'nao_avaliado' ? iconeTemperatura[lead.temperatura] : null;
  const podeReatribuir = usuario?.papel === 'gestor' || usuario?.papel === 'admin';

  return (
    <div className="flex w-[380px] shrink-0 flex-col rounded-lg border border-border bg-card shadow-sm">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-foreground">{lead.nome || lead.telefone}</p>
            <button
              onClick={() => setEditandoLead(true)}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Editar dados do lead"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{lead.telefone}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <OrigemBadge origem={lead.origem} />
            {IconeTemp && <IconeTemp className="h-3.5 w-3.5 text-muted-foreground" />}
            {lead.imovel?.bairro && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {lead.imovel.bairro}
              </span>
            )}
          </div>
          {podeReatribuir && (
            <div className="mt-2">
              <TransferirCorretorSelect leadId={lead.id} corretorAtualId={lead.corretorId} />
            </div>
          )}
        </div>
        <button
          onClick={onFechar}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <EditLeadDialog lead={lead} aberto={editandoLead} onFechar={() => setEditandoLead(false)} />

      {/* Alerta de transbordo (Regra da Fase 4) — reflete em tempo real via Pusher */}
      {lead.status === 'respondeu' && lead.atendimentoHumano && (
        <div className="flex items-center gap-1.5 border-b border-red-100 bg-red-50 px-4 py-2 text-xs font-medium text-red-700">
          <AlertCircle className="h-3.5 w-3.5" />
          O lead respondeu — cadência automática pausada. Atendimento manual necessário.
        </div>
      )}

      {/* Histórico de mensagens */}
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {lead.mensagens.length === 0 && (
          <p className="pt-8 text-center text-xs text-muted-foreground">
            Nenhuma mensagem ainda.
          </p>
        )}
        {lead.mensagens.map((mensagem) => (
          <MessageBubble key={mensagem.id} mensagem={mensagem} />
        ))}
        <div ref={mensagensFimRef} />
      </div>

      {/* Input + gatilho de Quick Replies */}
      <div className="relative border-t border-border p-3">
        {gatilhoAtivo && (
          <QuickReplyPopover
            itens={quickRepliesFiltrados}
            indiceAtivo={indiceAtivo}
            onSelecionar={selecionarQuickReply}
          />
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={aoTeclar}
            rows={1}
            placeholder="Digite uma mensagem, ou / para usar um script..."
            className={cn(
              'max-h-32 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm',
              'placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          />
          <button
            onClick={enviar}
            disabled={!texto.trim() || enviarMensagem.isPending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sidebar text-sidebar-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {enviarMensagem.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
