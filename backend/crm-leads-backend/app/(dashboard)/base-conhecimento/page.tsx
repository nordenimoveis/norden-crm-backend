'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldOff } from 'lucide-react';
import { BaseConhecimentoView } from '@/components/base-conhecimento/base-conhecimento-view';
import { useAuthStore } from '@/store/auth-store';

export default function BaseConhecimentoPage() {
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

  return <BaseConhecimentoView />;
}
