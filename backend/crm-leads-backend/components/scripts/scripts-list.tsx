'use client';

import { useState } from 'react';
import { Pencil, Trash2, Loader2, Star } from 'lucide-react';
import { useQuickReplies } from '@/hooks/use-quick-replies';
import { useDeletarQuickReply } from '@/hooks/use-quick-reply-mutations';
import { useAuthStore } from '@/store/auth-store';
import { QuickReply } from '@/lib/types';
import { cn } from '@/lib/utils';

export function ScriptsList({ onEditar }: { onEditar: (item: QuickReply) => void }) {
  const usuario = useAuthStore((state) => state.usuario);
  const { data: quickReplies, isLoading } = useQuickReplies('', true);
  const { mutate: deletar, isPending: excluindo, variables: idEmExclusao } = useDeletarQuickReply();
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);

  function podeEditar(item: QuickReply) {
    if (!usuario) return false;
    if (usuario.papel !== 'corretor') return true; // gestor/admin edita qualquer um
    return item.tipo === 'pessoal' && item.usuarioId === usuario.id;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando scripts...
      </div>
    );
  }

  if (!quickReplies || quickReplies.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        Nenhum script cadastrado ainda.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {quickReplies.map((item) => {
        const editavel = podeEditar(item);
        const emExclusao = excluindo && idEmExclusao === item.id;

        return (
          <div key={item.id} className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">{item.titulo}</p>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    item.tipo === 'global'
                      ? 'bg-accent/10 text-accent'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {item.tipo === 'global' ? 'Global' : 'Pessoal'}
                </span>
                {item.paraAvaliacaoGoogle && (
                  <span
                    className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                    title="Sugerido automaticamente ao fechar negócio"
                  >
                    <Star className="h-3 w-3" />
                    Avaliação Google
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.textoMensagem}</p>
            </div>

            {editavel && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => onEditar(item)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Editar"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>

                {confirmandoId === item.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        deletar(item.id);
                        setConfirmandoId(null);
                      }}
                      className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setConfirmandoId(null)}
                      className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmandoId(item.id)}
                    disabled={emExclusao}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-700"
                    title="Excluir"
                  >
                    {emExclusao ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
