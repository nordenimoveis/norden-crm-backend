'use client';

import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCriarLeadManual } from '@/hooks/use-criar-lead-manual';
import { useCorretores } from '@/hooks/use-corretores';
import { useAuthStore } from '@/store/auth-store';

export function NovoLeadDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const usuario = useAuthStore((state) => state.usuario);
  const ehGestorOuAdmin = usuario?.papel === 'gestor' || usuario?.papel === 'admin';

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [corretorId, setCorretorId] = useState<string>('');
  const [erro, setErro] = useState<string | null>(null);

  // Só busca a lista de corretores se for gestor/admin (corretor não escolhe, vai pra si mesmo)
  const { data: corretores } = useCorretores(ehGestorOuAdmin);
  const criar = useCriarLeadManual();

  function limparEfechar() {
    setNome('');
    setTelefone('');
    setEmail('');
    setCorretorId('');
    setErro(null);
    onFechar();
  }

  async function salvar() {
    setErro(null);
    try {
      await criar.mutateAsync({
        nome,
        telefone,
        email: email.trim() || undefined,
        // Corretor cadastra e o lead já fica com ele; gestor/admin escolhe
        // (ou deixa em branco pra cair no round-robin normal).
        corretorId: ehGestorOuAdmin ? corretorId || undefined : usuario?.id,
      });
      limparEfechar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const formularioValido = nome.trim() && telefone.trim().length >= 8;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && limparEfechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
          <DialogDescription>
            Para contatos que chegaram por telefone, indicação, ou presencialmente — não dispara
            nenhuma mensagem automática, só registra o lead no sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="novo-lead-nome">Nome</Label>
            <Input id="novo-lead-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="novo-lead-telefone">Telefone</Label>
            <Input
              id="novo-lead-telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="+5548999999999"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="novo-lead-email">E-mail (opcional)</Label>
            <Input
              id="novo-lead-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {ehGestorOuAdmin && (
            <div className="space-y-1.5">
              <Label>Corretor</Label>
              <Select value={corretorId} onValueChange={setCorretorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Distribuir automaticamente" />
                </SelectTrigger>
                <SelectContent>
                  {corretores?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {erro && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={limparEfechar} disabled={criar.isPending}>
            Cancelar
          </Button>
          <Button variant="accent" onClick={salvar} disabled={!formularioValido || criar.isPending}>
            {criar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
