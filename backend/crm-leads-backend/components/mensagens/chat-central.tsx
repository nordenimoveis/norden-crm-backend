'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Loader2, AlertCircle, MoreVertical } from 'lucide-react';
import { useLeadDetalhado } from '@/hooks/use-lead-detalhado';
import { useEnviarMensagem } from '@/hooks/use-enviar-mensagem';
import { useChatRealtime } from '@/hooks/use-chat-realtime';
import { useQuickReplies } from '@/hooks/use-quick-replies';
import { useAuthStore } from '@/store/auth-store';
import { useUiStore } from '@/store/ui-store';
import { substituirVariaveis } from '@/lib/template-variaveis';
import { MessageBubble } from '@/components/chat/message-bubble';
import { QuickReplyPopover } from '@/components/chat/quick-reply-popover';
import { QuickReply } from '@/lib/types';
import { cn } from '@/lib/utils';

export function ChatCentral({ leadId }: { leadId: string }) {
  const { data: lead, isLoading } = useLeadDetalhado(leadId);
  useChatRealtime(leadId);

  const usuario = useAuthStore((state) => state.usuario);
  const enviarMensagem = useEnviarMensagem(leadId, lead?.telefone ?? '');

  const [texto, setTexto] = useState('');
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mensagensFimRef = useRef<HTMLDivElement>(null);

  const gatilhoAtivo = texto.startsWith('/');
  const termoBusca = gatilhoAtivo ? texto.slice(1) : '';

  const { data: quickRepliesTodos } = useQuickReplies('', true);
  const quickRepliesFiltrados = useMemo(() => {
    if (!quickRepliesTodos) return [];
    if (!termoBusca) return quickRepliesTodos;
    const termo = termoBusca.toLowerCase();
    return quickRepliesTodos.filter((qr) => qr.titulo.toLowerCase().includes(termo));
  }, [quickRepliesTodos, termoBusca]);

  useEffect(() => {
    mensagensFimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lead?.mensagens.length]);

  useEffect(() => {
    setIndiceAtivo(0);
  }, [termoBusca]);

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
      <div className="flex flex-1 items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{lead.nome || lead.telefone}</p>
          <p className="text-xs text-muted-foreground">{lead.telefone}</p>
        </div>
        <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      {lead.status === 'respondeu' && lead.atendimentoHumano && (
        <div className="flex items-center gap-1.5 border-b border-red-100 bg-red-50 px-5 py-2 text-xs font-medium text-red-700">
          <AlertCircle className="h-3.5 w-3.5" />
          O lead respondeu — cadência automática pausada. Atendimento manual necessário.
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto px-6 py-4">
        {lead.mensagens.length === 0 && (
          <p className="pt-8 text-center text-xs text-muted-foreground">Nenhuma mensagem ainda.</p>
        )}
        {lead.mensagens.map((mensagem) => (
          <MessageBubble key={mensagem.id} mensagem={mensagem} />
        ))}
        <div ref={mensagensFimRef} />
      </div>

      <div className="relative border-t border-border bg-card p-4">
        {gatilhoAtivo && (
          <QuickReplyPopover
            itens={quickRepliesFiltrados}
            indiceAtivo={indiceAtivo}
            onSelecionar={selecionarQuickReply}
          />
        )}

        <div className="flex items-end gap-2 rounded-xl border border-border bg-background p-2 transition-shadow focus-within:ring-2 focus-within:ring-accent/40">
          <textarea
            ref={textareaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={aoTeclar}
            rows={1}
            placeholder="Digite uma mensagem, ou / para usar um script..."
            className={cn(
              'max-h-32 flex-1 resize-none border-none bg-transparent px-2 py-2 text-sm',
              'placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0'
            )}
          />
          <button
            onClick={enviar}
            disabled={!texto.trim() || enviarMensagem.isPending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar text-sidebar-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
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
