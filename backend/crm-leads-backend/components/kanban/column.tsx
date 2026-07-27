'use client';

import { useDroppable } from '@dnd-kit/core';
import { Lead, LeadStatus } from '@/lib/types';
import { LeadCard } from './lead-card';
import { cn } from '@/lib/utils';

export type ColunaConfig = {
  status: LeadStatus;
  titulo: string;
  tom?: 'neutro'; // usado só na coluna Standby/Nutrição, pra não competir com as "quentes"
};

export function KanbanColumn({
  coluna,
  leads,
  onAbrirLead,
}: {
  coluna: ColunaConfig;
  leads: Lead[];
  onAbrirLead: (leadId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.status });

  return (
    <div className="flex w-[280px] shrink-0 flex-col">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className={cn('text-sm font-medium', coluna.tom === 'neutro' ? 'text-muted-foreground' : 'text-foreground')}>
          {coluna.titulo}
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {leads.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg p-2 transition-colors',
          isOver ? 'bg-accent/[0.06]' : coluna.tom === 'neutro' ? 'bg-muted/70' : 'bg-muted/40'
        )}
      >
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} onAbrir={onAbrirLead} />
        ))}

        {leads.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border/60 py-8 text-xs text-muted-foreground">
            Nenhum lead aqui
          </div>
        )}
      </div>
    </div>
  );
}
