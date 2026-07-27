'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldOff } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CampanhasList } from '@/components/campanhas/campanhas-list';
import { TemplatesList } from '@/components/campanhas/templates-list';
import { useAuthStore } from '@/store/auth-store';

/**
 * RBAC: gestor/admin apenas — mesma régua do backend (disparo em massa e
 * templates são superfícies sensíveis, não é algo que todo corretor deveria
 * poder criar sozinho).
 */
export default function CampanhasPage() {
  const usuario = useAuthStore((state) => state.usuario);
  const router = useRouter();

  const temAcesso = usuario?.papel === 'gestor' || usuario?.papel === 'admin';

  useEffect(() => {
    if (usuario && !temAcesso) {
      router.replace('/kanban');
    }
  }, [usuario, temAcesso, router]);

  if (!usuario || !temAcesso) {
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
    <Tabs defaultValue="campanhas">
      <TabsList>
        <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
        <TabsTrigger value="templates">Templates</TabsTrigger>
      </TabsList>

      <TabsContent value="campanhas">
        <CampanhasList />
      </TabsContent>

      <TabsContent value="templates">
        <TemplatesList />
      </TabsContent>
    </Tabs>
  );
}
