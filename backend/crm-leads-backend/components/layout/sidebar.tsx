'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  KanbanSquare,
  MessageCircle,
  Users,
  MessageSquareText,
  Megaphone,
  CalendarClock,
  BrainCircuit,
  Building2,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';
import { useAuthStore } from '@/store/auth-store';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const itensNavegacao = [
  { href: '/mensagens', label: 'Mensagens', icone: MessageCircle, somenteAdmin: false, somenteGestorOuAdmin: false },
  { href: '/kanban', label: 'Kanban', icone: KanbanSquare, somenteAdmin: false, somenteGestorOuAdmin: false },
  { href: '/meus-leads', label: 'Meus Leads', icone: Users, somenteAdmin: false, somenteGestorOuAdmin: false },
  { href: '/visitas', label: 'Agenda', icone: CalendarClock, somenteAdmin: false, somenteGestorOuAdmin: false },
  { href: '/scripts', label: 'Scripts', icone: MessageSquareText, somenteAdmin: false, somenteGestorOuAdmin: false },
  { href: '/imoveis', label: 'Catálogo de Imóveis', icone: Building2, somenteAdmin: false, somenteGestorOuAdmin: true },
  { href: '/base-conhecimento', label: 'Base de Conhecimento (IA)', icone: BrainCircuit, somenteAdmin: false, somenteGestorOuAdmin: true },
  // Disparo em massa é sensível — mesma régua do backend: gestor OU admin.
  { href: '/campanhas', label: 'Campanhas', icone: Megaphone, somenteAdmin: false, somenteGestorOuAdmin: true },
  // Fase 10: estritamente admin — mesma decisão de RBAC do backend/página.
  { href: '/configuracoes', label: 'Configurações', icone: Settings, somenteAdmin: true, somenteGestorOuAdmin: false },
] as const;

export function Sidebar() {
  const { sidebarRecolhida, alternarSidebar } = useUiStore();
  const usuario = useAuthStore((state) => state.usuario);

  const itensVisiveis = itensNavegacao.filter((item) => {
    if (item.somenteAdmin) return usuario?.papel === 'admin';
    if (item.somenteGestorOuAdmin) return usuario?.papel === 'gestor' || usuario?.papel === 'admin';
    return true;
  });

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          'flex h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out',
          sidebarRecolhida ? 'w-[68px]' : 'w-64'
        )}
      >
        {/* Wordmark */}
        <div className="flex h-16 items-center px-4">
          {sidebarRecolhida ? (
            <span className="font-display text-xl font-medium text-accent">N</span>
          ) : (
            <span className="font-display text-xl font-medium tracking-tight">
              Norden<span className="text-accent">.</span>
            </span>
          )}
        </div>

        <Separator />

        {/* Navegação */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {itensVisiveis.map((item) => (
            <ItemNavegacao key={item.href} item={item} recolhida={sidebarRecolhida} />
          ))}
        </nav>

        <Separator />

        {/* Toggle de recolher/expandir */}
        <div className="p-3">
          <button
            onClick={alternarSidebar}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-white/5 hover:text-sidebar-foreground"
          >
            {sidebarRecolhida ? (
              <PanelLeftOpen className="h-[18px] w-[18px] shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="h-[18px] w-[18px] shrink-0" />
                <span>Recolher menu</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}

function Separator() {
  return <div className="mx-3 h-px bg-sidebar-border" />;
}

type ItemNavegacaoProps = {
  item: (typeof itensNavegacao)[number];
  recolhida: boolean;
};

function ItemNavegacao({ item, recolhida }: ItemNavegacaoProps) {
  const pathname = usePathname();
  const ativo = pathname?.startsWith(item.href);
  const Icone = item.icone;

  const link = (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        ativo
          ? 'bg-white/[0.07] text-sidebar-foreground'
          : 'text-sidebar-muted hover:bg-white/5 hover:text-sidebar-foreground',
        recolhida && 'justify-center px-0'
      )}
    >
      <Icone className="h-[18px] w-[18px] shrink-0" strokeWidth={ativo ? 2.25 : 1.75} />
      {!recolhida && <span>{item.label}</span>}
      {ativo && !recolhida && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
    </Link>
  );

  if (!recolhida) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
