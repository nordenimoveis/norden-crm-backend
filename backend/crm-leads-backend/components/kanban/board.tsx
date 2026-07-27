'use client';

import { useMemo, useState } from 'react';
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { UserPlus } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { useLeadsDoBoard } from '@/hooks/use-leads';
import { useAtualizarStatusLead } from '@/hooks/use-atualizar-status-lead';
import { usePusherKanban } from '@/hooks/use-pusher-kanban';
import { useQuickReplies } from '@/hooks/use-quick-replies';
import { Lead, LeadStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { KanbanColumn, ColunaConfig } from './column';
import { LeadCard } from './lead-card';
import { FiltroCorretor } from './corretor-filter';
import { NovoLeadDialog } from '@/components/leads-table/novo-lead-dialog';
import { AvaliacaoGoogleDialog } from './avaliacao-google-dialog';

const COLUNAS: ColunaConfig[] = [
  { status: 'novo', titulo: 'Novo Lead' },
  { status: 'respondeu', titulo: 'Aguardando Resposta' },
  { status: 'em_atendimento', titulo: 'Em Atendimento' },
  { status: 'visita_agendada', titulo: 'Visita Agendada' },
  { status: 'proposta', titulo: 'Proposta' },
  { status: 'negocio_fechado', titulo: 'Negócio Fechado' },
  // Standby/Nutrição: cadência terminou sem resposta, mas no alto padrão isso
  // NÃO é "Perdido" — é um ciclo de decisão mais longo. Fica antes de Perdido
  // de propósito, com tom neutro/acinzentado para não competir visualmente
  // com as colunas "quentes" (Em Atendimento/Proposta).
  { status: 'frio_standby', titulo: 'Standby / Nutrição', tom: 'neutro' },
  { status: 'perdido', titulo: 'Perdido' },
];

export function KanbanBoard({ onAbrirLead }: { onAbrirLead: (leadId: string) => void }) {
  const usuario = useAuthStore((state) => state.usuario);
  const ehGestorOuAdmin = usuario?.papel === 'gestor' || usuario?.papel === 'admin';

  const [corretorId, setCorretorId] = useState<string | undefined>(undefined);
  const [novoLeadAberto, setNovoLeadAberto] = useState(false);
  const [leadFechado, setLeadFechado] = useState<{ id: string; nome: string | null } | null>(null);
  const [leadArrastandoId, setLeadArrastandoId] = useState<string | null>(null);
  const filtros = { corretorId };

  const { data, isLoading } = useLeadsDoBoard(filtros);
  const { mutate: moverLead } = useAtualizarStatusLead(filtros);
  usePusherKanban();

  // Busca leve, reaproveitada do chat — usada só pra achar o script marcado
  // como "pedido de avaliação Google", se algum existir.
  const { data: quickReplies } = useQuickReplies('', true);
  const quickReplyAvaliacao = quickReplies?.find((qr) => qr.paraAvaliacaoGoogle) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Distância mínima antes de considerar "arrastar" — abaixo disso, o
      // gesto é tratado como clique normal (abre o lead, não move o card).
      activationConstraint: { distance: 8 },
    })
  );

  const leadsPorColuna = useMemo(() => {
    const mapa = new Map<LeadStatus, Lead[]>(COLUNAS.map((c) => [c.status, []]));

    for (const lead of data?.items ?? []) {
      mapa.get(lead.status)?.push(lead);
    }

    return mapa;
  }, [data]);

  function aoIniciarDrag(evento: DragStartEvent) {
    setLeadArrastandoId(evento.active.id as string);
  }

  function aoTerminarDrag(evento: DragEndEvent) {
    setLeadArrastandoId(null);

    const { active, over } = evento;
    if (!over) return;

    const leadId = active.id as string;
    const novoStatus = over.id as LeadStatus;
    const statusAtual = (active.data.current?.status as LeadStatus) ?? undefined;

    if (novoStatus === statusAtual) return; // soltou na mesma coluna, não faz nada

    moverLead({ leadId, novoStatus });

    // Sugestão de avaliação Google — só dispara se realmente existir um
    // script marcado para isso (senão o dialog nem chega a aparecer).
    if (novoStatus === 'negocio_fechado' && quickReplyAvaliacao) {
      const lead = data?.items.find((l) => l.id === leadId);
      setLeadFechado({ id: leadId, nome: lead?.nome ?? null });
    }
  }

  const leadArrastando = leadArrastandoId
    ? (data?.items.find((l) => l.id === leadArrastandoId) ?? null)
    : null;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        {ehGestorOuAdmin ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Filtrar por corretor:</span>
            <FiltroCorretor valor={corretorId} onMudar={setCorretorId} />
          </div>
        ) : (
          <div />
        )}

        <Button variant="accent" size="sm" onClick={() => setNovoLeadAberto(true)}>
          <UserPlus className="h-4 w-4" />
          Novo Lead
        </Button>
      </div>

      <NovoLeadDialog aberto={novoLeadAberto} onFechar={() => setNovoLeadAberto(false)} />

      <AvaliacaoGoogleDialog
        leadId={leadFechado?.id ?? null}
        leadNome={leadFechado?.nome ?? null}
        textoTemplate={quickReplyAvaliacao?.textoMensagem ?? null}
        onFechar={() => setLeadFechado(null)}
      />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Carregando leads...
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={aoIniciarDrag} onDragEnd={aoTerminarDrag}>
          <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
            {COLUNAS.map((coluna) => (
              <KanbanColumn
                key={coluna.status}
                coluna={coluna}
                leads={leadsPorColuna.get(coluna.status) ?? []}
                onAbrirLead={onAbrirLead}
              />
            ))}
          </div>

          {/*
            DragOverlay renderiza o card arrastado FORA do fluxo normal do
            DOM (num portal), então ele flutua por cima de tudo — inclusive
            das colunas com scroll, que antes "cortavam" o card no meio do
            arrasto por causa do overflow-y-auto delas.
          */}
          <DragOverlay>
            {leadArrastando ? (
              <div className="rotate-2 opacity-90">
                <LeadCard lead={leadArrastando} onAbrir={() => {}} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
