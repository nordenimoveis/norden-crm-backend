'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldOff } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TeamTab } from '@/components/settings/team-tab';
import { WhatsappTab } from '@/components/settings/whatsapp-tab';
import { useAuthStore } from '@/store/auth-store';

/**
 * RBAC estrito (Fase 10): diferente do padrão gestor+admin usado no resto do
 * sistema, esta tela é EXCLUSIVA de 'admin' — decisão explícita, já que lida
 * com criação de acessos e segurança da operação de WhatsApp. Um 'gestor'
 * autenticado não vê o item na Sidebar (ver components/layout/sidebar.tsx) e,
 * se navegar direto para a URL, cai neste guard.
 */
export default function ConfiguracoesPage() {
  const usuario = useAuthStore((state) => state.usuario);
  const router = useRouter();

  useEffect(() => {
    if (usuario && usuario.papel !== 'admin') {
      router.replace('/kanban');
    }
  }, [usuario, router]);

  if (!usuario || usuario.papel !== 'admin') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <ShieldOff className="h-5 w-5" />
          Você não tem acesso a esta área.
        </div>
      </div>
    );
  }

  return (
    <Tabs defaultValue="equipe">
      <TabsList>
        <TabsTrigger value="equipe">Gestão de Equipe</TabsTrigger>
        <TabsTrigger value="whatsapp">Motor e Segurança do WhatsApp</TabsTrigger>
      </TabsList>

      <TabsContent value="equipe">
        <TeamTab />
      </TabsContent>

      <TabsContent value="whatsapp">
        <WhatsappTab />
      </TabsContent>
    </Tabs>
  );
}
