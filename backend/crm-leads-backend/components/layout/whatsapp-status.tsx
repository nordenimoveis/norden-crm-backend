import { Badge } from '@/components/ui/badge';

/**
 * Indicador do status da conexão com o WhatsApp (Número Único — Fase 5).
 * Por enquanto recebe `online` via prop; na próxima fase isso deve vir de um
 * health-check real do backend (ex: consultar o status da Cloud API ou um
 * heartbeat do worker de cadência), não de um valor fixo.
 */
export function WhatsappStatus({ online = true }: { online?: boolean }) {
  return (
    <Badge variant={online ? 'online' : 'offline'}>
      <span className="relative flex h-1.5 w-1.5">
        <span
          className={
            online
              ? 'absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-online'
              : 'absolute inline-flex h-full w-full rounded-full bg-red-600'
          }
        />
      </span>
      {online ? 'WhatsApp conectado' : 'WhatsApp desconectado'}
    </Badge>
  );
}
