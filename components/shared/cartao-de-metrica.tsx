import { useId, type ReactNode } from "react";
import { Minus, OctagonAlert, TrendingDown, TrendingUp } from "lucide-react";

import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Skeleton } from "@/components/ui/skeleton";
import {
  STATUS_TONE_VARS,
  type StatusIcon,
  type StatusTone,
} from "@/lib/design/status";
import {
  descreverVariacao,
  type EntradaDaVariacao,
} from "@/lib/domain/variacao";
import { cn } from "@/lib/utils";

// O cartao de metrica unico do produto, na receita do StatCard do Conduzza
// Design System com os desvios do docs/06 (4.7, C3, C12, C13, C17, C18, D16).
// Substitui o CartaoKpi, o cartao de Confirmacoes, o CartaoIndicador de
// Pacientes e os ladrilhos da regua. Server Component: sem estado, sem
// evento (o DisabledWithHint e um filho client).
//
// Anatomia:
// - raiz role="group" com aria-labelledby no eyebrow: o nome do grupo e o
//   rotulo (o e2e acha o cartao por getByRole("group", { name }));
// - eyebrow: span FILHO DIRETO da raiz, com o texto como no direto e o icone
//   DENTRO dele (o e2e de Pacientes sobe um nivel a partir do texto);
// - linha do numero com flex-wrap: valor longo quebra a variacao para baixo
//   em vez de estourar o cartao a 1366px;
// - variacao a direita, nas 3 camadas (icone de tendencia, texto, cor pela
//   POLARIDADE); a parte visivel e aria-hidden e a frase falada vai em
//   sr-only ("subiu 12,4% vs. período anterior");
// - destaque: o lime da grade (um por grade, C17), sem sombra (C13), sem
//   icone (travado no tipo: o icone em ink sobre o lime seria o mesmo icone
//   em outra cor, C18), texto em primary-foreground CHEIO (C3) e a variacao
//   numa pilula bg-card com a cor da polaridade (D16: success-700 direto no
//   lime da 4,29:1 e reprova AA).

export type { Polaridade } from "@/lib/domain/variacao";

/** Variacao da metrica: o par bruto e a frase de comparacao. */
export type VariacaoDaMetrica = EntradaDaVariacao;

type Casca = {
  /** Texto puro: e o eyebrow e o nome acessivel do grupo. */
  rotulo: string;
  /**
   * Linha de 12px embaixo ("87,2% do total", "Último disparo 09:02").
   * Convive com a variacao. No estado sem-acesso, nunca ponha o valor aqui.
   */
  rodape?: ReactNode;
  /** lg = numero de 34px (padrao); md = 24px (ladrilho da regua, ficha). */
  tamanho?: "lg" | "md";
  /**
   * Acao dentro do cartao (o "Cobrar" de Confirmacoes), ja montada pela tela
   * com a regra de permissao (DisabledWithHint) e variante outline (C17).
   */
  acao?: ReactNode;
  /**
   * Complemento logo abaixo da linha do numero, antes do rodape (a barra de
   * comparecimento da ficha do paciente).
   */
  children?: ReactNode;
  className?: string;
};

type Aparencia =
  | {
      destaque?: false;
      /** Lucide de 16px dentro do eyebrow. */
      icone?: StatusIcon;
      /**
       * So quando o cartao E um status (Aguardando = warning, Canceladas =
       * alert): o icone ganha a cor do tom. Sem tom, text-text-secondary.
       */
      tom?: StatusTone;
      /**
       * "afundado": dentro de outro cartao (regua, aba IA), sem borda e sem
       * sombra, rounded-xl bg-surface-4 p-3.5.
       */
      variante?: "cartao" | "afundado";
    }
  | {
      /** O lime da grade: no maximo um por grade e um por tela (C17). */
      destaque: true;
      icone?: never;
      tom?: never;
      variante?: "cartao";
    };

