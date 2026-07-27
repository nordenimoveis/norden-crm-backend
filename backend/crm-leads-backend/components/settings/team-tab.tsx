'use client';

import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useTodosUsuarios, useAtualizarUsuario } from '@/hooks/use-usuarios-admin';
import { UserFormDialog } from './user-form-dialog';
import { cn } from '@/lib/utils';

const ROTULO_PAPEL: Record<string, string> = {
  admin: 'Admin',
  gestor: 'Gestor',
  corretor: 'Corretor',
};

export function TeamTab() {
  const { data: usuarios, isLoading } = useTodosUsuarios();
  const { mutate: atualizar, isPending, variables } = useAtualizarUsuario();
  const [dialogAberto, setDialogAberto] = useState(false);

  function alternarAtivo(id: string, ativoAtual: boolean) {
    atualizar({ id, input: { ativo: !ativoAtual } });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Desativar um acesso não apaga o histórico de mensagens da pessoa — a conta só para de
          conseguir entrar no painel.
        </p>
        <Button variant="accent" size="sm" onClick={() => setDialogAberto(true)}>
          <Plus className="h-4 w-4" />
          Novo membro
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando equipe...
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Nível</TableHead>
              <TableHead>Ativo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usuarios?.map((usuario) => {
              const alterando = isPending && variables?.id === usuario.id;

              return (
                <TableRow key={usuario.id}>
                  <TableCell className={cn('font-medium', !usuario.ativo && 'text-muted-foreground')}>
                    {usuario.nome}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{usuario.email}</TableCell>
                  <TableCell className="text-muted-foreground">{ROTULO_PAPEL[usuario.papel]}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={usuario.ativo}
                        disabled={alterando}
                        onCheckedChange={() => alternarAtivo(usuario.id, usuario.ativo)}
                      />
                      {alterando && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <UserFormDialog aberto={dialogAberto} onFechar={() => setDialogAberto(false)} />
    </div>
  );
}
