import {
  CircleAlert,
  CircleCheck,
  Info,
  OctagonAlert,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

// Aviso fixo ligado a uma regiao da tela, no desenho do Banner do design
// system Conduzza (docs/06 secao 4.6). Diferencas conscientes do DS:
// - o corpo vai com a cor cheia da familia, sem a opacidade de 0,92 (no
//   warning ela derruba o texto para 3,98:1);
// - o icone padrao segue a tabela de icones reservados de lib/design/status:
//   atencao e CircleAlert (o TriangleAlert e so do status Faltou), erro e
//   OctagonAlert. O tom neutral nao tem icone padrao: quem chama escolhe;
// - "faixa" e a variante de ponta a ponta, sem raio e com fio embaixo, para
//   o topo da coluna de conteudo (WhatsApp desconectado, motor parado).
// A cor nunca vai sozinha: icone e texto acompanham sempre.

export type TomDoAviso =
  "info" | "success" | "warning" | "alert" | "neutral" | "ia";

const TONS: Record<
  TomDoAviso,
  { caixa: string; fio: string; icone: LucideIcon | null }
> = {
  info: { caixa: "bg-info-bg text-info-text", fio: "border-info", icone: Info },
  success: {
    caixa: "bg-success-bg text-success-text",
    fio: "border-success",
    icone: CircleCheck,
  },
  warning: {
    caixa: "bg-warning-bg text-warning-text",
    fio: "border-warning",
    icone: CircleAlert,
  },
  alert: {
    caixa: "bg-alert-bg text-alert-text",
    fio: "border-alert",
    icone: OctagonAlert,
  },
  neutral: {
    caixa: "bg-neutral-bg text-neutral-text",
    fio: "border-neutral",
    icone: null,
  },
  ia: { caixa: "bg-ai-bg text-ai-text", fio: "border-ai", icone: Sparkles },
};

type AvisoProps = {
  titulo?: string;
  /** Botao ou link de correcao, a direita */
  acao?: React.ReactNode;
  /** Mostra o X de dispensar (nome acessivel "Dispensar") */
  aoDispensar?: () => void;
  /** De ponta a ponta, sem raio, com fio embaixo (faixa do topo da tela) */
  faixa?: boolean;
  /**
   * "status" (padrao) anuncia mudanca sem interromper; "alert" interrompe e
   * fica para erro que pede acao agora; "note" e o aviso fixo que nao muda.
   */
  role?: "status" | "alert" | "note";
  children?: React.ReactNode;
  className?: string;
} & (
  | { tom: Exclude<TomDoAviso, "neutral">; icone?: LucideIcon }
  | { tom: "neutral"; icone: LucideIcon }
);

export function Aviso({
  tom,
  icone,
  titulo,
  acao,
  aoDispensar,
  faixa = false,
  role = "status",
  children,
  className,
}: AvisoProps) {
  const estilo = TONS[tom];
  const Icone = icone ?? estilo.icone;

  return (
    <div
      role={role}
      data-tom={tom}
      className={cn(
        "flex gap-[11px]",
        faixa
          ? cn("min-h-12 items-center border-b px-4 py-2 md:px-6", estilo.fio)
          : "items-start rounded-xl px-3.5 py-3",
        estilo.caixa,
        className,
      )}
    >
      {Icone ? (
        <Icone
          aria-hidden
          className={cn("size-[17px] shrink-0", !faixa && "mt-px")}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {titulo ? (
          <p className="text-[13.5px] leading-[1.35] font-bold">{titulo}</p>
        ) : null}
        {children ? (
          <div className="text-[13px] leading-[1.45]">{children}</div>
        ) : null}
      </div>
      {acao ? (
        <div className="flex shrink-0 items-center gap-2">{acao}</div>
      ) : null}
      {aoDispensar ? (
        <button
          type="button"
          onClick={aoDispensar}
          aria-label="Dispensar"
          className="hit-40 relative grid size-5 shrink-0 place-items-center rounded-sm cz-transition hover:bg-current/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
