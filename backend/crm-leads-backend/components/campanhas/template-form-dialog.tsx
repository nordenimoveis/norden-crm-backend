'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useCriarTemplate, useAtualizarTemplate } from '@/hooks/use-templates';
import { TemplateMensagem, MidiaTipo, ROTULO_MIDIA_TIPO } from '@/lib/types';

export function TemplateFormDialog({
  aberto,
  onFechar,
  templateEditando,
}: {
  aberto: boolean;
  onFechar: () => void;
  templateEditando?: TemplateMensagem | null;
}) {
  const [nome, setNome] = useState('');
  const [conteudo, setConteudo] = useState('');
  const [metaTemplateName, setMetaTemplateName] = useState('');
  const [aprovadoMeta, setAprovadoMeta] = useState(false);
  const [midiaTipo, setMidiaTipo] = useState<MidiaTipo | 'nenhum'>('nenhum');
  const [erro, setErro] = useState<string | null>(null);

  const criar = useCriarTemplate();
  const atualizar = useAtualizarTemplate();
  const emAndamento = criar.isPending || atualizar.isPending;
  const estaEditando = !!templateEditando;

  useEffect(() => {
    if (!aberto) return;
    setNome(templateEditando?.nome ?? '');
    setConteudo(templateEditando?.conteudo ?? '');
    setMetaTemplateName(templateEditando?.metaTemplateName ?? '');
    setAprovadoMeta(templateEditando?.aprovadoMeta ?? false);
    setMidiaTipo(templateEditando?.midiaTipo ?? 'nenhum');
    setErro(null);
  }, [aberto, templateEditando]);

  async function salvar() {
    if (!nome.trim() || !conteudo.trim()) return;
    setErro(null);

    const input = {
      nome,
      conteudo,
      metaTemplateName: metaTemplateName.trim() || undefined,
      aprovadoMeta,
      midiaTipo: midiaTipo === 'nenhum' ? null : midiaTipo,
    };

    try {
      if (estaEditando) {
        await atualizar.mutateAsync({ id: templateEditando!.id, input });
      } else {
        await criar.mutateAsync(input);
      }
      onFechar();
    } catch (e) {
      setErro((e as Error).message || 'Não foi possível salvar o template. Tente novamente.');
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{estaEditando ? 'Editar template' : 'Novo template'}</DialogTitle>
          <DialogDescription>
            O template real é criado e aprovado no Meta Business Suite — este cadastro só
            registra aqui o que já existe (ou candidatos, antes de submeter para aprovação).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-nome">Nome (interno)</Label>
            <Input id="tpl-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-conteudo">Texto do template</Label>
            <Textarea
              id="tpl-conteudo"
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
              rows={4}
              placeholder="Ex: Olá {{1}}, temos novidades no seu perfil de busca..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-meta-name">Nome do template na Meta (opcional)</Label>
            <Input
              id="tpl-meta-name"
              value={metaTemplateName}
              onChange={(e) => setMetaTemplateName(e.target.value)}
              placeholder="ex: reativacao_base_v1"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Cabeçalho de mídia</Label>
            <Select value={midiaTipo} onValueChange={(v) => setMidiaTipo(v as MidiaTipo | 'nenhum')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">Nenhum — só texto</SelectItem>
                {Object.entries(ROTULO_MIDIA_TIPO).map(([valor, rotulo]) => (
                  <SelectItem key={valor} value={valor}>
                    {rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Só marque isso se o template foi <strong>aprovado na Meta com esse tipo de
              cabeçalho</strong> — precisa bater exatamente com a estrutura aprovada lá.
              Campanhas que usarem esse template vão pedir pra anexar o arquivo correspondente.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium text-foreground">Aprovado pela Meta</p>
              <p className="text-xs text-muted-foreground">
                Só templates aprovados podem ser usados em campanhas de disparo em massa.
              </p>
            </div>
            <Switch checked={aprovadoMeta} onCheckedChange={setAprovadoMeta} />
          </div>

          {erro && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={emAndamento}>
            Cancelar
          </Button>
          <Button variant="accent" onClick={salvar} disabled={emAndamento || !nome.trim() || !conteudo.trim()}>
            {emAndamento && <Loader2 className="h-4 w-4 animate-spin" />}
            {estaEditando ? 'Salvar alterações' : 'Criar template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
