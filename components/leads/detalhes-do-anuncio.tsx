"use client";

import { ExternalLink, OctagonAlert } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CARACTERES_POR_LINHA_DA_DESCRICAO,
  descricaoPareceLonga,
  detalhesParaMostrar,
  TEXTO_CARREGANDO_DETALHES_DO_ANUNCIO,
  TEXTO_ERRO_DOS_DETALHES_DO_ANUNCIO,
  TEXTO_SEM_DETALHES_DO_ANUNCIO,
  TITULO_DO_BLOCO_DO_ANUNCIO,
  type LeituraDosDetalhes,
  type TelaDosDetalhes,
} from "@/lib/domain/anuncio-do-whatsapp";
import type { TextoDeAtribuicao } from "@/lib/domain/leads-ui";
import { cn } from "@/lib/utils";

// Bloco "Detalhes do anúncio" (pedido do dono em 20/10/2026), o mesmo no
// painel do Atendimento, na gaveta de Leads e na ficha: o titulo e a
// descricao do anuncio de clique para WhatsApp como vieram na mensagem
// (anuncio_do_whatsapp), o "Abrir anúncio" quando ha link de um endereco do
// anuncio, e a campanha e o conjunto DA META (campanhaDaMeta e
// conjuntoDoContato, com os mesmos textos de carregando, pendente e erro).
// A campanha do link ou do Google fica nas linhas da Origem de cada tela.
// Sem detalhe guardado, a frase diz que eles ainda nao estao disponiveis.
//
// Bloco afundado do design system (docs/06 4.7; o esqueleto do carregando
// usa a Superficie 5, como nas metricas da regua, para aparecer sobre a 4),
// com as linhas empilhadas
// (rotulo em cima, valor embaixo): na largura do painel (320px) a linha de
// 120px deixaria a descricao numa coluna estreita demais. A descricao corta
// em 3 linhas com "Ver mais" e "Ver menos". Os controles tem 40px REAIS
// (min-h-10 e o botao padrao): a ficha poe o bloco num cartao com
// overflow-hidden, onde o hit-40 nao vale (app/globals.css).
//
// Leitor de tela: carregando, erro e "ainda nao disponiveis" vivem numa
// regiao role="status" FIXA (o mesmo elemento em todos os estados, vazio e
// fora do fluxo quando os detalhes chegam), entao a troca de um para o outro
// e anunciada; a campanha e o conjunto em carregando e em erro tambem.
//
// O texto vem de quem mandou a mensagem: aparece como texto (o React escapa)
// e o link e conferido de novo aqui (so https e endereco do anuncio,
// detalhesParaMostrar) antes de virar link, que abre em outra aba sem
// referrer.

function Linha({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-[12px] text-text-secondary">{rotulo}</dt>
      <dd className="min-w-0 text-[13px] break-words text-foreground">
        {children}
      </dd>
    </div>
  );
}

/**
 * Campanha ou conjunto, com os textos e estados de hoje. Carregando e erro
 * no MESMO span role="status" (o React troca so o conteudo), para o erro que
 * chega depois do carregando ser anunciado.
 */
function ValorDeAtribuicao({
  valor,
  complementoDoErro,
}: {
  valor: TextoDeAtribuicao;
  complementoDoErro?: string;
}) {
  if (valor.tipo === "carregando") {
    return (
      <span role="status" className="block">
        <span className="sr-only">{valor.texto}</span>
        <Skeleton aria-hidden className="h-3.5 w-40 max-w-full bg-surface-5" />
      </span>
    );
  }
  if (valor.tipo === "erro") {
    return (
      <span role="status" className="block text-text-secondary">
        {complementoDoErro
          ? `${valor.texto}. ${complementoDoErro}`
          : valor.texto}
      </span>
    );
  }
  if (valor.tipo === "nome") {
    return <>{valor.texto}</>;
  }
  return <span className="text-text-secondary">{valor.texto}</span>;
}

// Descricao com mais de 3 linhas antes de medir (e no HTML do servidor, que
// nao mede): a estimativa pela largura da tela; depois de montar, a medida de
// verdade na largura atual. Sem layout (aba escondida), fica a estimativa.
function Descricao({
  texto,
  caracteresPorLinha,
}: {
  texto: string;
  caracteresPorLinha: number;
}) {
  const id = useId();
  const [inteira, setInteira] = useState(false);
  const [cortada, setCortada] = useState(() =>
    descricaoPareceLonga(texto, caracteresPorLinha),
  );
  const textoRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const elemento = textoRef.current;
    if (!elemento || inteira) {
      return;
    }
    const medir = () => {
      if (elemento.clientHeight === 0) {
        return;
      }
      setCortada(elemento.scrollHeight > elemento.clientHeight + 1);
    };
    medir();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [texto, inteira]);

  return (
    <>
      <p
        id={id}
        ref={textoRef}
        className={cn(
          "break-words whitespace-pre-line",
          !inteira && "line-clamp-3",
        )}
      >
        {texto}
      </p>
      {cortada || inteira ? (
        <button
          type="button"
          aria-expanded={inteira}
          aria-controls={id}
          onClick={() => setInteira((atual) => !atual)}
          className="flex min-h-10 w-fit items-center rounded-sm text-[12.5px] font-semibold text-text-secondary underline underline-offset-2 hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          {inteira ? "Ver menos" : "Ver mais"}
        </button>
      ) : null}
    </>
  );
}

