"use client";

import { ScanText } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

import type { LeituraDaMidiaNaTela } from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// [AG6b mídia] (arquivo novo da AG6b; desenho da AG6b, secao 6, e D-99 pela
// recomendacao, pendente do dono)
//
// O que o assistente entendeu da midia que o paciente mandou, embaixo da
// bolha, para a equipe (o paciente nunca ve):
// - audio: "Transcrição do assistente: {texto}", com "ver mais" e "ver
//   menos" (o padrao da transcricao antiga, line-clamp-2 e alvo de 40px; o
//   "ver mais" so quando o texto passa das duas linhas, revisao das telas
//   da AG6b); o audio sem fala: "Transcrição do assistente: não deu para
//   entender fala neste áudio.";
// - foto e documento: "Lido pelo assistente: {resumo}." com o ScanText no
//   tom ia (dono novo e unico desta linha, conferido em 30/10/2026 que
//   ninguem usava; tests/unit/design/icones-ag6b.test.ts); a figurinha nao
//   tem linha;
// - a consulta que falhou: "Leitura do assistente indisponível agora." na
//   linha da midia (carregando e vazio: nada). A falha tecnica da IA nao
//   aparece aqui: o evento da passagem diz.
// A transcricao antiga da uazapi (message.transcript) continua na bolha como
// "Transcrição:", sem mudanca. Nada daqui vai para log: e dado de saude.
//
// Dentro da bolha, a cor de apoio e a da pele (--bolha-meta), como a hora e
// a legenda; o icone usa o tom ia (lime) para dizer "foi o assistente", com
// o texto sempre junto (nunca so a cor).

export const TEXTOS_DA_LEITURA = {
  transcricao: "Transcrição do assistente:",
  semFala: "não deu para entender fala neste áudio.",
  lido: "Lido pelo assistente:",
  indisponivel: "Leitura do assistente indisponível agora.",
  verMais: "ver mais",
  verMenos: "ver menos",
} as const;

/** A linha que a leitura vira na bolha, ou null (sem linha). */
export type LinhaDaLeitura =
  | { tipo: "transcricao"; texto: string }
  | { tipo: "sem_fala" }
  | { tipo: "lido"; resumo: string };

/**
 * Puro, para o teste: o audio transcrito, o audio sem fala e o resumo do
 * arquivo. A figurinha, o tipo desconhecido e o resumo vazio nao tem linha.
 */
export function linhaDaLeitura(
  leitura: LeituraDaMidiaNaTela | null | undefined,
): LinhaDaLeitura | null {
  if (!leitura) {
    return null;
  }
  if (leitura.midia === "audio") {
    const texto = leitura.transcricao?.trim();
    if (leitura.tipo === "transcricao" && texto) {
      return { tipo: "transcricao", texto };
    }
    return leitura.tipo === "sem_fala" ? { tipo: "sem_fala" } : null;
  }
  if (leitura.tipo === "figurinha") {
    return null;
  }
  const resumo = leitura.resumo?.trim();
  return resumo ? { tipo: "lido", resumo } : null;
}

/** "pedido com Hemograma" vira "pedido com Hemograma." (sem dobrar o ponto). */
export function comPontoFinal(texto: string): string {
  return /[.!?]$/.test(texto) ? texto : `${texto}.`;
}

const ROTULO = "text-(--bolha-meta)";

/**
 * Quantos caracteres (o rotulo e a transcricao) cabem nas duas linhas da
 * bolha mais estreita (o celular), antes de medir. So decide o primeiro
 * desenho (e o HTML do servidor, que nao mede nada); no navegador, quem
 * decide e a medida (o mesmo molde do "Ver tudo" das mensagens agendadas).
 */
export const CARACTERES_DE_DUAS_LINHAS_NA_BOLHA = 90;

/** A transcricao provavelmente passa das duas linhas (antes de medir)? */
export function transcricaoPareceLonga(texto: string): boolean {
  return (
    `${TEXTOS_DA_LEITURA.transcricao} ${texto}`.length >
      CARACTERES_DE_DUAS_LINHAS_NA_BOLHA || /\n/.test(texto)
  );
}

// Revisao das telas da AG6b (item 7): o "ver mais" so aparece quando a
// transcricao passa das duas linhas na largura de agora (medida depois de
// montar e a cada mudanca de tamanho); aberta, o "ver menos" fica.
function TranscricaoDoAssistente({ texto }: { texto: string }) {
  const [aberta, setAberta] = useState(false);
  const [cortada, setCortada] = useState(() => transcricaoPareceLonga(texto));
  const paragrafo = useRef<HTMLParagraphElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const elemento = paragrafo.current;
    if (!elemento || aberta) {
      return;
    }
    const medir = () =>
      setCortada(elemento.scrollHeight > elemento.clientHeight + 1);
    medir();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [texto, aberta]);
  return (
    <div className="grid gap-1" data-leitura="transcricao">
      <p
        ref={paragrafo}
        id={id}
        className={cn("break-words", !aberta && "line-clamp-2")}
      >
        <span className={ROTULO}>{`${TEXTOS_DA_LEITURA.transcricao} `}</span>
        {texto}
      </p>
      {cortada || aberta ? (
        <button
          type="button"
          aria-expanded={aberta}
          aria-controls={id}
          onClick={() => setAberta((valor) => !valor)}
          className="hit-40 relative w-fit rounded-sm text-[12px] font-semibold text-(--bolha-meta) underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          {aberta ? TEXTOS_DA_LEITURA.verMenos : TEXTOS_DA_LEITURA.verMais}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A linha da leitura embaixo da midia do paciente. `indisponivel`: a
 * consulta das leituras falhou (so a mensagem que podia ter leitura recebe).
 */
export function LeituraDoAssistente({
  leitura,
  indisponivel = false,
}: {
  leitura: LeituraDaMidiaNaTela | null | undefined;
  indisponivel?: boolean;
}) {
  const linha = linhaDaLeitura(leitura);
  if (linha === null) {
    return indisponivel ? (
      <p
        data-leitura="indisponivel"
        className="text-[12px] leading-snug text-(--bolha-meta)"
      >
        {TEXTOS_DA_LEITURA.indisponivel}
      </p>
    ) : null;
  }
  if (linha.tipo === "transcricao") {
    return <TranscricaoDoAssistente texto={linha.texto} />;
  }
  if (linha.tipo === "sem_fala") {
    return (
      <p data-leitura="sem_fala" className="break-words">
        <span className={ROTULO}>{`${TEXTOS_DA_LEITURA.transcricao} `}</span>
        {TEXTOS_DA_LEITURA.semFala}
      </p>
    );
  }
  return (
    <p data-leitura="lido" className="flex items-start gap-1.5 break-words">
      <ScanText
        aria-hidden
        className="mt-[3px] size-3.5 shrink-0 text-ai-text"
      />
      <span className="min-w-0">
        <span className={ROTULO}>{`${TEXTOS_DA_LEITURA.lido} `}</span>
        {comPontoFinal(linha.resumo)}
      </span>
    </p>
  );
}
