import {
  COR_DO_NUMERO_VARS,
  type CorDoNumero,
} from "@/lib/domain/cor-do-numero";
import { cn } from "@/lib/utils";

// Quadrado pequeno na cor do numero de WhatsApp (pedido do dono em
// 06/10/2026, whatsapp_account.cor). Decorativo: o nome do numero vem sempre
// escrito ao lado, e a cor nunca carrega sozinha o significado (regra 5).
// Sem cor (numero removido, ou "Todos" no filtro): cinza neutro.
export function MarcadorDoNumero({
  cor,
  className,
}: {
  cor: CorDoNumero | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-cor={cor ?? "nenhuma"}
      className={cn(
        "size-2 shrink-0 rounded-[2px]",
        cor ? undefined : "bg-border-strong",
        className,
      )}
      style={cor ? { background: COR_DO_NUMERO_VARS[cor].marcador } : undefined}
    />
  );
}
