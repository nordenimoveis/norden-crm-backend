'use client';

import { useState } from 'react';
import { Loader2, CheckCircle2, Trash2, Send } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  useCampanhaDetalhe,
  useMarcarCampanhaComoPronta,
  useIniciarEnvioCampanha,
  useDeletarCampanha,
} from '@/hooks/use-campanhas';
import { ROTULO_STATUS_CAMPANHA } from '@/lib/types';

export function CampanhaDetailDialog({
  campanhaId,
  onFechar,
}: {
  campanhaId: string | null;
  onFechar: () => void;
}) {
  const { data: campanha, isLoading } = useCampanhaDetalhe(campanhaId);
  const marcarPronta = useMarcarCampanhaComoPronta();
  const iniciarEnvio = useIniciarEnvioCampanha();
  const deletar = useDeletarCampanha();
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false);

  async function confirmarPronta() {
    if (!campanha) return;
    await marcarPronta.mutateAsync(campanha.id);
  }

  async function confirmarInicioEnvio() {
    if (!campanha) return;
    await iniciarEnvio.mutateAsync(campanha.id);
    setConfirmandoEnvio(false);
  }

  async function confirmarExclusao() {
    if (!campanha) return;
    await deletar.mutateAsync(campanha.id);
    onFechar();
  }

  return (
    <Dialog open={!!campanhaId} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        {isLoading || !campanha ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{campanha.nome}</DialogTitle>
              <DialogDescription>
                {ROTULO_STATUS_CAMPANHA[campanha.status]} · {campanha._count.destinatarios}{' '}
                destinatário{campanha._count.destinatarios !== 1 ? 's' : ''} · template "
                {campanha.templateMensagem.nome}"
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {campanha.midiaUrl && campanha.templateMensagem.midiaTipo === 'image' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={campanha.midiaUrl}
                  alt="Mídia anexada à campanha"
                  className="max-h-40 w-full rounded-md border border-border object-cover"
                />
              )}
              {campanha.midiaUrl && campanha.templateMensagem.midiaTipo !== 'image' && (
                <a
                  href={campanha.midiaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate rounded-md border border-border px-3 py-2 text-xs text-accent underline"
                >
                  Ver arquivo anexado
                </a>
              )}

              <div className="rounded-md border border-border p-3 text-sm text-foreground">
                {campanha.templateMensagem.conteudo}
              </div>

              {(campanha.status === 'enviando' || campanha.status === 'concluida') && (
                <div className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Progresso do envio</span>
                    <span>
                      {campanha.progresso.enviado + campanha.progresso.falhou} de{' '}
                      {campanha._count.destinatarios}
                    </span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="bg-online"
                      style={{
                        width: `${(campanha.progresso.enviado / campanha._count.destinatarios) * 100}%`,
                      }}
                    />
                    <div
                      className="bg-red-400"
                      style={{
                        width: `${(campanha.progresso.falhou / campanha._count.destinatarios) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                    <span>✓ {campanha.progresso.enviado} enviados</span>
                    {campanha.progresso.falhou > 0 && (
                      <span className="text-red-700">✕ {campanha.progresso.falhou} falharam</span>
                    )}
                    {campanha.progresso.pendente > 0 && <span>{campanha.progresso.pendente} na fila</span>}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Amostra de destinatários
                </p>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border">
                  {campanha.destinatarios.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between border-b border-border px-3 py-1.5 text-sm last:border-0"
                    >
                      <span className="text-foreground">{d.lead.nome || d.lead.telefone}</span>
                      <span className="text-xs text-muted-foreground">{d.status}</span>
                    </div>
                  ))}
                  {campanha._count.destinatarios > campanha.destinatarios.length && (
                    <p className="px-3 py-1.5 text-xs text-muted-foreground">
                      + {campanha._count.destinatarios - campanha.destinatarios.length} outros
                    </p>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="justify-between sm:justify-between">
              {campanha.status === 'rascunho' && (
                <div>
                  {confirmandoExclusao ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-200 text-red-700 hover:bg-red-50"
                        onClick={confirmarExclusao}
                        disabled={deletar.isPending}
                      >
                        {deletar.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Confirmar exclusão
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setConfirmandoExclusao(false)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setConfirmandoExclusao(true)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Excluir rascunho
                    </Button>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={onFechar}>
                  Fechar
                </Button>
                {campanha.status === 'rascunho' && (
                  <Button variant="accent" onClick={confirmarPronta} disabled={marcarPronta.isPending}>
                    {marcarPronta.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Marcar como pronta
                  </Button>
                )}
                {campanha.status === 'pronta' && !confirmandoEnvio && (
                  <Button variant="accent" onClick={() => setConfirmandoEnvio(true)}>
                    <Send className="h-4 w-4" />
                    Iniciar envio
                  </Button>
                )}
                {campanha.status === 'pronta' && confirmandoEnvio && (
                  <>
                    <Button variant="outline" onClick={() => setConfirmandoEnvio(false)} disabled={iniciarEnvio.isPending}>
                      Cancelar
                    </Button>
                    <Button variant="accent" onClick={confirmarInicioEnvio} disabled={iniciarEnvio.isPending}>
                      {iniciarEnvio.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      Confirmar envio para {campanha._count.destinatarios} pessoas
                    </Button>
                  </>
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
