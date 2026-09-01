import { TriangleAlert } from "lucide-react";

// Faixa de motor parado. Mesmo lugar e mesmo peso da faixa de WhatsApp
// desconectado, e pelo mesmo motivo: sem o motor de automação, mensagem
// nenhuma sai.
//
// Por que isto precisa existir: não há pg_cron neste projeto, então um único
// processo (o worker) planeja e envia TUDO que é automático. Quando ele para,
// a tela ficava idêntica à de uma clínica saudável: a régua aparecia "ligada",
// as consultas apareciam "pendentes" (que também é o estado normal de um toque
// que ainda não venceu) e "Cobrar agora" respondia com sucesso. A clínica só
// descobria pelo paciente que faltou.
//
// A linguagem é de recepcionista: quem lê não precisa saber o que é um worker,
// precisa saber que as mensagens não estão saindo e que isso é com o suporte.
export function MotorBanner({ desde }: { desde: string | null }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm font-medium [color:var(--on-alert)] [background:var(--alert)]"
    >
      <TriangleAlert strokeWidth={1.5} className="size-4 shrink-0" />
      <span>
        As mensagens automáticas estão paradas
        {desde ? `, desde ${desde}` : ""}: nada está sendo enviado nem recebido
        pela agenda
      </span>
      <span className="text-xs opacity-90">
        Avise o suporte. Confirmações e lembretes voltam sozinhos assim que o
        sistema religar.
      </span>
    </div>
  );
}
