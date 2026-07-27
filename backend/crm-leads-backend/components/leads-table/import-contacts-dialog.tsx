'use client';

import { useState, useRef } from 'react';
import { Upload, Loader2, CheckCircle2, FileWarning } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { importarContatos, ResultadoImportacao } from '@/lib/contatos-api';
import { useQueryClient } from '@tanstack/react-query';

export function ImportContactsDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  function limparEfechar() {
    setArquivo(null);
    setResultado(null);
    setErro(null);
    setImportando(false);
    onFechar();
  }

  async function importar() {
    if (!arquivo) return;
    setImportando(true);
    setErro(null);

    try {
      const res = await importarContatos(arquivo);
      setResultado(res);
      // Atualiza as listas de leads (tabela e board) com os novos contatos
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setImportando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && limparEfechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar contatos</DialogTitle>
          <DialogDescription>
            Envie uma planilha (.xlsx ou .csv) com as colunas <strong>Nome</strong>,{' '}
            <strong>Telefone</strong> e <strong>Email</strong>.
          </DialogDescription>
        </DialogHeader>

        {/* Estado inicial: seleção de arquivo */}
        {!resultado && (
          <div className="space-y-4">
            <button
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-sm text-muted-foreground transition-colors hover:bg-muted/60"
            >
              <Upload className="h-6 w-6" />
              {arquivo ? (
                <span className="font-medium text-foreground">{arquivo.name}</span>
              ) : (
                <span>Clique para escolher a planilha</span>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />

            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Os contatos importados <strong>não</strong> entram na distribuição automática nem
              recebem mensagens sozinhos — ficam disponíveis para você usar em campanhas.
            </div>

            {erro && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {erro}
              </p>
            )}
          </div>
        )}

        {/* Estado final: resumo do resultado */}
        {resultado && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-online">
              <CheckCircle2 className="h-5 w-5" />
              Importação concluída
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <ResumoItem rotulo="Linhas na planilha" valor={resultado.totalLinhas} />
              <ResumoItem rotulo="Importados" valor={resultado.importados} destaque />
              <ResumoItem rotulo="Duplicados (ignorados)" valor={resultado.duplicados} />
              <ResumoItem rotulo="Inválidos (pulados)" valor={resultado.invalidos} />
            </div>

            {resultado.exemplosInvalidos.length > 0 && (
              <div className="rounded-md bg-amber-50 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-800">
                  <FileWarning className="h-3.5 w-3.5" />
                  Algumas linhas foram puladas:
                </div>
                <ul className="space-y-0.5 text-xs text-amber-700">
                  {resultado.exemplosInvalidos.map((ex, i) => (
                    <li key={i}>
                      Linha {ex.linha}: {ex.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {!resultado ? (
            <>
              <Button variant="outline" onClick={limparEfechar} disabled={importando}>
                Cancelar
              </Button>
              <Button variant="accent" onClick={importar} disabled={!arquivo || importando}>
                {importando && <Loader2 className="h-4 w-4 animate-spin" />}
                Importar
              </Button>
            </>
          ) : (
            <Button variant="accent" onClick={limparEfechar}>
              Concluir
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResumoItem({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={destaque ? 'text-lg font-semibold text-online' : 'text-lg font-semibold text-foreground'}>
        {valor}
      </p>
    </div>
  );
}