export type PropsDosDetalhesDoAnuncio = {
  leitura: LeituraDosDetalhes;
  /** Campanha DA META do lead de anuncio (campanhaDaMeta); null some. */
  campanha: TextoDeAtribuicao | null;
  /** Conjunto da Meta do contato (conjuntoDoContato); null some. */
  conjunto: TextoDeAtribuicao | null;
  /**
   * Onde o bloco aparece: a largura dele decide a estimativa do "Ver mais"
   * antes de medir (CARACTERES_POR_LINHA_DA_DESCRICAO).
   */
  tela: TelaDosDetalhes;
  /** h4 dentro de uma secao com h3 (painel, gaveta); h3 no cartao da ficha. */
  tituloComo?: "h3" | "h4";
  /**
   * Frase depois de um erro de leitura onde a tela nao tem "Tentar de novo"
   * (a ficha e do servidor: "Atualize a página para tentar de novo.").
   */
  complementoDoErro?: string;
};

/**
 * A arvore do bloco, sem hook (o id do titulo vem de fora). Exportada para o
 * teste conferir a chave da descricao: ela muda com o anuncio e com o texto,
 * entao o "Ver mais" aberto de um anuncio nunca passa para outro.
 */
export function montarBlocoDosDetalhes({
  leitura,
  campanha,
  conjunto,
  tela,
  tituloComo = "h4",
  complementoDoErro,
  idDoTitulo,
}: PropsDosDetalhesDoAnuncio & { idDoTitulo: string }) {
  const Titulo = tituloComo;
  const detalhes = leitura.estado === "lida" ? leitura.detalhes : null;
  const mostrar = detalhesParaMostrar(detalhes);
  const temLinhas = Boolean(
    mostrar?.titulo || mostrar?.descricao || campanha || conjunto,
  );
  const situacao =
    leitura.estado === "carregando" ? (
      <>
        <span className="sr-only">{TEXTO_CARREGANDO_DETALHES_DO_ANUNCIO}</span>
        <Skeleton aria-hidden className="h-3.5 w-3/4 bg-surface-5" />
        <Skeleton aria-hidden className="h-3.5 w-full bg-surface-5" />
      </>
    ) : leitura.estado === "erro" ? (
      <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-alert-text">
        <OctagonAlert aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>
          {complementoDoErro
            ? `${TEXTO_ERRO_DOS_DETALHES_DO_ANUNCIO} ${complementoDoErro}`
            : TEXTO_ERRO_DOS_DETALHES_DO_ANUNCIO}
        </span>
      </p>
    ) : !mostrar ? (
      <p className="text-[12.5px] leading-snug text-text-secondary">
        {TEXTO_SEM_DETALHES_DO_ANUNCIO}
      </p>
    ) : null;

  return (
    <section
      aria-labelledby={idDoTitulo}
      className="grid min-w-0 gap-2.5 rounded-xl bg-surface-4 p-3.5"
    >
      <Titulo
        id={idDoTitulo}
        className="text-[13px] font-semibold text-text-strong"
      >
        {TITULO_DO_BLOCO_DO_ANUNCIO}
      </Titulo>

      {/* A regiao e a mesma em todos os estados: vazia (detalhes lidos),
          fica fora do fluxo e nao abre espaco na grade. */}
      <div role="status" className={situacao ? "grid gap-1.5" : "sr-only"}>
        {situacao}
      </div>

      {temLinhas ? (
        <dl className="grid gap-2">
          {mostrar?.titulo ? (
            <Linha rotulo="Título">
              <span className="font-semibold text-text-strong">
                {mostrar.titulo}
              </span>
            </Linha>
          ) : null}
          {mostrar?.descricao && detalhes ? (
            <Linha rotulo="Descrição">
              <Descricao
                key={`${detalhes.ad_id}:${mostrar.descricao}`}
                texto={mostrar.descricao}
                caracteresPorLinha={CARACTERES_POR_LINHA_DA_DESCRICAO[tela]}
              />
            </Linha>
          ) : null}
          {campanha ? (
            <Linha rotulo="Campanha">
              <ValorDeAtribuicao
                valor={campanha}
                complementoDoErro={complementoDoErro}
              />
            </Linha>
          ) : null}
          {conjunto ? (
            <Linha rotulo="Conjunto">
              <ValorDeAtribuicao
                valor={conjunto}
                complementoDoErro={complementoDoErro}
              />
            </Linha>
          ) : null}
        </dl>
      ) : null}

      {mostrar?.link ? (
        <Button asChild variant="outline" className="w-fit">
          <a href={mostrar.link} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden />
            Abrir anúncio <span className="sr-only">(abre em outra aba)</span>
          </a>
        </Button>
      ) : null}
    </section>
  );
}

export function DetalhesDoAnuncio(props: PropsDosDetalhesDoAnuncio) {
  const idDoTitulo = useId();
  return montarBlocoDosDetalhes({ ...props, idDoTitulo });
}
