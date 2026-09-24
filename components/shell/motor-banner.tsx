import { OctagonAlert } from "lucide-react";

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
//
// Visual do Conduzza Design System (docs/06 secao 5.1, conflito C22): fundo
// de alerta suave, texto de alerta, fio vermelho embaixo e OctagonAlert
// (erro ou falha, na tabela de ícones reservados). Sem opacidade no texto.
export function MotorBanner({ desde }: { desde: string | null }) {
  return (
    <div
      role="alert"
      className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-alert bg-alert-bg px-4 py-2 text-alert-text md:px-6"
    >
      <OctagonAlert aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 text-[13.5px] font-semibold">
        As mensagens automáticas estão paradas
        {desde ? `, desde ${desde}` : ""}: nada está sendo enviado nem recebido
        pela agenda.{" "}
        <span className="font-normal">
          Avise o suporte. Confirmações e lembretes voltam sozinhos assim que o
          sistema religar.
        </span>
      </p>
    </div>
  );
}
