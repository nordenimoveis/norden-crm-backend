import { LeadOrigem } from '@/lib/types';

const config: Record<LeadOrigem, { label: string }> = {
  meta_ads: { label: 'Meta Ads' },
  site_imobzi: { label: 'Site' },
  legado_imobzi: { label: 'Base Antiga' },
  importacao_planilha: { label: 'Planilha' },
  manual: { label: 'Manual' },
};

export function OrigemBadge({ origem }: { origem: LeadOrigem }) {
  const { label } = config[origem];

  return (
    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}
