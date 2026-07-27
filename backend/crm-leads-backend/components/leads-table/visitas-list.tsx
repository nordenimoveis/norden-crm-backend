'use client';

import { useRouter } from 'next/navigation';
import { Loader2, MapPin, User, Clock, Home, Users, Phone, MessageCircle, HelpCircle } from 'lucide-react';
import { useVisitasAgendadas } from '@/hooks/use-visitas-agendadas';
import { useAuthStore } from '@/store/auth-store';
import { Lead, TipoAgendamento, ROTULO_TIPO_AGENDAMENTO } from '@/lib/types';
import { cn } from '@/lib/utils';

const ICONE_TIPO: Record<TipoAgendamento, typeof Home> = {
  visita: Home,
  reuniao: Users,
  ligacao: Phone,
  whatsapp: MessageCircle,
  outro: HelpCircle,
};

function formatarDataHora(iso: string) {
  const data = new Date(iso);
  return {
    dia: data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
    hora: data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

function agruparPorUrgencia(agendamentos: Lead[]) {
  const agora = new Date();
  const hojeFim = new Date(agora);
  hojeFim.setHours(23, 59, 59, 999);
  const amanhaFim = new Date(hojeFim);
  amanhaFim.setDate(amanhaFim.getDate() + 1);
  const semanaFim = new Date(hojeFim);
  semanaFim.setDate(semanaFim.getDate() + 7);

  const grupos = {
    atrasados: [] as Lead[],
    hoje: [] as Lead[],
    amanha: [] as Lead[],
    semana: [] as Lead[],
    depois: [] as Lead[],
  };

  for (const lead of agendamentos) {
    if (!lead.dataAgendamento) continue;
    const data = new Date(lead.dataAgendamento);

    if (data < agora) grupos.atrasados.push(lead);
    else if (data <= hojeFim) grupos.hoje.push(lead);
    else if (data <= amanhaFim) grupos.amanha.push(lead);
    else if (data <= semanaFim) grupos.semana.push(lead);
    else grupos.depois.push(lead);
  }

  return grupos;
}

export function VisitasList() {
  const router = useRouter();
  const usuario = useAuthStore((state) => state.usuario);
  const ehGestorOuAdmin = usuario?.papel === 'gestor' || usuario?.papel === 'admin';
  const { data: agendamentos, isLoading } = useVisitasAgendadas();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando agenda...
      </div>
    );
  }

  if (!agendamentos || agendamentos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        Nenhum compromisso agendado ainda. Marque data/hora e tipo ao editar um lead (ícone de
        lápis no chat) para ele aparecer aqui — funciona para visita, reunião, ligação ou
        WhatsApp, independente da coluna do Kanban.
      </div>
    );
  }

  const grupos = agruparPorUrgencia(agendamentos);

  return (
    <div className="space-y-6">
      <GrupoAgendamentos
        titulo="Atrasados"
        itens={grupos.atrasados}
        tom="urgente"
        ehGestorOuAdmin={ehGestorOuAdmin}
        onAbrir={(id) => router.push(`/mensagens?leadId=${id}`)}
      />
      <GrupoAgendamentos
        titulo="Hoje"
        itens={grupos.hoje}
        tom="hoje"
        ehGestorOuAdmin={ehGestorOuAdmin}
        onAbrir={(id) => router.push(`/mensagens?leadId=${id}`)}
      />
      <GrupoAgendamentos
        titulo="Amanhã"
        itens={grupos.amanha}
        ehGestorOuAdmin={ehGestorOuAdmin}
        onAbrir={(id) => router.push(`/mensagens?leadId=${id}`)}
      />
      <GrupoAgendamentos
        titulo="Esta semana"
        itens={grupos.semana}
        ehGestorOuAdmin={ehGestorOuAdmin}
        onAbrir={(id) => router.push(`/mensagens?leadId=${id}`)}
      />
      <GrupoAgendamentos
        titulo="Mais adiante"
        itens={grupos.depois}
        ehGestorOuAdmin={ehGestorOuAdmin}
        onAbrir={(id) => router.push(`/mensagens?leadId=${id}`)}
      />
    </div>
  );
}

function GrupoAgendamentos({
  titulo,
  itens,
  tom,
  ehGestorOuAdmin,
  onAbrir,
}: {
  titulo: string;
  itens: Lead[];
  tom?: 'urgente' | 'hoje';
  ehGestorOuAdmin: boolean;
  onAbrir: (leadId: string) => void;
}) {
  if (itens.length === 0) return null;

  return (
    <div>
      <h2
        className={cn(
          'mb-2 text-sm font-medium',
          tom === 'urgente' ? 'text-red-700' : tom === 'hoje' ? 'text-accent' : 'text-foreground'
        )}
      >
        {titulo} ({itens.length})
      </h2>
      <div className="divide-y divide-border rounded-lg border border-border">
        {itens.map((lead) => {
          const { dia, hora } = formatarDataHora(lead.dataAgendamento!);
          const tipo = lead.tipoAgendamento ?? 'outro';
          const IconeTipo = ICONE_TIPO[tipo];

          return (
            <button
              key={lead.id}
              onClick={() => onAbrir(lead.id)}
              className="flex w-full items-center gap-4 p-3 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex w-20 shrink-0 flex-col items-center rounded-md bg-muted/50 py-1.5">
                <span className="text-[11px] uppercase text-muted-foreground">{dia}</span>
                <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                  <Clock className="h-3 w-3" />
                  {hora}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {lead.nome || lead.telefone}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <IconeTipo className="h-3 w-3" />
                    {ROTULO_TIPO_AGENDAMENTO[tipo]}
                  </span>
                  {lead.imovel?.bairro && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {lead.imovel.bairro}
                    </span>
                  )}
                  {ehGestorOuAdmin && lead.corretor && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {lead.corretor.nome}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
