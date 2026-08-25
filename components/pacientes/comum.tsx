import { StatusChip } from "@/components/shared/status-chip";
import { PATIENT_TAG, type PatientTag } from "@/lib/design/status";
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
 * Traco de "nao existe", com leitura em voz alta. Taxa sem consulta nenhuma
 * NAO e 0%: 0% leria como paciente que nunca aparece.
 */
export function SemDado({ leitura }: { leitura: string }) {
  return (
    <span className="text-text-tertiary">
      <span aria-hidden>-</span>
      <span className="sr-only">{leitura}</span>
    </span>
  );
}

/**
 * Percentual de comparecimento com barra fina. A barra e MAGNITUDE, nao
 * status: tom neutro de proposito, porque cor sozinha nunca comunica estado
 * (as 3 camadas moram nos chips de etiqueta).
 */
export function BarraComparecimento({
  taxa,
  mostrarValor = true,
  className,
}: {
  taxa: number | null;
  /** false quando o numero ja aparece maior ao lado, no cartao da ficha */
  mostrarValor?: boolean;
  className?: string;
}) {
  if (taxa === null) {
    return <SemDado leitura="Sem consulta registrada" />;
  }
  const porcentagem = porcentagemDeComparecimento(taxa);
  return (
    <span className={cn("grid w-full max-w-[110px] gap-1", className)}>
      {mostrarValor ? (
        <span className="font-mono text-[13px] tabular-nums">
          {porcentagem}
        </span>
      ) : null}
      <span
        role="img"
        aria-label={`${porcentagem} de comparecimento`}
        className="block h-1 overflow-hidden rounded-full bg-surface-4"
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: porcentagem,
            backgroundColor: "var(--neutral)",
          }}
        />
      </span>
    </span>
  );
}

/** Barra de sessoes de um pacote: usadas contra contratadas. */
export function BarraSessoes({
  usadas,
  total,
}: {
  usadas: number;
  total: number;
}) {
  const proporcao = total > 0 ? Math.min(usadas / total, 1) : 0;
  return (
    <span
      role="img"
      aria-label={`${usadas} de ${total} ${plural(total, "sessão usada", "sessões usadas")}`}
      className="block h-1.5 overflow-hidden rounded-full bg-surface-4"
    >
      <span
        className="block h-full rounded-full"
        style={{
          width: `${Math.round(proporcao * 100)}%`,
          backgroundColor: "var(--neutral)",
        }}
      />
    </span>
  );
}

/** Bloco da ficha: um assunto por caixa, titulo a esquerda e acao a direita. */
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
    <section className={cn("grid gap-3 rounded-lg border p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

/** Linha de rotulo e valor dos blocos de leitura da ficha. */
export function LinhaDaFicha({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-2 text-sm">
      <span className="text-text-tertiary">{rotulo}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** Chips das etiquetas derivadas, nas 3 camadas (forma, rotulo e cor). */
export function EtiquetasDoPaciente({
  etiquetas,
}: {
  etiquetas: PatientTag[];
}) {
  if (etiquetas.length === 0) {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {etiquetas.map((etiqueta) => (
        <StatusChip key={etiqueta} definition={PATIENT_TAG[etiqueta]} />
      ))}
    </span>
  );
}
