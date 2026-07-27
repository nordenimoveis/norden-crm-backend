'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ConversationList } from '@/components/mensagens/conversation-list';
import { ChatCentral } from '@/components/mensagens/chat-central';
import { PerfilLeadPanel } from '@/components/mensagens/perfil-lead-panel';
import { usePusherKanban } from '@/hooks/use-pusher-kanban';

function MensagensContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadId = searchParams.get('leadId');

  // Mesmo canal do Kanban — é o que mantém a lista de conversas atualizada
  // em tempo real (status, nova mensagem, indicador de não lida).
  usePusherKanban();

  function selecionarLead(id: string) {
    router.push(`/mensagens?leadId=${id}`, { scroll: false });
  }

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-border">
      <ConversationList leadIdAtivo={leadId} onSelecionar={selecionarLead} />

      {leadId ? (
        <>
          <ChatCentral leadId={leadId} />
          <PerfilLeadPanel leadId={leadId} />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
          Selecione uma conversa à esquerda para começar.
        </div>
      )}
    </div>
  );
}

export default function MensagensPage() {
  return (
    <Suspense fallback={null}>
      <MensagensContent />
    </Suspense>
  );
}
