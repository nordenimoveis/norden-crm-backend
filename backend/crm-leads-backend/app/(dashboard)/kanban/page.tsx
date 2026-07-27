'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { KanbanBoard } from '@/components/kanban/board';

function KanbanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function abrirLead(id: string) {
    router.push(`/mensagens?leadId=${id}`);
  }

  return (
    <div className="h-full">
      <KanbanBoard onAbrirLead={abrirLead} />
    </div>
  );
}

export default function KanbanPage() {
  return (
    <Suspense fallback={null}>
      <KanbanContent />
    </Suspense>
  );
}
