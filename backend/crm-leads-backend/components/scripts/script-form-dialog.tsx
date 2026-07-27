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
import { useCriarQuickReply, useAtualizarQuickReply } from '@/hooks/use-quick-reply-mutations';
import { useAuthStore } from '@/store/auth-store';
import { QuickReply, QuickReplyTipo } from '@/lib/types';

export function ScriptFormDialog({
  aberto,
  onFechar,
  quickReplyEditando,
}: {
  aberto: boolean;
  onFechar: () => void;
  quickReplyEditando?: QuickReply | null;
}) {
  const usuario = useAuthStore((state) => state.usuario);
  const podeGlobal = usuario?.papel === 'gestor' || usuario?.papel === 'admin';

  const [titulo, setTitulo] = useState('');
  const [textoMensagem, setTextoMensagem] = useState('');
  const [tipo, setTipo] = useState<QuickReplyTipo>('pessoal');
  const [paraAvaliacaoGoogle, setParaAvaliacaoGoogle] = useState(false);

  const criar = useCriarQuickReply();
  const atualizar = useAtualizarQuickReply();
  const emAndamento = criar.isPending || atualizar.isPending;
  const estaEditando = !!quickReplyEditando;

  // Repopula o formulário sempre que o dialog abre (criação limpa, edição pré-preenchida)
  useEffect(() => {
    if (!aberto) return;
    setTitulo(quickReplyEditando?.titulo ?? '');
    setTextoMensagem(quickReplyEditando?.textoMensagem ?? '');
    setTipo(quickReplyEditando?.tipo ?? 'pessoal');
    setParaAvaliacaoGoogle(quickReplyEditando?.paraAvaliacaoGoogle ?? false);
  }, [aberto, quickReplyEditando]);

  async function salvar() {
    if (!titulo.trim() || !textoMensagem.trim()) return;

    if (estaEditando) {
      await atualizar.mutateAsync({
        id: quickReplyEditando!.id,
        input: { titulo, textoMensagem, paraAvaliacaoGoogle },
      });
    } else {
      await criar.mutateAsync({ titulo, textoMensagem, tipo });
    }

    onFechar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{estaEditando ? 'Editar script' : 'Novo script'}</DialogTitle>
          <DialogDescription>
            Modelos de mensagem usados no atalho <code className="rounded bg-muted px-1 py-0.5">/</code> do chat.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="titulo">Título</Label>
            <Input
              id="titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Envio de portfólio"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="texto">Texto da mensagem</Label>
            <Textarea
              id="texto"
              value={textoMensagem}
              onChange={(e) => setTextoMensagem(e.target.value)}
              placeholder="Ex: Olá {{lead_name}}, aqui é {{broker_name}} da Norden Imóveis..."
              rows={5}
            />
            <p className="text-xs text-muted-foreground">
              Variáveis disponíveis:{' '}
              <code className="rounded bg-muted px-1 py-0.5">{'{{lead_name}}'}</code> (nome do
              lead) e <code className="rounded bg-muted px-1 py-0.5">{'{{broker_name}}'}</code>{' '}
              (seu nome) — são substituídas automaticamente ao usar o script no chat.
            </p>
          </div>

          {/* Tipo só é escolhido na criação — depois de criado, é imutável (mesma regra do backend) */}
          {!estaEditando && (
            <div className="space-y-1.5">
              <Label>Visibilidade</Label>
              {podeGlobal ? (
                <Select value={tipo} onValueChange={(v) => setTipo(v as QuickReplyTipo)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pessoal">Pessoal — só eu vejo</SelectItem>
                    <SelectItem value="global">Global — toda a equipe vê</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Como corretor, seus scripts são sempre pessoais (só você vê). Scripts globais
                  são criados por gestor/admin.
                </p>
              )}
            </div>
          )}

          {/*
            Só faz sentido marcar isso em scripts GLOBAIS — a sugestão de
            avaliação aparece pra qualquer corretor que fechar um negócio,
            então precisa ser um script que todo mundo enxerga.
          */}
          {estaEditando && podeGlobal && quickReplyEditando?.tipo === 'global' && (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">Pedido de avaliação Google</p>
                <p className="text-xs text-muted-foreground">
                  Sugerido automaticamente quando um lead vira "Negócio Fechado" no Kanban.
                </p>
              </div>
              <Switch checked={paraAvaliacaoGoogle} onCheckedChange={setParaAvaliacaoGoogle} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={emAndamento}>
            Cancelar
          </Button>
          <Button variant="accent" onClick={salvar} disabled={emAndamento || !titulo.trim() || !textoMensagem.trim()}>
            {emAndamento && <Loader2 className="h-4 w-4 animate-spin" />}
            {estaEditando ? 'Salvar alterações' : 'Criar script'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
