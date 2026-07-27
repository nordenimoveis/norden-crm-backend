'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles, Upload, Link2, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  useCriarImovel,
  useAtualizarImovel,
  useExtrairImovelDePdf,
  useExtrairImovelDeUrl,
} from '@/hooks/use-imoveis';
import { Imovel } from '@/lib/types';
import { cn } from '@/lib/utils';

type CamposFormulario = {
  titulo: string;
  bairro: string;
  cidade: string;
  valor: string;
  metragem: string;
  quartos: string;
  descricao: string;
  fotoUrl: string;
  referenciaExterna: string;
  ativo: boolean;
};

const FORMULARIO_VAZIO: CamposFormulario = {
  titulo: '',
  bairro: '',
  cidade: 'Florianópolis',
  valor: '',
  metragem: '',
  quartos: '',
  descricao: '',
  fotoUrl: '',
  referenciaExterna: '',
  ativo: true,
};

/**
 * Badge "sugerido pela IA" — aparece ao lado do rótulo de um campo que
 * veio do auto-preenchimento e ainda não foi tocado pelo corretor. Some
 * sozinho assim que a pessoa edita aquele campo especificamente (a edição
 * EM SI já é a revisão/confirmação — não pedimos um "OK" redundante por
 * campo, o "Salvar imóvel" no final é a confirmação geral).
 */
function RotuloComIA({ texto, sugerido }: { texto: string; sugerido: boolean }) {
  return (
    <Label className="flex items-center gap-1.5">
      {texto}
      {sugerido && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
          title="Sugerido pela IA — revise antes de salvar"
        >
          <Sparkles className="h-2.5 w-2.5" />
          IA
        </span>
      )}
    </Label>
  );
}

