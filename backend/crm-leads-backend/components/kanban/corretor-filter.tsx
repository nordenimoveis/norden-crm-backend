'use client';

import { useCorretores } from '@/hooks/use-corretores';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function FiltroCorretor({
  valor,
  onMudar,
}: {
  valor: string | undefined;
  onMudar: (corretorId: string | undefined) => void;
}) {
  const { data: corretores, isLoading } = useCorretores(true);

  return (
    <Select
      value={valor ?? 'todos'}
      onValueChange={(v) => onMudar(v === 'todos' ? undefined : v)}
    >
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Todos os corretores" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todos">Todos os corretores</SelectItem>
        {!isLoading &&
          corretores?.map((corretor) => (
            <SelectItem key={corretor.id} value={corretor.id}>
              {corretor.nome}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