type Conteudo =
  | {
      estado?: "valor";
      /** Ja formatado em pt-BR: "1.248", "64,2", "R$ 284 mil". */
      valor: string;
      /**
       * O que o leitor de tela le no lugar do valor visivel, quando os dois
       * diferem (compacto "R$ 284 mil" e cheio "R$ 284.000,00").
       */
      valorFalado?: string;
      /** Qualificador de 13px separado do numero ("%", "min"). */
      unidade?: string;
      /** null ou ausente = sem linha de variacao. */
      variacao?: VariacaoDaMetrica | null;
    }
  | {
      /** A medida existe mas nao ha denominador no recorte. */
      estado: "vazio";
      /** Padrao "Sem dados". */
      texto?: string;
    }
  | {
      /** A medida ainda nao existe (IA, Fase 4): "Ainda não medido". */
      estado: "nao-medido";
      /** O porque, na dica do DisabledWithHint. */
      dica: string;
    }
  | {
      /** Papel sem acesso ao valor (reais so admin e gestor). Sem numero. */
      estado: "sem-acesso";
      dica: string;
    }
  | { estado: "carregando" }
  | {
      estado: "erro";
      /** Padrao "Não foi possível carregar". */
      texto?: string;
      /** Botao "Tentar de novo" montado pela tela. */
      tentarDeNovo?: ReactNode;
    };

export type CartaoDeMetricaProps = Casca & Aparencia & Conteudo;

const COR_DA_VARIACAO = {
  boa: "text-success-text",
  ruim: "text-alert-text",
  neutra: "text-neutral-text",
} as const;

