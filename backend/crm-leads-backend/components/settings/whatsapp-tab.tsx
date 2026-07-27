'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLimiteDiario, useAtualizarLimiteDiario, useStatusIntegracoes } from '@/hooks/use-sistema';
import { cn } from '@/lib/utils';

export function WhatsappTab() {
  const { data: limiteAtual, isLoading: carregandoLimite } = useLimiteDiario();
  const { mutate: salvarLimite, isPending: salvando, isSuccess } = useAtualizarLimiteDiario();
  const { data: status, isLoading: carregandoStatus } = useStatusIntegracoes();

  const [valorInput, setValorInput] = useState('');

  useEffect(() => {
    if (limiteAtual) setValorInput(String(limiteAtual.limite));
  }, [limiteAtual]);

  function salvar() {
    const numero = parseInt(valorInput, 10);
    if (!numero || numero <= 0) return;
    salvarLimite(numero);
  }

  return (
    <div className="space-y-8">
      {/* Trava Anti-Ban */}
      <section className="rounded-lg border border-border p-5">
        <h3 className="font-display text-base font-medium text-foreground">Limite diário de disparos</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Teto de mensagens automatizadas (cadência) por dia — a trava anti-ban. Aumente aos
          poucos conforme o número ganha reputação no WhatsApp.
        </p>

        {carregandoLimite ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : (
          <div className="mt-4 flex items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="limite">Mensagens por dia</Label>
              <Input
                id="limite"
                type="number"
                min={1}
                className="w-40"
                value={valorInput}
                onChange={(e) => setValorInput(e.target.value)}
              />
            </div>
            <Button variant="accent" onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </Button>
            {isSuccess && !salvando && (
              <span className="pb-2 text-xs text-online">Atualizado ✓</span>
            )}
          </div>
        )}

        {limiteAtual && (
          <p className="mt-3 text-xs text-muted-foreground">
            Hoje: {limiteAtual.enviadosHoje} de {limiteAtual.limite} enviadas.
          </p>
        )}
      </section>

      {/* Status das integrações */}
      <section className="rounded-lg border border-border p-5">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="font-display text-base font-medium text-foreground">Status das integrações</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Só mostra se cada integração está configurada — os valores dos tokens/secrets em
              si ficam no ambiente de hospedagem (Railway/Render), não neste painel.
            </p>
          </div>
        </div>

        {carregandoStatus ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ItemStatus rotulo="WhatsApp Cloud API" configurado={status?.whatsapp.configurado ?? false} />
            <ItemStatus rotulo="Meta Ads" configurado={status?.metaAds.configurado ?? false} />
            <ItemStatus rotulo="Imobzi" configurado={status?.imobzi.configurado ?? false} />
            <ItemStatus rotulo="Pusher (tempo real)" configurado={status?.pusher.configurado ?? false} />
          </div>
        )}
      </section>
    </div>
  );
}

function ItemStatus({ rotulo, configurado }: { rotulo: string; configurado: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
        configurado ? 'border-online/20 bg-online/5 text-online' : 'border-border bg-muted/40 text-muted-foreground'
      )}
    >
      {configurado ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      {rotulo}
    </div>
  );
}
