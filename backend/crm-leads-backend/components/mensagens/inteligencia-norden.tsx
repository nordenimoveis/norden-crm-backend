'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Home, MapPin, ChevronDown, ChevronUp, Save, Loader2, Info } from 'lucide-react';
import { useMatchImoveis } from '@/hooks/use-match-imoveis';
import { useAtualizarLead } from '@/hooks/use-atualizar-lead';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LeadDetalhado, PerfilBusca } from '@/lib/types';
import { cn } from '@/lib/utils';

function corDoScore(score: number) {
  if (score >= 70) {
    return {
      texto: 'text-emerald-700',
      fundo: 'bg-gradient-to-r from-emerald-50 to-teal-50',
      anel: 'ring-emerald-200',
    };
  }
  if (score >= 30) {
    return {
      texto: 'text-amber-700',
      fundo: 'bg-gradient-to-r from-amber-50 to-orange-50',
      anel: 'ring-amber-200',
    };
  }
  return { texto: 'text-slate-600', fundo: 'bg-gradient-to-r from-slate-50 to-slate-100', anel: 'ring-slate-200' };
}

function formatarValor(valor: string | null) {
  if (!valor) return null;
  return Number(valor).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

function SkeletonCard() {
  return (
    <div className="w-[200px] shrink-0 animate-pulse rounded-xl border border-border bg-card p-3">
      <div className="h-24 w-full rounded-lg bg-muted" />
      <div className="mt-2 h-3 w-2/3 rounded bg-muted" />
      <div className="mt-1.5 h-3 w-1/2 rounded bg-muted" />
      <div className="mt-2 h-2.5 w-full rounded bg-muted" />
    </div>
  );
}

export function InteligenciaNorden({ lead }: { lead: LeadDetalhado }) {
  const { data: matches, isLoading, isError, error } = useMatchImoveis(lead.id);
  const atualizar = useAtualizarLead(lead.id);

  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [bairro, setBairro] = useState('');
  const [orcamentoMin, setOrcamentoMin] = useState('');
  const [orcamentoMax, setOrcamentoMax] = useState('');
  const [quartos, setQuartos] = useState('');
  const [finalidade, setFinalidade] = useState<'moradia' | 'investimento' | ''>('');
  const [perfilSemantico, setPerfilSemantico] = useState('');

  useEffect(() => {
    const p = lead.perfilBusca;
    setBairro(p?.bairro ?? '');
    setOrcamentoMin(p?.orcamentoMin?.toString() ?? '');
    setOrcamentoMax(p?.orcamentoMax?.toString() ?? '');
    setQuartos(p?.quartos?.toString() ?? '');
    setFinalidade(p?.finalidade ?? '');
    setPerfilSemantico(lead.perfilSemantico ?? '');
  }, [lead.id, lead.perfilBusca, lead.perfilSemantico]);

  const perfilPreenchido = !!(lead.perfilBusca || lead.perfilSemantico);
  const cores = corDoScore(lead.score);

  async function salvarPerfil() {
    const perfilBusca: PerfilBusca = {
      bairro: bairro || undefined,
      orcamentoMin: orcamentoMin ? Number(orcamentoMin) : undefined,
      orcamentoMax: orcamentoMax ? Number(orcamentoMax) : undefined,
      quartos: quartos ? Number(quartos) : undefined,
      finalidade: finalidade || undefined,
    };

    await atualizar.mutateAsync({
      perfilBusca,
      perfilSemantico: perfilSemantico || null,
    });
    setEditandoPerfil(false);
  }

  const mensagemErro = (error as Error | undefined)?.message;
  const perfilIncompleto = isError && mensagemErro?.toLowerCase().includes('perfil');

  return (
    <div className="border-b border-border p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Inteligência Norden
        </p>

        <div
          className={cn(
            'flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1',
            cores.fundo,
            cores.texto,
            cores.anel
          )}
          title="Score de engajamento — soma de mensagens, cliques e solicitações de visita"
        >
          {lead.score}
        </div>
      </div>

      <button
        onClick={() => setEditandoPerfil((v) => !v)}
        className="mb-2 flex w-full items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted/40"
      >
        <span>
          {perfilPreenchido ? 'Perfil de busca' : 'Preencher perfil de busca'}
          {!perfilPreenchido && (
            <span className="ml-1.5 text-muted-foreground">(necessário pra ver sugestões)</span>
          )}
        </span>
        {editandoPerfil ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      <AnimatePresence initial={false}>
        {editandoPerfil && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mb-3 space-y-2 rounded-md border border-border p-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Bairro</Label>
                  <Input value={bairro} onChange={(e) => setBairro(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Quartos</Label>
                  <Input
                    type="number"
                    value={quartos}
                    onChange={(e) => setQuartos(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Orçamento mín.</Label>
                  <Input
                    type="number"
                    value={orcamentoMin}
                    onChange={(e) => setOrcamentoMin(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Orçamento máx.</Label>
                  <Input
                    type="number"
                    value={orcamentoMax}
                    onChange={(e) => setOrcamentoMax(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">Finalidade</Label>
                <Select value={finalidade} onValueChange={(v) => setFinalidade(v as typeof finalidade)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Não informado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="moradia">Moradia</SelectItem>
                    <SelectItem value="investimento">Investimento</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">Descrição livre (perfil semântico)</Label>
                <Textarea
                  value={perfilSemantico}
                  onChange={(e) => setPerfilSemantico(e.target.value)}
                  rows={2}
                  placeholder="Ex: busca casa térrea com espaço pra home office e área externa..."
                  className="text-xs"
                />
              </div>

              <Button
                size="sm"
                variant="accent"
                onClick={salvarPerfil}
                disabled={atualizar.isPending}
                className="w-full"
              >
                {atualizar.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Salvar perfil
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : perfilIncompleto ? (
        <p className="flex items-start gap-1.5 rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Preencha o perfil de busca acima pra ver sugestões de imóveis pra esse lead.
        </p>
      ) : isError ? (
        <p className="text-[11px] text-muted-foreground">Não foi possível carregar sugestões agora.</p>
      ) : !matches || matches.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Nenhum imóvel do catálogo bate com esse perfil ainda.
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <AnimatePresence>
            {matches.map((match, i) => (
              <motion.div
                key={match.imovel.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.06 }}
                className="w-[200px] shrink-0 rounded-xl border border-border bg-card shadow-sm"
              >
                {match.imovel.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={match.imovel.fotoUrl}
                    alt={match.imovel.titulo}
                    className="h-24 w-full rounded-t-xl object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-full items-center justify-center rounded-t-xl bg-muted/50">
                    <Home className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}

                <div className="p-2.5">
                  <p className="truncate text-xs font-medium text-foreground">{match.imovel.titulo}</p>

                  {match.imovel.bairro && (
                    <p className="mt-0.5 flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <MapPin className="h-2.5 w-2.5" />
                      {match.imovel.bairro}
                    </p>
                  )}

                  {match.imovel.valor && (
                    <p className="mt-1 text-xs font-bold text-foreground">
                      {formatarValor(match.imovel.valor)}
                    </p>
                  )}

                  <div className="mt-1.5 w-fit rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {match.matchScore}% de afinidade
                  </div>

                  <p className="mt-1.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                    {match.motivo}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
