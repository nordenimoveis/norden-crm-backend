'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';

const titulosPorRota: Record<string, string> = {
  '/kanban': 'Kanban',
  '/meus-leads': 'Meus Leads',
  '/scripts': 'Scripts',
  '/configuracoes': 'Configurações',
};

function tituloDaRota(pathname: string | null) {
  if (!pathname) return 'Norden CRM';
  const rotaBase = '/' + pathname.split('/')[1];
  return titulosPorRota[rotaBase] ?? 'Norden CRM';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar titulo={tituloDaRota(pathname)} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
