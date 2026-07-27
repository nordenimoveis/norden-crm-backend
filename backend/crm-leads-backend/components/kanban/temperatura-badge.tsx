import { Flame, Thermometer, Snowflake } from 'lucide-react';
import { LeadTemperatura } from '@/lib/types';
import { cn } from '@/lib/utils';

const config: Record<
  LeadTemperatura,
  { label: string; icone: typeof Flame | null; className: string } | null
> = {
  nao_avaliado: null, // sem selo — evita ruído visual pra leads ainda não avaliados
  frio: {
    label: 'Frio',
    icone: Snowflake,
    className: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  morno: {
    label: 'Morno',
    icone: Thermometer,
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  quente: {
    label: 'Quente',
    icone: Flame,
    className: 'bg-red-50 text-red-700 border-red-200',
  },
};

export function TemperaturaBadge({ temperatura }: { temperatura: LeadTemperatura }) {
  const item = config[temperatura];
  if (!item) return null;

  const Icone = item.icone;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        item.className
      )}
    >
      {Icone && <Icone className="h-3 w-3" />}
      {item.label}
    </span>
  );
}