export function CartaoDeMetrica(props: CartaoDeMetricaProps) {
  const { rotulo, rodape, tamanho = "lg", acao, children, className } = props;
  const idDoRotulo = useId();
  const destaque = props.destaque === true;
  const afundado = !destaque && props.variante === "afundado";
  const Icone = props.destaque ? undefined : props.icone;
  const tom = props.destaque ? undefined : props.tom;
  const estado = props.estado ?? "valor";
  const grande = tamanho === "lg";

  // Texto secundario: no lime e o ink cheio (C3), fora dele o secundario.
  const secundario = destaque
    ? "text-primary-foreground"
    : "text-text-secondary";
  // Campo sem numero: escrito na altura do numero, para a grade nao pular.
  const campoDeTexto = cn(
    "flex items-end text-base leading-tight font-semibold",
    grande ? "min-h-[34px]" : "min-h-6",
    secundario,
  );

  let corpo: ReactNode = null;
  let semBase: string | null = null;

  if (props.estado === undefined || props.estado === "valor") {
    const descrita = props.variacao ? descreverVariacao(props.variacao) : null;
    let variacao: ReactNode = null;
    if (descrita?.semBase) {
      semBase = descrita.texto;
    } else if (descrita) {
      const IconeDaTendencia =
        descrita.sentido === "subiu"
          ? TrendingUp
          : descrita.sentido === "caiu"
            ? TrendingDown
            : Minus;
      const cor =
        descrita.boa === null
          ? COR_DA_VARIACAO.neutra
          : descrita.boa
            ? COR_DA_VARIACAO.boa
            : COR_DA_VARIACAO.ruim;
      variacao = (
        <span
          data-parte="variacao"
          data-sentido={descrita.sentido}
          className={cn(
            "ml-auto inline-flex items-center gap-0.5 cz-num text-xs font-semibold whitespace-nowrap",
            cor,
            destaque && "h-6 rounded-full bg-card px-2",
          )}
        >
          <span aria-hidden className="inline-flex items-center gap-0.5">
            <IconeDaTendencia className="size-[13px] shrink-0" />
            {descrita.visivel}
          </span>
          <span className="sr-only">{descrita.falado}</span>
        </span>
      );
    }
    // leading-none DEPOIS do tamanho: o twMerge apaga o leading que vem
    // antes de um text-[tamanho] (no Tailwind v4 o tamanho traz altura de
    // linha).
    // Mono de 34px: acima de 9 caracteres ("R$ 45,3 mil", "R$ 9.850,00",
    // ~217px) o valor passa da borda na grade de 5 (~195px uteis a 1366);
    // 28px da ~179px. Contagens ("1.248") continuam em 34px.
    const longo = grande && Array.from(props.valor).length > 9;
    const classeDoValor = cn(
      "cz-num font-semibold",
      grande ? (longo ? "text-[28px]" : "text-[34px]") : "text-2xl",
      "leading-none",
      destaque ? "text-primary-foreground" : "text-text-strong",
    );
    corpo = (
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        {props.valorFalado ? (
          <>
            <span aria-hidden className={classeDoValor}>
              {props.valor}
            </span>
            <span className="sr-only">{props.valorFalado}</span>
          </>
        ) : (
          <span className={classeDoValor}>{props.valor}</span>
        )}
        {props.unidade ? (
          <span className={cn("text-[13px] font-semibold", secundario)}>
            {props.unidade}
          </span>
        ) : null}
        {variacao}
      </div>
    );
  } else if (props.estado === "vazio") {
    corpo = <span className={campoDeTexto}>{props.texto ?? "Sem dados"}</span>;
  } else if (props.estado === "nao-medido" || props.estado === "sem-acesso") {
    // Sem opacidade: o texto e a dica ja dizem o estado, e a opacidade
    // derrubaria o contraste. Visivel e desabilitado, nunca escondido.
    corpo = (
      <DisabledWithHint hint={props.dica}>
        <span className={campoDeTexto}>
          {props.estado === "nao-medido" ? "Ainda não medido" : "Sem acesso"}
        </span>
      </DisabledWithHint>
    );
  } else if (props.estado === "carregando") {
    corpo = (
      <>
        <Skeleton
          aria-hidden
          // Sobre o afundado (bg-surface-4) o esqueleto padrao some: sobe um
          // degrau, como o metricas-da-regua ja fazia.
          className={cn(
            "w-2/5",
            grande ? "h-[34px]" : "h-6",
            afundado && "bg-surface-5",
          )}
        />
        <span className="sr-only">Carregando</span>
      </>
    );
  } else if (props.estado === "erro") {
    // Erro nunca vira zero: o texto diz que falhou, com o icone de erro
    // (OctagonAlert e sempre alert, tabela de icones reservados). No lime a
    // mensagem vai na pilula bg-card, pela mesma razao da variacao (D16).
    corpo = (
      <div className="grid justify-items-start gap-2">
        <span
          className={cn("flex items-end", grande ? "min-h-[34px]" : "min-h-6")}
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-semibold text-alert-text",
              // Sem altura fixa: numa grade de 5 a mensagem quebra em duas
              // linhas e precisa continuar dentro do fundo bg-card.
              destaque && "min-h-6 rounded-xl bg-card px-2 py-0.5",
            )}
          >
            <OctagonAlert aria-hidden className="size-4 shrink-0" />
            {props.texto ?? "Não foi possível carregar"}
          </span>
        </span>
        {props.tentarDeNovo}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={idDoRotulo}
      aria-busy={estado === "carregando" ? true : undefined}
      data-estado={estado}
      className={cn(
        "grid min-w-0 content-start gap-2.5",
        destaque
          ? "rounded-card border border-transparent bg-primary p-4 text-primary-foreground shadow-none"
          : afundado
            ? "rounded-xl bg-surface-4 p-3.5"
            : "rounded-card border border-border bg-card p-4 shadow-sm",
        className,
      )}
    >
      <span
        id={idDoRotulo}
        className={cn(
          "flex items-center justify-between gap-2 cz-eyebrow",
          secundario,
        )}
      >
        {rotulo}
        {Icone ? (
          <Icone
            aria-hidden
            className={cn(
              "size-4 shrink-0",
              tom ? undefined : "text-text-secondary",
            )}
            style={tom ? { color: STATUS_TONE_VARS[tom].text } : undefined}
          />
        ) : null}
      </span>
      {corpo}
      {semBase ? (
        <span className={cn("text-xs", secundario)}>{semBase}</span>
      ) : null}
      {children}
      {rodape != null && rodape !== false ? (
        <div className={cn("text-xs", secundario)}>{rodape}</div>
      ) : null}
      {acao ? <div className="flex flex-wrap gap-2">{acao}</div> : null}
    </div>
  );
}
