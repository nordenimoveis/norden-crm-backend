import { QuickReply } from '@/lib/types';
import { cn } from '@/lib/utils';

export function QuickReplyPopover({
  itens,
  indiceAtivo,
  onSelecionar,
}: {
  itens: QuickReply[];
  indiceAtivo: number;
  onSelecionar: (item: QuickReply) => void;
}) {
  if (itens.length === 0) {
    return (
      <div className="absolute bottom-full left-0 mb-2 w-full rounded-lg border border-border bg-card p-3 text-center text-xs text-muted-foreground shadow-lg">
        Nenhum script encontrado
      </div>
    );
  }

  return (
    <div className="absolute bottom-full left-0 mb-2 w-full max-h-64 overflow-y-auto rounded-lg border border-border bg-card p-1.5 shadow-lg">
      <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Scripts — ↑↓ para navegar, Enter para usar
      </p>
      {itens.map((item, indice) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelecionar(item)}
          className={cn(
            'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors',
            indice === indiceAtivo ? 'bg-accent/10' : 'hover:bg-muted'
          )}
        >
          <span className="flex w-full items-center justify-between text-sm font-medium text-foreground">
            {item.titulo}
            {item.tipo === 'pessoal' && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                pessoal
              </span>
            )}
          </span>
          <span className="line-clamp-1 text-xs text-muted-foreground">{item.textoMensagem}</span>
        </button>
      ))}
    </div>
  );
}
