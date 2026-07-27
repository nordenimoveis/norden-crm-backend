'use client';

import { useDraggable } from '@dnd-kit/core';
import { MapPin, AlertCircle, Home, Users, Phone, MessageCircle, HelpCircle } from 'lucide-react';
import { Lead, TipoAgendamento, ROTULO_TIPO_AGENDAMENTO } from '@/lib/types';
import { OrigemBadge } from './origem-badge';
import { TemperaturaBadge } from './temperatura-badge';
import { AlertaEstagnadoBadge } from './alerta-estagnado-badge';
import { cn } from '@/lib/utils';

const ICONE_TIPO: Record<TipoAgendamento, typeof Home> = {
  visita: Home,
  reuniao: Users,
  ligacao: Phone,
  whatsapp: MessageCircle,
  outro: HelpCircle,
};

function iniciais(nome: string) {
  return nome
    .split(' ')
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase();
}

export function LeadCard({ lead, onAbrir }: { lead: Lead; onAbrir: (leadId: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    data: { status: lead.status },
  });

  const nomeExibicao = lead.nome || lead.telefone;
  const respondeuRecentemente = lead.status === 'respondeu' && lead.atendimentoHumano;
  const tipoAgendamento = lead.tipoAgendamento ?? 'outro';
  const IconeAgendamento = ICONE_TIPO[tipoAgendamento];

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onAbrir(lead.id)}
      className={cn(
        'group cursor-pointer rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md',
        isDragging && 'opacity-40'
      )}
    >
      {lead.alerta === 'aguardando_resposta' ? (
        <div className="mb-2">
          <AlertaEstagnadoBadge alerta={lead.alerta} horasParado={lead.horasParado} />
        </div>
      ) : respondeuRecentemente ? (
        <div className="mb-2 flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700">
          <AlertCircle className="h-3 w-3" />
          Aguardando Resposta
        </div>
      ) : lead.alerta === 'sem_atividade' ? (
        <div className="mb-2">
          <AlertaEstagnadoBadge alerta={lead.alerta} horasParado={lead.horasParado} />
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-medium text-accent">
            {iniciais(nomeExibicao)}
          </div>
          <p className="truncate text-sm font-medium text-foreground">{nomeExibicao}</p>
          {lead.statusIA === 'ativa' && (
            <span
              className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px]"
              title="IA respondendo automaticamente, sem revisão"
            >
              🤖
            </span>
          )}
        </div>
      </div>

      {lead.imovel?.bairro && (
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {lead.imovel.bairro}
        </div>
      )}

      {/*
        Compromisso agendado (visita, reunião, ligação, WhatsApp...) —
        independente do status do Kanban, então aparece em QUALQUER coluna
        se o lead tiver uma data marcada.
      */}
      {lead.dataAgendamento && (
        <div className="mt-2 flex items-center gap-1 text-xs font-medium text-accent">
          <IconeAgendamento className="h-3 w-3" />
          {ROTULO_TIPO_AGENDAMENTO[tipoAgendamento]}:{' '}
          {new Date(lead.dataAgendamento).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
          })}{' '}
          às{' '}
          {new Date(lead.dataAgendamento).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <OrigemBadge origem={lead.origem} />
        <TemperaturaBadge temperatura={lead.temperatura} />
      </div>
    </div>
  );
}
