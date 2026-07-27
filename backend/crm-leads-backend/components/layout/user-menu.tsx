'use client';

import { useRouter } from 'next/navigation';
import { LogOut, Settings, User } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore } from '@/store/auth-store';
import { removerCookieToken } from '@/lib/auth-cookie';

function iniciais(nome: string) {
  return nome
    .split(' ')
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase();
}

const rotuloPapel: Record<'gestor' | 'corretor' | 'admin', string> = {
  gestor: 'Gestor',
  admin: 'Administrador',
  corretor: 'Corretor',
};

export function UserMenu() {
  const usuario = useAuthStore((state) => state.usuario);
  const limparSessao = useAuthStore((state) => state.limparSessao);
  const router = useRouter();

  if (!usuario) return null;

  function sair() {
    removerCookieToken();
    limparSessao();
    router.replace('/login');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md p-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar>
          <AvatarFallback>{iniciais(usuario.nome)}</AvatarFallback>
        </Avatar>
        <div className="hidden text-left sm:block">
          <p className="text-sm font-medium leading-none">{usuario.nome}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{rotuloPapel[usuario.papel]}</p>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{usuario.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <User className="mr-2 h-4 w-4" />
          Meu perfil
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Settings className="mr-2 h-4 w-4" />
          Configurações
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={sair} className="text-red-600 focus:bg-red-50 focus:text-red-700">
          <LogOut className="mr-2 h-4 w-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
