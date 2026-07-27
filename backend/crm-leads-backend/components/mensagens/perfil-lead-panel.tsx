'use client';

import { useState } from 'react';
import { Phone, Pencil, MapPin, CalendarClock, Send, Loader2 } from 'lucide-react';
import { useLeadDetalhado } from '@/hooks/use-lead-detalhado';
import { useNotasInternas, useCriarNota } from '@/hooks/use-notas-internas';
import { useAtualizarStatusGenerico, useAtualizarTemperaturaGenerico, useAtualizarStatusIAGenerico } from '@/hooks/use-atualizar-status-temperatura';
import { useAuthStore } from '@/store/auth-store';
import { EditLeadDialog } from '@/components/chat/edit-lead-dialog';
import { OrigemBadge } from '@/components/kanban/origem-badge';
import { AlertaEstagnadoBadge } from '@/components/kanban/alerta-estagnado-badge';
import { TransferirCorretorSelect } from '@/components/leads-table/transferir-corretor-select';
import { InteligenciaNorden } from './inteligencia-norden';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROTULO_TIPO_AGENDAMENTO, ROTULO_STATUS, ROTULO_STATUS_IA, LeadStatus, LeadTemperatura, StatusIA } from '@/lib/types';

const ROTULO_TEMPERATURA: Record<LeadTemperatura, string> = {
  nao_avaliado: 'Não avaliado',
  frio: 'Frio',
  morno: 'Morno',
  quente: 'Quente',
};

function iniciais(nome: string) {
  return nome
    .split(' ')
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase();
}

function formatarDataHora(iso: string) {
  const data = new Date(iso);
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PerfilLeadPanel({ leadId }: { leadId: string }) {
  const { data: lead } = useLeadDetalhado(leadId);
  const usuario = useAuthStore((state) => state.usuario);
  const podeReatribuir = usuario?.papel === 'gestor' || usuario?.papel === 'admin';

  const { data: notas, isLoading: carregandoNotas } = useNotasInternas(leadId);
  const criarNota = useCriarNota(leadId);
  const [novaNota, setNovaNota] = useState('');

  const atualizarStatus = useAtualizarStatusGenerico();
  const atualizarTemperatura = useAtualizarTemperaturaGenerico();
  const atualizarStatusIA = useAtualizarStatusIAGenerico();

  const [editando, setEditando] = useState(false);

  if (!lead) return <div className="w-[320px] shrink-0 border-l border-border bg-card" />;

  const nomeExibicao = lead.nome || lead.telefone;

  async function enviarNota() {
    const texto = novaNota.trim();
    if (!texto) return;
    await criarNota.mutateAsync(texto);
    setNovaNota('');
  }

  return (
    <div className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
      <div className="flex flex-col items-center border-b border-border p-6">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-xl font-medium text-accent">
          {iniciais(nomeExibicao)}
        </div>
        <p className="text-base font-medium text-foreground">{nomeExibicao}</p>
        <p className="text-sm text-muted-foreground">{lead.telefone}</p>

        <div className="mt-4 flex w-full gap-2">
          <button
            onClick={() => setEditando(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-muted/30 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </button>
          <a
            href={`tel:${lead.telefone}`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-muted/30 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Phone className="h-3.5 w-3.5" />
            Ligar
          </a>
        </div>
      </div>

      <EditLeadDialog lead={lead} aberto={editando} onFechar={() => setEditando(false)} />

      <InteligenciaNorden lead={lead} />

      <div className="space-y-5 p-5">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Status
          </p>
          <Select
            value={lead.status}
            onValueChange={(v) =>
              atualizarStatus.mutate({ leadId: lead.id, status: v as LeadStatus })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ROTULO_STATUS).map(([valor, rotulo]) => (
                <SelectItem key={valor} value={valor}>
                  {rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="mb-2 mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Temperatura
          </p>
          <Select
            value={lead.temperatura}
            onValueChange={(v) =>
              atualizarTemperatura.mutate({ leadId: lead.id, temperatura: v as LeadTemperatura })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ROTULO_TEMPERATURA).map(([valor, rotulo]) => (
                <SelectItem key={valor} value={valor}>
                  {rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="mb-2 mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Atendimento por IA
          </p>
          <Select
            value={lead.statusIA}
            onValueChange={(v) =>
              atualizarStatusIA.mutate({ leadId: lead.id, statusIA: v as StatusIA })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ROTULO_STATUS_IA).map(([valor, rotulo]) => (
                <SelectItem key={valor} value={valor}>
                  {rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {lead.statusIA === 'ativa' && (
            <p className="mt-1.5 text-[10px] text-amber-700">
              🤖 A IA está respondendo esse lead automaticamente, sem revisão.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <OrigemBadge origem={lead.origem} />
          </div>
          {lead.alerta && (
            <div className="mt-1.5">
              <AlertaEstagnadoBadge alerta={lead.alerta} horasParado={lead.horasParado} />
            </div>
          )}
        </div>

        {podeReatribuir && (
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Corretor responsável
            </p>
            <TransferirCorretorSelect leadId={lead.id} corretorAtualId={lead.corretorId} />
          </div>
        )}

        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Contexto
          </p>
          <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-xs">
            {lead.imovel?.bairro && (
              <div className="flex items-center gap-2 text-foreground">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                {lead.imovel.bairro}
              </div>
            )}
            {lead.dataAgendamento && lead.tipoAgendamento && (
              <div className="flex items-center gap-2 text-foreground">
                <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                {ROTULO_TIPO_AGENDAMENTO[lead.tipoAgendamento]}:{' '}
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
            {!lead.imovel?.bairro && !lead.dataAgendamento && (
              <p className="text-muted-foreground">Nenhum dado de contexto ainda.</p>
            )}
          </div>
        </div>

        {/*
          Timeline de notas — cada nota é um registro imutável (autor + data),
          não um campo único que se sobrescreve. Fica visível o histórico de
          evolução do lead, só pra equipe interna (nunca sai pro WhatsApp).
        */}
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Notas internas
          </p>

          <div className="mb-3 flex items-end gap-2">
            <textarea
              value={novaNota}
              onChange={(e) => setNovaNota(e.target.value)}
              placeholder="Adicionar observação..."
              rows={2}
              className="flex-1 resize-none rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            />
            <button
              onClick={enviarNota}
              disabled={!novaNota.trim() || criarNota.isPending}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar text-sidebar-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              title="Adicionar nota"
            >
              {criarNota.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <p className="mb-2 text-[10px] text-muted-foreground">Visível só para a equipe.</p>

          <div className="space-y-3">
            {carregandoNotas ? (
              <p className="text-xs text-muted-foreground">Carregando...</p>
            ) : !notas || notas.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma nota registrada ainda.</p>
            ) : (
              notas.map((nota) => (
                <div key={nota.id} className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="whitespace-pre-wrap text-xs text-foreground">{nota.texto}</p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {nota.usuario.nome} · {formatarDataHora(nota.criadoEm)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
