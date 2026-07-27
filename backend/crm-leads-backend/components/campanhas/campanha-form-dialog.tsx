'use client';

import { useState } from 'react';
import { Loader2, Users, AlertTriangle, Upload, CheckCircle2, Plus, X } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTemplates, useCriarTemplate } from '@/hooks/use-templates';
import { useCriarCampanha, useMarcarCampanhaComoPronta, usePreviewPublico } from '@/hooks/use-campanhas';
import { uploadMidiaCampanha } from '@/lib/campanhas-api';
import { FiltroPublico, MidiaTipo, ROTULO_MIDIA_TIPO } from '@/lib/types';

const ROTULO_ORIGEM: Record<string, string> = {
  meta_ads: 'Meta Ads',
  site_imobzi: 'Site',
  legado_imobzi: 'Base Antiga',
  importacao_planilha: 'Planilha',
  manual: 'Manual',
};

const ROTULO_TEMPERATURA: Record<string, string> = {
  nao_avaliado: 'Não avaliado',
  frio: 'Frio',
  morno: 'Morno',
  quente: 'Quente',
};

export function CampanhaFormDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [nome, setNome] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [filtro, setFiltro] = useState<FiltroPublico>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [midiaUrl, setMidiaUrl] = useState<string | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);

  // Criação de template embutida — evita ter que ir na aba Templates antes
  const [criandoTemplate, setCriandoTemplate] = useState(false);
  const [novoTplNome, setNovoTplNome] = useState('');
  const [novoTplConteudo, setNovoTplConteudo] = useState('');
  const [novoTplMetaName, setNovoTplMetaName] = useState('');
  const [novoTplAprovado, setNovoTplAprovado] = useState(false);
  const [novoTplMidia, setNovoTplMidia] = useState<MidiaTipo | 'nenhum'>('nenhum');

  const { data: templates, isLoading: carregandoTemplates } = useTemplates();
  const templatesAprovados = templates?.filter((t) => t.aprovadoMeta && t.metaTemplateName) ?? [];
  const templateSelecionado = templatesAprovados.find((t) => t.id === templateId) ?? null;

  const { data: preview, isFetching: contandoPublico } = usePreviewPublico(filtro, aberto);
  const criar = useCriarCampanha();
  const marcarPronta = useMarcarCampanhaComoPronta();
  const criarTemplate = useCriarTemplate();

  function limparEfechar() {
    setNome('');
    setTemplateId('');
    setFiltro({});
    setErro(null);
    setMidiaUrl(null);
    setNomeArquivo(null);
    setCriandoTemplate(false);
    setNovoTplNome('');
    setNovoTplConteudo('');
    setNovoTplMetaName('');
    setNovoTplAprovado(false);
    setNovoTplMidia('nenhum');
    onFechar();
  }

  function mudarTemplate(novoId: string) {
    setTemplateId(novoId);
    setMidiaUrl(null);
    setNomeArquivo(null);
  }

  async function criarTemplateEUsar() {
    if (!novoTplNome.trim() || !novoTplConteudo.trim()) return;
    setErro(null);

    try {
      const novoTemplate = await criarTemplate.mutateAsync({
        nome: novoTplNome,
        conteudo: novoTplConteudo,
        metaTemplateName: novoTplMetaName.trim() || undefined,
        aprovadoMeta: novoTplAprovado,
        midiaTipo: novoTplMidia === 'nenhum' ? null : novoTplMidia,
      });

      setCriandoTemplate(false);
      setNovoTplNome('');
      setNovoTplConteudo('');
      setNovoTplMetaName('');
      setNovoTplAprovado(false);
      setNovoTplMidia('nenhum');

      // Se já nasceu aprovado + com nome da Meta, já pode ser selecionado
      // direto pra campanha; senão, o usuário precisa aprovar depois na Meta
      // e marcar por lá antes de conseguir usá-lo numa campanha.
      if (novoTemplate.aprovadoMeta && novoTemplate.metaTemplateName) {
        setTemplateId(novoTemplate.id);
      }
    } catch (e) {
      setErro((e as Error).message || 'Não foi possível criar o template.');
    }
  }

  async function aoEscolherArquivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;

    setErro(null);
    setEnviandoArquivo(true);
    setNomeArquivo(arquivo.name);

    try {
      const resultado = await uploadMidiaCampanha(arquivo);
      setMidiaUrl(resultado.url);
    } catch (e) {
      setErro((e as Error).message);
      setNomeArquivo(null);
    } finally {
      setEnviandoArquivo(false);
    }
  }

  async function salvar() {
    setErro(null);
    try {
      // Criar + marcar pronta num clique só — a revisão já aconteceu aqui
      // nesta mesma tela, não faz sentido pedir outro clique de confirmação
      // intermediário. O único clique que continua separado é "Iniciar
      // envio" (na lista de campanhas), porque esse sim dispara mensagens
      // de verdade — vale continuar sendo um passo consciente à parte.
      const campanha = await criar.mutateAsync({
        nome,
        templateMensagemId: templateId,
        filtroPublico: filtro,
        midiaUrl: midiaUrl ?? undefined,
      });
      await marcarPronta.mutateAsync(campanha.id);
      limparEfechar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const precisaDeMidia = !!templateSelecionado?.midiaTipo;
  const midiaOk = !precisaDeMidia || !!midiaUrl;
  const salvando = criar.isPending || marcarPronta.isPending;
  const formularioValido =
    nome.trim() && templateId && (preview?.total ?? 0) > 0 && midiaOk && !enviandoArquivo;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && limparEfechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova campanha</DialogTitle>
          <DialogDescription>
            Tudo numa tela só: template, mídia, público e revisão. Ao salvar, a campanha já fica
            pronta pra enviar — falta só clicar em "Iniciar envio" na lista.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="nome-campanha">Nome da campanha</Label>
            <Input
              id="nome-campanha"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Reativação base antiga - Julho"
            />
          </div>

          {/* Template — selecionar ou criar embutido */}
          <div className="space-y-1.5 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <Label>Template aprovado</Label>
              {!criandoTemplate && (
                <button
                  type="button"
                  onClick={() => setCriandoTemplate(true)}
                  className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  Criar novo template
                </button>
              )}
            </div>

            {criandoTemplate ? (
              <div className="space-y-3 rounded-md bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Novo template
                  </p>
                  <button type="button" onClick={() => setCriandoTemplate(false)}>
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>

                <Input
                  value={novoTplNome}
                  onChange={(e) => setNovoTplNome(e.target.value)}
                  placeholder="Nome interno do template"
                />
                <Textarea
                  value={novoTplConteudo}
                  onChange={(e) => setNovoTplConteudo(e.target.value)}
                  placeholder="Texto do template — precisa bater com o aprovado na Meta"
                  rows={3}
                />
                <Input
                  value={novoTplMetaName}
                  onChange={(e) => setNovoTplMetaName(e.target.value)}
                  placeholder="Nome do template na Meta (ex: reativacao_v1)"
                />

                <div className="grid grid-cols-2 gap-2">
                  <Select value={novoTplMidia} onValueChange={(v) => setNovoTplMidia(v as MidiaTipo | 'nenhum')}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nenhum">Sem mídia</SelectItem>
                      {Object.entries(ROTULO_MIDIA_TIPO).map(([valor, rotulo]) => (
                        <SelectItem key={valor} value={valor}>
                          {rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex items-center justify-between rounded-md border border-border px-2">
                    <span className="text-xs text-muted-foreground">Já aprovado na Meta</span>
                    <Switch checked={novoTplAprovado} onCheckedChange={setNovoTplAprovado} />
                  </div>
                </div>

                <Button
                  type="button"
                  variant="accent"
                  size="sm"
                  onClick={criarTemplateEUsar}
                  disabled={criarTemplate.isPending || !novoTplNome.trim() || !novoTplConteudo.trim()}
                  className="w-full"
                >
                  {criarTemplate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Criar template
                </Button>
              </div>
            ) : carregandoTemplates ? (
              <p className="text-xs text-muted-foreground">Carregando templates...</p>
            ) : templatesAprovados.length === 0 ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Nenhum template pronto pra uso ainda. Cria um acima — mas só entra na lista de
                seleção depois de "Aprovado pela Meta" e "Nome do template na Meta" preenchidos
                (os dois batendo com o que foi aprovado lá de verdade).
              </p>
            ) : (
              <Select value={templateId} onValueChange={mudarTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o template" />
                </SelectTrigger>
                <SelectContent>
                  {templatesAprovados.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nome}
                      {t.midiaTipo ? ` (${ROTULO_MIDIA_TIPO[t.midiaTipo]})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {templateSelecionado && (
              <div className="rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
                {templateSelecionado.conteudo}
              </div>
            )}
          </div>

          {precisaDeMidia && templateSelecionado?.midiaTipo && (
            <div className="space-y-1.5">
              <Label>Anexar {ROTULO_MIDIA_TIPO[templateSelecionado.midiaTipo].toLowerCase()}</Label>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground transition-colors hover:bg-muted/60">
                {enviandoArquivo ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : midiaUrl ? (
                  <CheckCircle2 className="h-5 w-5 text-online" />
                ) : (
                  <Upload className="h-5 w-5" />
                )}
                <span className="font-medium text-foreground">
                  {enviandoArquivo ? 'Enviando...' : nomeArquivo ?? 'Clique para escolher o arquivo'}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept={
                    templateSelecionado.midiaTipo === 'image'
                      ? 'image/*'
                      : templateSelecionado.midiaTipo === 'video'
                        ? 'video/*'
                        : '.pdf'
                  }
                  onChange={aoEscolherArquivo}
                />
              </label>
            </div>
          )}

          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Filtrar público
            </Label>

            <div className="grid grid-cols-2 gap-2">
              <SeletorFiltro
                placeholder="Origem"
                valor={filtro.origem}
                opcoes={ROTULO_ORIGEM}
                onMudar={(v) => setFiltro((f) => ({ ...f, origem: v as FiltroPublico['origem'] }))}
              />
              <SeletorFiltro
                placeholder="Temperatura"
                valor={filtro.temperatura}
                opcoes={ROTULO_TEMPERATURA}
                onMudar={(v) => setFiltro((f) => ({ ...f, temperatura: v as FiltroPublico['temperatura'] }))}
              />
            </div>

            <div className="flex items-center gap-2 pt-1 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              {contandoPublico ? (
                <span className="text-muted-foreground">Contando...</span>
              ) : (
                <span className={preview?.total ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                  {preview?.total ?? 0} destinatário{(preview?.total ?? 0) !== 1 ? 's' : ''} encontrado
                  {(preview?.total ?? 0) !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {/* Revisão final — resumo de tudo antes de salvar */}
          {formularioValido && templateSelecionado && (
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-accent">
                Revisão
              </p>
              <p className="text-sm text-foreground">
                <strong>{nome}</strong> — template "{templateSelecionado.nome}" para{' '}
                <strong>{preview?.total}</strong> pessoa{(preview?.total ?? 0) !== 1 ? 's' : ''}
                {midiaUrl ? ', com mídia anexada' : ''}.
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Envie campanhas de disparo em massa só para contatos com relação prévia (base
            antiga/morna). Leads frios sem interação anterior devem vir por anúncio
            (Click-to-WhatsApp), não por disparo ativo — risco real de banimento do número.
          </div>

          {erro && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={limparEfechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button variant="accent" onClick={salvar} disabled={!formularioValido || salvando}>
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar campanha (pronta pra enviar)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <SelectTrigger className="text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todos">{placeholder}: todos</SelectItem>
        {Object.entries(opcoes).map(([v, rotulo]) => (
          <SelectItem key={v} value={v}>
            {rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
