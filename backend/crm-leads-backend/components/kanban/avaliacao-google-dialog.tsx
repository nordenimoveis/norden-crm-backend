'use client';

import { Star } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useUiStore } from '@/store/ui-store';
import { substituirVariaveis } from '@/lib/template-variaveis';
import { useAuthStore } from '@/store/auth-store';

export function AvaliacaoGoogleDialog({
  leadId,
  leadNome,
  textoTemplate,
  onFechar,
}: {
  leadId: string | null;
  leadNome: string | null;
  textoTemplate: string | null;
  onFechar: () => void;
}) {
  const router = useRouter();
  const usuario = useAuthStore((state) => state.usuario);
  const definirMensagemSugerida = useUiStore((state) => state.definirMensagemSugerida);

  if (!leadId || !textoTemplate) return null;

  const textoSubstituido = substituirVariaveis(textoTemplate, {
    lead_name: leadNome ?? undefined,
    broker_name: usuario?.nome ?? undefined,
  });

  function abrirChatComMensagem() {
    definirMensagemSugerida({ leadId: leadId!, texto: textoSubstituido });
    router.push(`/mensagens?leadId=${leadId}`);
    onFechar();
  }

  return (
    <Dialog open={!!leadId} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-4 w-4 text-accent" />
            Negócio fechado! 🎉
          </DialogTitle>
          <DialogDescription>
            Bom momento pra pedir uma avaliação no Google — o cliente costuma estar mais
            satisfeito logo após o fechamento.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground">
          {textoSubstituido}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Agora não
          </Button>
          <Button variant="accent" onClick={abrirChatComMensagem}>
            Abrir chat com essa mensagem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
