import { WhatsappStatus } from './whatsapp-status';
import { UserMenu } from './user-menu';

export function Topbar({ titulo }: { titulo: string }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background px-6">
      <h1 className="font-display text-lg font-medium tracking-tight text-foreground">{titulo}</h1>

      <div className="flex items-center gap-4">
        <WhatsappStatus online />
        <div className="h-6 w-px bg-border" />
        <UserMenu />
      </div>
    </header>
  );
}
