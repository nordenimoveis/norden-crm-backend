'use client';

import { useState } from 'react';
import { Plus, Loader2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCampanhas } from '@/hooks/use-campanhas';
import { CampanhaFormDialog } from './campanha-form-dialog';
import { CampanhaDetailDialog } from './campanha-detail-dialog';
import { ROTULO_STATUS_CAMPANHA, CampanhaDisparoStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const TOM_STATUS: Record<CampanhaDisparoStatus, string> = {
  rascunho: 'bg-muted text-muted-foreground',
  pronta: 'bg-accent/10 text-accent',
  enviando: 'bg-sky-100 text-sky-700',
  concluida: 'bg-online/10 text-online',
  cancelada: 'bg-red-50 text-red-700',
};

export function CampanhasList() {
  const { data: campanhas, isLoading } = useCampanhas();
  const [formAberto, setFormAberto] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Campanhas de disparo em massa via WhatsApp, usando templates aprovados pela Meta.
        </p>
        <Button variant="accent" size="sm" onClick={() => setFormAberto(true)}>
          <Plus className="h-4 w-4" />
          Nova campanha
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando campanhas...
        </div>
      ) : !campanhas || campanhas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Nenhuma campanha criada ainda.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {campanhas.map((campanha) => (
            <button
              key={campanha.id}
              onClick={() => setDetalheId(campanha.id)}
              className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{campanha.nome}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Template: {campanha.templateMensagem.nome} · criada por {campanha.criadoPor.nome}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {campanha._count.destinatarios}
                </span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                    TOM_STATUS[campanha.status]
                  )}
                >
                  {ROTULO_STATUS_CAMPANHA[campanha.status]}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <CampanhaFormDialog aberto={formAberto} onFechar={() => setFormAberto(false)} />
      <CampanhaDetailDialog campanhaId={detalheId} onFechar={() => setDetalheId(null)} />
    </div>
  );
}
