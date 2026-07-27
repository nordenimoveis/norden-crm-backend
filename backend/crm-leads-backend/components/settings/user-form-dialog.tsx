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
import { useCriarUsuario } from '@/hooks/use-usuarios-admin';

export function UserFormDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [papel, setPapel] = useState<'corretor' | 'gestor' | 'admin'>('corretor');
  const [erro, setErro] = useState<string | null>(null);

  const criar = useCriarUsuario();

  function limparEfechar() {
    setNome('');
    setEmail('');
    setSenha('');
    setPapel('corretor');
    setErro(null);
    onFechar();
  }

  async function salvar() {
    setErro(null);
    try {
      await criar.mutateAsync({ nome, email, senha, papel });
      limparEfechar();
    } catch (err) {
      setErro('Não foi possível criar o usuário — verifique se o e-mail já está em uso.');
    }
  }

  const formularioValido = nome.trim() && email.trim() && senha.trim().length >= 8;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && limparEfechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo membro da equipe</DialogTitle>
          <DialogDescription>
            A senha definida aqui é temporária — oriente a pessoa a trocá-la no primeiro acesso.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nome">Nome</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ana Costa" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ana.costa@norden.com.br"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="senha">Senha temporária</Label>
            <Input
              id="senha"
              type="text"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Nível de acesso</Label>
            <Select value={papel} onValueChange={(v) => setPapel(v as typeof papel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="corretor">Corretor</SelectItem>
                <SelectItem value="gestor">Gestor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
            Criar acesso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
