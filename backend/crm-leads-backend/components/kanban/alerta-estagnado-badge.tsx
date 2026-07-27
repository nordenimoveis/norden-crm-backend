import { AlertCircle, Clock } from 'lucide-react';
import { AlertaLead } from '@/lib/types';
import { cn } from '@/lib/utils';

export function AlertaEstagnadoBadge({
  alerta,
  horasParado,
}: {
  alerta: AlertaLead;
  horasParado: number | null;
}) {
  if (!alerta) return null;

  const tempoLegivel =
    horasParado !== null && horasParado >= 24
      ? `${Math.floor(horasParado / 24)}d`
      : `${horasParado ?? 0}h`;

  const config =
    alerta === 'aguardando_resposta'
      ? {
          icone: AlertCircle,
          rotulo: 'Sem resposta',
          classe: 'bg-red-50 text-red-700',
          classeTempo: 'text-red-800',
          tituloCompleto: `Aguardando resposta há ${tempoLegivel}`,
        }
      : {
          icone: Clock,
          rotulo: 'Sem atividade',
          classe: 'bg-amber-50 text-amber-800',
          classeTempo: 'text-amber-900',
          tituloCompleto: `Sem atividade há ${tempoLegivel}`,
        };

  const Icone = config.icone;

  return (
    <span
      className={cn(
        'inline-flex w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
        config.classe
      )}
      title={config.tituloCompleto}
    >
      <Icone className="h-3 w-3 shrink-0" />
      <span className="truncate">{config.rotulo}</span>
      <span className={cn('ml-auto shrink-0 font-bold', config.classeTempo)}>{tempoLegivel}</span>
    </span>
  );
}
