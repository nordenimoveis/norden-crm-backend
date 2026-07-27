'use client';

import { useRef } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROTULO_STATUS } from '@/lib/types';
import { FiltrosTabelaLeads } from '@/lib/leads-api';

const ROTULO_ORIGEM_FILTRO: Record<string, string> = {
  meta_ads: 'Meta Ads',
  site_imobzi: 'Site',
  legado_imobzi: 'Base Antiga',
  importacao_planilha: 'Planilha',
  manual: 'Manual',
};

const ROTULO_TEMPERATURA_FILTRO: Record<string, string> = {
  nao_avaliado: 'Não avaliado',
  frio: 'Frio',
  morno: 'Morno',
  quente: 'Quente',
};

export function FiltrosTabela({
  filtros,
  onMudar,
}: {
  filtros: FiltrosTabelaLeads;
  onMudar: (novosFiltros: Partial<FiltrosTabelaLeads>) => void;
}) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function aoDigitarBusca(valor: string) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      onMudar({ busca: valor || undefined, page: 1 });
    }, 400);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou telefone..."
          className="pl-8"
          defaultValue={filtros.busca}
          onChange={(e) => aoDigitarBusca(e.target.value)}
        />
      </div>

      <SeletorFiltro
        placeholder="Status"
        valor={filtros.status}
        opcoes={ROTULO_STATUS}
        onMudar={(v) => onMudar({ status: v as FiltrosTabelaLeads['status'], page: 1 })}
      />

      <SeletorFiltro
        placeholder="Origem"
        valor={filtros.origem}
        opcoes={ROTULO_ORIGEM_FILTRO}
        onMudar={(v) => onMudar({ origem: v as FiltrosTabelaLeads['origem'], page: 1 })}
      />

      <SeletorFiltro
        placeholder="Temperatura"
        valor={filtros.temperatura}
        opcoes={ROTULO_TEMPERATURA_FILTRO}
        onMudar={(v) => onMudar({ temperatura: v as FiltrosTabelaLeads['temperatura'], page: 1 })}
      />
    </div>
  );
}

function SeletorFiltro({
  placeholder,
  valor,
  opcoes,
  onMudar,
}: {
  placeholder: string;
  valor: string | undefined;
  opcoes: Record<string, string>;
  onMudar: (valor: string | undefined) => void;
}) {
  return (
    <Select value={valor ?? 'todos'} onValueChange={(v) => onMudar(v === 'todos' ? undefined : v)}>
      <SelectTrigger className="w-[160px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todos">{placeholder}: todos</SelectItem>
        {Object.entries(opcoes).map(([valor, rotulo]) => (
          <SelectItem key={valor} value={valor}>
            {rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
