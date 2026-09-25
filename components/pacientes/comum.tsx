import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  PATIENT_TAG,
  type PatientTag,
  type StatusIcon,
} from "@/lib/design/status";
import { porcentagemDeComparecimento } from "@/lib/domain/pacientes-ui";
import { cn } from "@/lib/utils";

// Pecas compartilhadas pela lista e pela ficha da Tela 9. Sem estado: rodam
// no servidor e dentro dos blocos de cliente sem "use client" proprio.

const FONTE_CONSENTIMENTO: Record<string, string> = {
  formulario_site: "Formulário do site",
  anuncio_ctwa: "Anúncio no WhatsApp",
  recepcao: "Recepção",
  importacao_planilha: "Planilha importada",
  conversa: "Conversa no WhatsApp",
};

/** Como a pessoa autorizou, em linguagem de recepcao. */
export function rotuloDaFonte(fonte: string): string {
  return FONTE_CONSENTIMENTO[fonte] ?? fonte;
}

/** Data e hora no fuso da clinica (regra 3.6): dd/mm/aaaa, hh:mm. */
export function dataHoraLocal(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Dia civil (aaaa-mm-dd) do banco em dd/mm/aaaa, sem passar por fuso. */
export function diaEmTexto(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split("-");
  return `${diaDoMes}/${mes}/${ano}`;
}

export function plural(
  quantidade: number,
  singular: string,
  pluralizado: string,
): string {
  return quantidade === 1 ? singular : pluralizado;
}

/**
 * Campo vazio pela receita 4.7 do docs/06: o texto do que falta, em tom
 * secundario, nunca hifen nem travessao (o mesmo texto vale para quem le e
 * para quem ouve). Taxa sem consulta nenhuma NAO e 0%: 0% leria como paciente
 * que nunca aparece.
 */
export function SemDado({
  texto,
  className,
}: {
  texto: string;
  className?: string;
}) {
  return <span className={cn("text-text-secondary", className)}>{texto}</span>;
}

/**
 * Percentual de comparecimento com barra fina. A barra e MAGNITUDE, nao
 * status: tom neutro de proposito, porque cor sozinha nunca comunica estado
 * (as 3 camadas moram nos chips de etiqueta). O numero continua escrito.
 */
export function BarraComparecimento({
  taxa,
  mostrarValor = true,
  tamanho = "sm",
  className,
}: {
  taxa: number | null;
  /** false quando o numero ja aparece maior ao lado, no cartao da ficha */
  mostrarValor?: boolean;
  /** sm (4px) na linha da tabela; md (7px) no cartao da ficha */
  tamanho?: "sm" | "md";
  className?: string;
}) {
  if (taxa === null) {
    return <SemDado texto="Ainda não medido" className="whitespace-nowrap" />;
  }
  const porcentagem = porcentagemDeComparecimento(taxa);
  return (
    <span className={cn("grid w-full max-w-[110px] gap-1", className)}>
      {mostrarValor ? (
        <span className="cz-num text-[13px] text-foreground">
          {porcentagem}
        </span>
      ) : null}
      <BarraDeProgresso
        valor={Math.round(taxa * 100)}
        maximo={100}
        tom="neutro"
        tamanho={tamanho}
        ariaLabel={`${porcentagem} de comparecimento`}
      />
    </span>
  );
}

/**
 * Barra de sessoes de um pacote: usadas contra contratadas. Pacote fora da
 * validade nao tem saldo para desenhar, entao a barra fica no trilho vazio e
 * quem le em voz alta ouve que venceu; o historico de uso continua em texto
 * na linha de baixo.
 */
export function BarraSessoes({
  usadas,
  total,
  vencida = false,
}: {
  usadas: number;
  total: number;
  vencida?: boolean;
}) {
  return (
    <BarraDeProgresso
      valor={vencida ? 0 : Math.min(usadas, total)}
      maximo={total}
      tom="neutro"
      ariaLabel={
        vencida
          ? "Pacote vencido, sem sessões para usar"
          : `${usadas} de ${total} ${plural(total, "sessão usada", "sessões usadas")}`
      }
    />
  );
}

/**
 * Bloco da ficha na casca do Card do design system: cabecalho com fio,
 * titulo a esquerda e acao a direita, corpo com padding proprio. Continua
 * section com h2 (o e2e acha o bloco pelo titulo).
 */
export function BlocoFicha({
  titulo,
  acao,
  children,
  className,
}: {
  titulo: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <h2 className="text-base leading-[1.3] font-bold tracking-[-0.01em]">
          {titulo}
        </h2>
        {acao}
      </div>
      <div className="grid gap-3 p-4">{children}</div>
    </section>
  );
}

/** Linha de rotulo e valor dos blocos de leitura da ficha (receita 4.7). */
export function LinhaDaFicha({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-2 text-[13px]">
      <span className="text-text-secondary">{rotulo}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </div>
  );
}

/**
 * Cartao de indicador na receita StatCard (docs/06 secao 4.7): rotulo em
 * eyebrow com o icone na mesma linha e o numero grande embaixo. O span do
 * rotulo e filho DIRETO do cartao e leva o icone dentro: o e2e acha o
 * cartao subindo um nivel a partir do texto do rotulo. Nunca e botao.
 */
export function CartaoIndicador({
  rotulo,
  icone: Icone,
  iconeClassName = "text-neutral",
  nota,
  children,
}: {
  rotulo: string;
  icone: StatusIcon;
  /** Cor do icone: neutra por padrao; a do tom quando o cartao E um status */
  iconeClassName?: string;
  nota?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 content-start gap-2.5 rounded-card border border-border bg-card p-4 shadow-sm">
      <span className="flex items-center justify-between gap-2 cz-eyebrow text-text-secondary">
        {rotulo}
        <Icone aria-hidden className={cn("size-4 shrink-0", iconeClassName)} />
      </span>
      {children}
      {nota ? <p className="text-xs text-text-secondary">{nota}</p> : null}
    </div>
  );
}

/**
 * Botao de acao da ficha com a regra do brief: sem permissao ele continua
 * visivel, desabilitado e com a dica do porque (nunca escondido). Altura de
 * 40px (alvo de toque, achado 76). Aceita qualquer variante do Button, ao
 * contrario do BotaoProtegido dos Cadastros (sem a destrutiva).
 */
export function AcaoProtegida({
  podeEditar,
  dica,
  onClick,
  variant = "outline",
  className,
  children,
}: {
  podeEditar: boolean;
  dica: string;
  onClick: () => void;
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
  children: React.ReactNode;
}) {
  if (podeEditar) {
    return (
      <Button variant={variant} className={className} onClick={onClick}>
        {children}
      </Button>
    );
  }
  return (
    <DisabledWithHint hint={dica}>
      <Button variant={variant} className={className} disabled>
        {children}
      </Button>
    </DisabledWithHint>
  );
}

/** Numero grande do cartao de indicador. */
export function ValorIndicador({ children }: { children: React.ReactNode }) {
  return (
    <span className="cz-num text-[34px] leading-none font-semibold text-text-strong">
      {children}
    </span>
  );
}

/** Chips das etiquetas derivadas, nas 3 camadas (forma, rotulo e cor). */
export function EtiquetasDoPaciente({
  etiquetas,
  tamanho = "md",
}: {
  etiquetas: PatientTag[];
  /** sm na linha da tabela; md no cabecalho da ficha */
  tamanho?: "sm" | "md";
}) {
  if (etiquetas.length === 0) {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {etiquetas.map((etiqueta) => (
        <StatusChip
          key={etiqueta}
          definition={PATIENT_TAG[etiqueta]}
          size={tamanho}
        />
      ))}
    </span>
  );
}
