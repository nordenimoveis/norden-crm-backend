'use client';

import { useState } from 'react';
import { Upload, Link2, Trash2, Loader2, FileText, Globe, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  useDocumentos,
  useUploadDocumentoPdf,
  useIngerirDocumentoUrl,
  useDeletarDocumento,
} from '@/hooks/use-ia';

export function BaseConhecimentoView() {
  const { data: documentos, isLoading } = useDocumentos();
  const uploadPdf = useUploadDocumentoPdf();
  const ingerirUrl = useIngerirDocumentoUrl();
  const deletar = useDeletarDocumento();

  const [dialogUrlAberto, setDialogUrlAberto] = useState(false);
  const [tituloUrl, setTituloUrl] = useState('');
  const [urlValor, setUrlValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState<string | null>(null);

  async function aoEscolherPdf(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;

    setErro(null);
    try {
      // Título inicial = nome do arquivo, sem a extensão — dá pra ajustar
      // depois recriando, mas por ora mantemos simples (sem edição inline).
      const tituloSemExtensao = arquivo.name.replace(/\.pdf$/i, '');
      await uploadPdf.mutateAsync({ arquivo, titulo: tituloSemExtensao });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      evento.target.value = '';
    }
  }

  async function enviarUrl() {
    if (!tituloUrl.trim() || !urlValor.trim()) return;
    setErro(null);

    try {
      await ingerirUrl.mutateAsync({ titulo: tituloUrl, url: urlValor });
      setDialogUrlAberto(false);
      setTituloUrl('');
      setUrlValor('');
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Documentos e páginas que a IA usa como base pra responder os leads automaticamente —
          ela só responde com o que estiver aqui, nunca inventa.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setDialogUrlAberto(true)}>
            <Link2 className="h-4 w-4" />
            Adicionar URL
          </Button>
          <label>
            <Button variant="accent" size="sm" asChild>
              <span className="cursor-pointer">
                {uploadPdf.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Enviar PDF
              </span>
            </Button>
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={aoEscolherPdf}
              disabled={uploadPdf.isPending}
            />
          </label>
        </div>
      </div>

      {erro && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {erro}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando documentos...
        </div>
      ) : !documentos || documentos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Nenhum documento na base de conhecimento ainda. Envie um PDF ou adicione uma URL pra
          começar.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {documentos.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                  {doc.origem === 'pdf' ? (
                    <FileText className="h-4 w-4" />
                  ) : (
                    <Globe className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{doc.titulo}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3 text-online" />
                    {doc._count.chunks} trecho{doc._count.chunks !== 1 ? 's' : ''} indexado
                    {doc._count.chunks !== 1 ? 's' : ''}
                    {doc.urlOrigem && ` · ${doc.urlOrigem}`}
                  </p>
                </div>
              </div>

              {confirmandoExclusaoId === doc.id ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-200 text-red-700 hover:bg-red-50"
                    onClick={() => {
                      deletar.mutate(doc.id);
                      setConfirmandoExclusaoId(null);
                    }}
                  >
                    Confirmar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmandoExclusaoId(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmandoExclusaoId(doc.id)}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-700"
                  title="Remover da base"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogUrlAberto} onOpenChange={setDialogUrlAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar URL</DialogTitle>
            <DialogDescription>
              O conteúdo de texto da página é extraído e indexado — funciona melhor com páginas
              de texto simples (FAQ, política de vendas), não com sites muito visuais.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="titulo-url">Título</Label>
              <Input
                id="titulo-url"
                value={tituloUrl}
                onChange={(e) => setTituloUrl(e.target.value)}
                placeholder="Ex: Perguntas frequentes sobre financiamento"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="url-valor">URL</Label>
              <Input
                id="url-valor"
                value={urlValor}
                onChange={(e) => setUrlValor(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogUrlAberto(false)} disabled={ingerirUrl.isPending}>
              Cancelar
            </Button>
            <Button
              variant="accent"
              onClick={enviarUrl}
              disabled={ingerirUrl.isPending || !tituloUrl.trim() || !urlValor.trim()}
            >
              {ingerirUrl.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
