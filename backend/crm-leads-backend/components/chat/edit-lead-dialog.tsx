'use client';

import { useEffect, useState } from 'react';
import { Loader2, CalendarClock } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAtualizarLead } from '@/hooks/use-atualizar-lead';
import { LeadDetalhado, TipoAgendamento, ROTULO_TIPO_AGENDAMENTO } from '@/lib/types';

function paraDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const data = new Date(iso);
  const offset = data.getTimezoneOffset() * 60000;
  return new Date(data.getTime() - offset).toISOString().slice(0, 16);
}

export function EditLeadDialog({
  lead,
  aberto,
  onFechar,
}: {
  lead: LeadDetalhado;
  aberto: boolean;
  onFechar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [dataAgendamento, setDataAgendamento] = useState('');
  const [tipoAgendamento, setTipoAgendamento] = useState<TipoAgendamento | ''>('');
  const [erro, setErro] = useState<string | null>(null);

  const atualizar = useAtualizarLead(lead.id);

  useEffect(() => {
    if (!aberto) return;
    setNome(lead.nome ?? '');
    setTelefone(lead.telefone);
    setEmail(lead.email ?? '');
    setDataAgendamento(paraDatetimeLocal(lead.dataAgendamento));
    setTipoAgendamento(lead.tipoAgendamento ?? '');
    setErro(null);
  }, [aberto, lead]);

  async function salvar() {
    setErro(null);
    try {
      await atualizar.mutateAsync({
        nome: nome.trim() || undefined,
        telefone: telefone.trim(),
        email: email.trim() || undefined,
        dataAgendamento: dataAgendamento ? new Date(dataAgendamento).toISOString() : null,
        tipoAgendamento: dataAgendamento ? (tipoAgendamento || 'visita') : null,
      });
      onFechar();
    } catch {
      setErro('Não foi possível salvar. Confira se o telefone/e-mail estão em um formato válido.');
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar lead</DialogTitle>
          <DialogDescription>Corrige os dados básicos de contato.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-nome">Nome</Label>
            <Input id="edit-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-telefone">Telefone</Label>
            <Input id="edit-telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Formato internacional, ex: +5548999999999. Mudar isso não altera o histórico de
              mensagens já trocadas, mas passa a valer para os próximos envios.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-email">E-mail</Label>
            <Input id="edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-agendamento" className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              Próximo compromisso
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                id="edit-agendamento"
                type="datetime-local"
                value={dataAgendamento}
                onChange={(e) => setDataAgendamento(e.target.value)}
              />
              <Select
                value={tipoAgendamento || 'visita'}
                onValueChange={(v) => setTipoAgendamento(v as TipoAgendamento)}
                disabled={!dataAgendamento}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROTULO_TIPO_AGENDAMENTO).map(([valor, rotulo]) => (
                    <SelectItem key={valor} value={valor}>
                      {rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Aparece na aba "Agenda" — independente da coluna do Kanban em que o lead está.
              Deixe a data em branco pra remover um compromisso já marcado.
            </p>
          </div>

          {erro && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={atualizar.isPending}>
            Cancelar
          </Button>
          <Button variant="accent" onClick={salvar} disabled={atualizar.isPending || !telefone.trim()}>
            {atualizar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
