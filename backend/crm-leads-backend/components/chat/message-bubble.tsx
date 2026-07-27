import { Mensagem } from '@/lib/types';
import { MessageStatusIcon } from './message-status-icon';
import { cn } from '@/lib/utils';

function formatarHora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function MessageBubble({ mensagem }: { mensagem: Mensagem }) {
  const éNossa = mensagem.direcao === 'enviada';

  return (
    <div className={cn('flex', éNossa ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
          éNossa
            ? 'rounded-br-sm bg-sidebar text-sidebar-foreground'
            : 'rounded-bl-sm border border-border bg-card text-card-foreground'
        )}
      >
        <p className="whitespace-pre-wrap break-words">{mensagem.conteudo}</p>

        <div
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-[10px]',
            éNossa ? 'text-sidebar-muted' : 'text-muted-foreground'
          )}
        >
          {éNossa && mensagem.enviadaPorUsuario && (
            <span className="mr-1 italic">{mensagem.enviadaPorUsuario.nome}</span>
          )}
          <span>{formatarHora(mensagem.criadoEm)}</span>
          {éNossa && <MessageStatusIcon status={mensagem.status} />}
        </div>
      </div>
    </div>
  );
}
