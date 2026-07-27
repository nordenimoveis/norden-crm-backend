'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCorretores } from '@/hooks/use-corretores';
import { useTransferirLead } from '@/hooks/use-transferir-lead';
import { Loader2 } from 'lucide-react';

export function TransferirCorretorSelect({ leadId, corretorAtualId }: { leadId: string; corretorAtualId: string | null }) {
  const { data: corretores, isLoading } = useCorretores(true);
  const { mutate: transferir, isPending } = useTransferirLead();

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <Select
        value={corretorAtualId ?? undefined}
        onValueChange={(novoCorretorId) => transferir({ leadId, corretorId: novoCorretorId })}
      >
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue placeholder="Sem corretor" />
        </SelectTrigger>
        <SelectContent>
          {!isLoading &&
            corretores?.map((corretor) => (
              <SelectItem key={corretor.id} value={corretor.id}>
                {corretor.nome}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}
