'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScriptsList } from '@/components/scripts/scripts-list';
import { ScriptFormDialog } from '@/components/scripts/script-form-dialog';
import { QuickReply } from '@/lib/types';

export default function ScriptsPage() {
  const [dialogAberto, setDialogAberto] = useState(false);
  const [itemEditando, setItemEditando] = useState<QuickReply | null>(null);

  function abrirCriacao() {
    setItemEditando(null);
    setDialogAberto(true);
  }

  function abrirEdicao(item: QuickReply) {
    setItemEditando(item);
    setDialogAberto(true);
  }

  function fecharDialog() {
    setDialogAberto(false);
    setItemEditando(null);
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Scripts de vendas usados no atalho <code className="rounded bg-muted px-1 py-0.5">/</code> do chat.
        </p>
        <Button variant="accent" size="sm" onClick={abrirCriacao}>
          <Plus className="h-4 w-4" />
          Novo script
        </Button>
      </div>

      <ScriptsList onEditar={abrirEdicao} />

      <ScriptFormDialog aberto={dialogAberto} onFechar={fecharDialog} quickReplyEditando={itemEditando} />
    </div>
  );
}