export function ImovelFormDialog({
  aberto,
  onFechar,
  imovelEditando,
}: {
  aberto: boolean;
  onFechar: () => void;
  imovelEditando?: Imovel | null;
}) {
  const [campos, setCampos] = useState<CamposFormulario>(FORMULARIO_VAZIO);
  const [camposSugeridosIA, setCamposSugeridosIA] = useState<Set<string>>(new Set());
  const [urlExtracao, setUrlExtracao] = useState('');
  const [mostrarCampoUrl, setMostrarCampoUrl] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const criar = useCriarImovel();
  const atualizar = useAtualizarImovel();
  const extrairPdf = useExtrairImovelDePdf();
  const extrairUrl = useExtrairImovelDeUrl();

  const estaEditando = !!imovelEditando;
  const salvando = criar.isPending || atualizar.isPending;
  const extraindo = extrairPdf.isPending || extrairUrl.isPending;

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setCamposSugeridosIA(new Set());
    setMostrarCampoUrl(false);
    setUrlExtracao('');

    if (imovelEditando) {
      setCampos({
        titulo: imovelEditando.titulo,
        bairro: imovelEditando.bairro ?? '',
        cidade: imovelEditando.cidade,
        valor: imovelEditando.valor ?? '',
        metragem: imovelEditando.metragem?.toString() ?? '',
        quartos: imovelEditando.quartos?.toString() ?? '',
        descricao: imovelEditando.descricao ?? '',
        fotoUrl: imovelEditando.fotoUrl ?? '',
        referenciaExterna: imovelEditando.referenciaExterna ?? '',
        ativo: imovelEditando.ativo,
      });
    } else {
      setCampos(FORMULARIO_VAZIO);
    }
  }, [aberto, imovelEditando]);

  function mudarCampo<K extends keyof CamposFormulario>(campo: K, valor: CamposFormulario[K]) {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
    // Editar manualmente = revisado — o selo de "sugerido" some pra esse campo
    setCamposSugeridosIA((atual) => {
      if (!atual.has(campo)) return atual;
      const novo = new Set(atual);
      novo.delete(campo);
      return novo;
    });
  }

  function aplicarDadosExtraidos(dados: {
    titulo: string;
    bairro: string | null;
    cidade: string | null;
    valor: number | null;
    metragem: number | null;
    quartos: number | null;
    descricao: string;
  }) {
    const camposPreenchidos = new Set<string>();

    setCampos((atual) => {
      const novo = { ...atual };
      if (dados.titulo) {
        novo.titulo = dados.titulo;
        camposPreenchidos.add('titulo');
      }
      if (dados.bairro) {
        novo.bairro = dados.bairro;
        camposPreenchidos.add('bairro');
      }
      if (dados.cidade) {
        novo.cidade = dados.cidade;
        camposPreenchidos.add('cidade');
      }
      if (dados.valor) {
        novo.valor = String(dados.valor);
        camposPreenchidos.add('valor');
      }
      if (dados.metragem) {
        novo.metragem = String(dados.metragem);
        camposPreenchidos.add('metragem');
      }
      if (dados.quartos) {
        novo.quartos = String(dados.quartos);
        camposPreenchidos.add('quartos');
      }
      if (dados.descricao) {
        novo.descricao = dados.descricao;
        camposPreenchidos.add('descricao');
      }
      return novo;
    });

    setCamposSugeridosIA(camposPreenchidos);
  }

  async function aoEscolherPdf(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;

    setErro(null);
    try {
      const dados = await extrairPdf.mutateAsync(arquivo);
      aplicarDadosExtraidos(dados);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      evento.target.value = '';
    }
  }

  async function extrairDeUrl() {
    if (!urlExtracao.trim()) return;
    setErro(null);
    try {
      const dados = await extrairUrl.mutateAsync(urlExtracao);
      aplicarDadosExtraidos(dados);
      setMostrarCampoUrl(false);
      setUrlExtracao('');
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function salvar() {
    if (!campos.titulo.trim()) return;
    setErro(null);

    const input = {
      titulo: campos.titulo,
      bairro: campos.bairro || undefined,
      cidade: campos.cidade || undefined,
      valor: campos.valor ? Number(campos.valor) : undefined,
      metragem: campos.metragem ? Number(campos.metragem) : undefined,
      quartos: campos.quartos ? Number(campos.quartos) : undefined,
      descricao: campos.descricao || undefined,
      fotoUrl: campos.fotoUrl || undefined,
      referenciaExterna: campos.referenciaExterna || undefined,
      ativo: campos.ativo,
    };

    try {
      if (estaEditando) {
        await atualizar.mutateAsync({ id: imovelEditando!.id, input });
      } else {
        await criar.mutateAsync(input);
      }
      onFechar();
    } catch (e) {
      setErro((e as Error).message || 'Não foi possível salvar o imóvel.');
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{estaEditando ? 'Editar imóvel' : 'Novo imóvel'}</DialogTitle>
          <DialogDescription>
            {estaEditando
              ? 'O embedding de busca é recalculado automaticamente ao salvar.'
              : 'Extraia de um PDF/URL pra pré-preencher, revise os campos e salve.'}
          </DialogDescription>
        </DialogHeader>

        {!estaEditando && (
          <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-sky-600" />
              Auto-preenchimento por IA (opcional)
            </div>

            <div className="flex flex-wrap gap-2">
              <label>
                <Button variant="outline" size="sm" asChild disabled={extraindo}>
                  <span className="cursor-pointer">
                    {extrairPdf.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Extrair de PDF
                  </span>
                </Button>
                <input type="file" accept=".pdf" className="hidden" onChange={aoEscolherPdf} disabled={extraindo} />
              </label>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setMostrarCampoUrl((v) => !v)}
                disabled={extraindo}
              >
                <Link2 className="h-3.5 w-3.5" />
                Extrair de URL
              </Button>
            </div>

            {mostrarCampoUrl && (
              <div className="flex gap-2">
                <Input
                  value={urlExtracao}
                  onChange={(e) => setUrlExtracao(e.target.value)}
                  placeholder="https://..."
                  className="text-sm"
                />
                <Button
                  size="sm"
                  variant="accent"
                  onClick={extrairDeUrl}
                  disabled={extrairUrl.isPending || !urlExtracao.trim()}
                >
                  {extrairUrl.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Buscar
                </Button>
              </div>
            )}

            {camposSugeridosIA.size > 0 && (
              <p className="flex items-start gap-1.5 text-[11px] text-sky-700">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                Os campos marcados com <Sparkles className="inline h-2.5 w-2.5" /> IA foram
                sugeridos automaticamente — revise cada um antes de salvar.
              </p>
            )}
          </div>
        )}

        <div className="grid max-h-[50vh] grid-cols-2 gap-4 overflow-y-auto py-1">
          <div className="col-span-2 space-y-1.5">
            <RotuloComIA texto="Título" sugerido={camposSugeridosIA.has('titulo')} />
            <Input
              value={campos.titulo}
              onChange={(e) => mudarCampo('titulo', e.target.value)}
              className={cn(camposSugeridosIA.has('titulo') && 'border-sky-300 bg-sky-50/30')}
            />
          </div>

          <div className="space-y-1.5">
            <RotuloComIA texto="Bairro" sugerido={camposSugeridosIA.has('bairro')} />
            <Input
              value={campos.bairro}
              onChange={(e) => mudarCampo('bairro', e.target.value)}
              className={cn(camposSugeridosIA.has('bairro') && 'border-sky-300 bg-sky-50/30')}
            />
          </div>

          <div className="space-y-1.5">
            <RotuloComIA texto="Cidade" sugerido={camposSugeridosIA.has('cidade')} />
            <Input
              value={campos.cidade}
              onChange={(e) => mudarCampo('cidade', e.target.value)}
              className={cn(camposSugeridosIA.has('cidade') && 'border-sky-300 bg-sky-50/30')}
            />
          </div>

          <div className="space-y-1.5">
            <RotuloComIA texto="Valor (R$)" sugerido={camposSugeridosIA.has('valor')} />
            <Input
              type="number"
              value={campos.valor}
              onChange={(e) => mudarCampo('valor', e.target.value)}
              className={cn(camposSugeridosIA.has('valor') && 'border-sky-300 bg-sky-50/30')}
            />
          </div>

          <div className="space-y-1.5">
            <RotuloComIA texto="Metragem (m²)" sugerido={camposSugeridosIA.has('metragem')} />
            <Input
              type="number"
              value={campos.metragem}
              onChange={(e) => mudarCampo('metragem', e.target.value)}
              className={cn(camposSugeridosIA.has('metragem') && 'border-sky-300 bg-sky-50/30')}
            />
          </div>

          <div className="space-y-1.5">
            <RotuloComIA texto="Quartos" sugerido={camposSugeridosIA.has('quartos')} />
            <Input
              type="number"
              value={campos.quartos}
              onChange={(e) => mudarCampo('quartos', e.target.value)}
              className={cn(camposSugeridosIA.has('quartos') && 'border-sky-300 bg-sky-50/30')}
            />
          </div>

          <div className="space-y-1.5">
            <Label>URL da foto (opcional)</Label>
            <Input value={campos.fotoUrl} onChange={(e) => mudarCampo('fotoUrl', e.target.value)} />
          </div>

          <div className="col-span-2 space-y-1.5">
            <RotuloComIA texto="Descrição" sugerido={camposSugeridosIA.has('descricao')} />
            <Textarea
              value={campos.descricao}
              onChange={(e) => mudarCampo('descricao', e.target.value)}
              rows={3}
              className={cn(camposSugeridosIA.has('descricao') && 'border-sky-300 bg-sky-50/30')}
            />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>Referência externa (opcional)</Label>
            <Input
              value={campos.referenciaExterna}
              onChange={(e) => mudarCampo('referenciaExterna', e.target.value)}
            />
          </div>

          <div className="col-span-2 flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label className="text-sm">Ativo (disponível para match)</Label>
            <Switch checked={campos.ativo} onCheckedChange={(v) => mudarCampo('ativo', v)} />
          </div>
        </div>

        {erro && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {erro}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button variant="accent" onClick={salvar} disabled={salvando || !campos.titulo.trim()}>
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar imóvel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
