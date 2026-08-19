import { TriangleAlert } from "lucide-react";
import Link from "next/link";

// Estado 5 da secao 8 do brief: WhatsApp desconectado e uma faixa vermelha
// fixa no topo de TODAS as telas, com acao de reconexao. So aparece quando a
// clinica TEM conta e ela nao esta conectada; clinica sem conta ve o convite
// de conexao no vazio do Atendimento.
export function WhatsappBanner() {
  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium [color:var(--on-alert)] [background:var(--alert)]"
    >
      <TriangleAlert strokeWidth={1.5} className="size-4 shrink-0" />
      <span>WhatsApp desconectado: os pacientes não estão sendo atendidos</span>
      <Link
        href="/whatsapp"
        className="rounded-md bg-black/15 px-2.5 py-1 text-xs font-semibold underline-offset-2 hover:underline"
      >
        Reconectar
      </Link>
    </div>
  );
}
