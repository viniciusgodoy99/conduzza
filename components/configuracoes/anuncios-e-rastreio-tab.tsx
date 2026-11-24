"use client";

import { ChevronDown } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { useRef, useState, type ReactNode } from "react";

import { ConversoesPorEtapa } from "@/components/configuracoes/conversoes-por-etapa";
import { ErroDaAba } from "@/components/configuracoes/erro-da-aba";
import {
  GoogleAdsTab,
  type DadosDoRastreio,
} from "@/components/configuracoes/google-ads-tab";
import type { LeituraDoInvestimento } from "@/components/configuracoes/investimento-meta";
import {
  useCartoesDaMeta,
  type ContaMeta,
} from "@/components/configuracoes/meta-ads-tab";
import { OndeEncontro } from "@/components/configuracoes/onde-encontro";
import {
  OrigemDosLeadsTab,
  TEXTOS_DA_ORIGEM,
  type DadosDasOrigens,
} from "@/components/configuracoes/origem-dos-leads-tab";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardHeader } from "@/components/ui/card";
import { PASSO_DO_RASTREIO_STATUS } from "@/lib/design/status";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import { ONDE_ENCONTRAR } from "@/lib/domain/onde-encontrar";
import {
  passosAbertosDeInicio,
  passosDoRastreio,
  prontosDoRastreio,
  type ChaveDoPasso,
  type PassoDoRastreio,
} from "@/lib/domain/passos-do-rastreio";

// Aba "Anuncios e rastreio" de Configuracoes (decisao do dono de 17/11/2026,
// desenho "passo a passo que abre"): um lugar so para o que substitui o
// Tintim. No topo, a lista dos passos com a situacao de cada um; embaixo,
// cada passo abre com a explicacao, o "onde encontro" e os campos. As abas
// antigas (Anuncios da Meta, Anuncios do Google e Origem dos leads) viraram
// os passos, com os mesmos cartoes.

export const TEXTOS_DO_RASTREIO_DA_ABA = {
  descricao:
    "Tudo o que liga os anúncios aos leads da clínica fica aqui: a conta da Meta, o que cada etapa envia, o rastreio do site e os links rastreados. Siga os passos na ordem. Em cada um está para que serve e onde encontrar o que ele pede.",
  titulo: "Passo a passo",
  abrir: "Abrir",
} as const;

export type DadosDaMeta = {
  conta: ContaMeta | null;
  temToken: boolean;
  temTokenDeLeitura: boolean;
  leitura: LeituraDoInvestimento | null;
  timezone: string;
  agoraMs: number;
};

function Numero({ valor }: { valor: number }) {
  return (
    <span
      aria-hidden
      className="cz-num grid size-10 shrink-0 place-items-center rounded-xl bg-surface-4 text-[15px] font-bold text-foreground"
    >
      {valor}
    </span>
  );
}

function ChipDoPasso({ passo }: { passo: PassoDoRastreio }) {
  return (
    <StatusChip
      size="sm"
      definition={PASSO_DO_RASTREIO_STATUS[passo.situacao]}
      label={passo.rotulo ?? undefined}
    />
  );
}

export function AnunciosERastreioTab({
  meta,
  google,
  origens,
  jornada,
  podeGerenciar,
  dica,
  passoDoEndereco,
  abaDoEndereco,
}: {
  /** nulo: alguma leitura da conta da Meta falhou */
  meta: DadosDaMeta | null;
  /** nulo: a leitura do rastreio do site falhou */
  google: DadosDoRastreio | null;
  /** nulo: a leitura das origens falhou (o passo mostra "Tentar de novo") */
  origens: DadosDasOrigens | null;
  /** nulo: a leitura da jornada falhou (o passo das conversoes mostra o erro) */
  jornada: EtapaDaJornada[] | null;
  podeGerenciar: boolean;
  dica: string;
  /** ?passo= do endereco, para o link direto a um passo */
  passoDoEndereco?: string;
  /** ?aba= do endereco: os links das abas antigas abrem os passos delas */
  abaDoEndereco?: string;
}) {
  // O gancho roda sempre (regra dos ganchos); sem a leitura da Meta os
  // cartoes dele nao sao mostrados, entao os valores de reserva nao aparecem.
  const cartoes = useCartoesDaMeta({
    conta: meta?.conta ?? null,
    temToken: meta?.temToken ?? false,
    temTokenDeLeitura: meta?.temTokenDeLeitura ?? false,
    leitura: meta?.leitura ?? null,
    timezone: meta?.timezone ?? "UTC",
    agoraMs: meta?.agoraMs ?? 0,
    podeGerenciar,
    dica,
  });

  const passos = passosDoRastreio({
    meta: meta
      ? {
          temPixel: Boolean(meta.conta?.pixel_id),
          temWaba: Boolean(meta.conta?.whatsapp_business_account_id),
          temToken: meta.temToken,
          temModo: Boolean(meta.conta?.modo_user_data),
          soIdentificador: meta.conta?.modo_user_data === "ctwa_apenas",
          envioLigado: meta.conta?.envio_ativado ?? false,
          temContaDeAnuncios: Boolean(meta.conta?.ad_account_id),
          temTokenDeLeitura: meta.temTokenDeLeitura,
          leituraComProblema: meta.leitura?.situacao === "com_problema",
        }
      : null,
    site: google ? { ligado: google.linha?.ativo ?? false } : null,
    origens: origens ? origens.regras.length : null,
    conversoes: jornada
      ? jornada.filter((etapa) => etapa.meta_event_name && etapa.conversao_ativa)
          .length
      : null,
  });
  const prontos = prontosDoRastreio(passos);
  const primeiroQueFalta = passos.find((passo) => passo.situacao === "falta");

  const [abertos, setAbertos] = useState<string[]>(() =>
    passosAbertosDeInicio(passos, passoDoEndereco, abaDoEndereco),
  );
  const gatilhos = useRef<Partial<Record<ChaveDoPasso, HTMLButtonElement | null>>>(
    {},
  );

  const abrir = (chave: ChaveDoPasso) => {
    setAbertos((atuais) => (atuais.includes(chave) ? atuais : [...atuais, chave]));
    // Depois de o passo abrir: leva a tela e o foco ate ele.
    requestAnimationFrame(() => {
      const gatilho = gatilhos.current[chave];
      if (!gatilho) {
        return;
      }
      const semMovimento = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      gatilho.scrollIntoView({
        behavior: semMovimento ? "auto" : "smooth",
        block: "start",
      });
      gatilho.focus({ preventScroll: true });
    });
  };

  const erroDaMeta = (
    <ErroDaAba titulo="Não foi possível carregar a conta de anúncios" />
  );
  const conteudo: Record<ChaveDoPasso, ReactNode> = {
    conta: meta ? cartoes.conta : erroDaMeta,
    token: meta ? cartoes.token : erroDaMeta,
    conversoes: (
      <ConversoesPorEtapa
        jornada={jornada}
        podeGerenciar={podeGerenciar}
        dica={dica}
      />
    ),
    envio: meta ? cartoes.envio : erroDaMeta,
    investimento: meta ? (
      <>
        <OndeEncontro
          titulo="Onde encontro o token de leitura"
          ajuda={ONDE_ENCONTRAR.tokenDeLeitura}
        />
        {cartoes.investimento}
      </>
    ) : (
      erroDaMeta
    ),
    site: google ? (
      <>
        <GoogleAdsTab rastreio={google} podeGerenciar={podeGerenciar} dica={dica} />
        <div className="grid items-start gap-3 lg:grid-cols-3">
          <OndeEncontro
            titulo="No anúncio da Meta: onde colar os parâmetros de URL"
            ajuda={ONDE_ENCONTRAR.parametrosDeUrl}
          />
          <OndeEncontro
            titulo="No Google Ads: ligar a codificação automática"
            ajuda={ONDE_ENCONTRAR.codificacaoAutomaticaDoGoogle}
          />
          <OndeEncontro
            titulo="Devolver as conversões para o Google Ads"
            ajuda={ONDE_ENCONTRAR.conversoesDoGoogle}
          />
        </div>
      </>
    ) : (
      <ErroDaAba titulo="Não foi possível carregar o rastreio do site" />
    ),
    origens: (
      <>
        <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
          {TEXTOS_DA_ORIGEM.descricaoDaAba}
        </p>
        <OrigemDosLeadsTab
          dados={origens}
          podeGerenciar={podeGerenciar}
          dica={dica}
        />
      </>
    ),
  };

  return (
    <div className="grid gap-4">
      <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
        {TEXTOS_DO_RASTREIO_DA_ABA.descricao}
      </p>

      <Card>
        <CardHeader>
          <h2 className="text-base leading-[1.3] font-bold tracking-[-0.01em]">
            {TEXTOS_DO_RASTREIO_DA_ABA.titulo}
          </h2>
          <CardAction>
            <p className="text-xs text-text-secondary">
              <span className="cz-num">{prontos}</span> de{" "}
              <span className="cz-num">{passos.length}</span> prontos
            </p>
          </CardAction>
        </CardHeader>
        <ol className="divide-y divide-border">
          {passos.map((passo) => (
            <li
              key={passo.chave}
              className="flex flex-wrap items-center gap-4 px-4 py-3.5"
            >
              <Numero valor={passo.numero} />
              <div className="grid min-w-0 flex-1 basis-56 gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-text-strong">
                    {passo.titulo}
                  </span>
                  <ChipDoPasso passo={passo} />
                </span>
                <span className="text-[12.5px] text-text-secondary">
                  {passo.paraQueServe}
                  {passo.detalhe ? ` ${passo.detalhe}` : ""}
                </span>
              </div>
              <Button
                variant={passo === primeiroQueFalta ? "solid" : "outline"}
                onClick={() => abrir(passo.chave)}
                aria-label={`${TEXTOS_DO_RASTREIO_DA_ABA.abrir} o passo ${passo.numero}, ${passo.titulo}`}
              >
                {TEXTOS_DO_RASTREIO_DA_ABA.abrir}
              </Button>
            </li>
          ))}
        </ol>
      </Card>

      <AccordionPrimitive.Root
        type="multiple"
        value={abertos}
        onValueChange={setAbertos}
        className="grid gap-3"
      >
        {passos.map((passo) => (
          <AccordionPrimitive.Item
            key={passo.chave}
            value={passo.chave}
            data-passo={passo.chave}
            className="grid gap-3"
          >
            <AccordionPrimitive.Header asChild>
              <h3>
                <AccordionPrimitive.Trigger
                  ref={(elemento) => {
                    gatilhos.current[passo.chave] = elemento;
                  }}
                  className="group/passo flex min-h-14 w-full scroll-mt-4 flex-wrap items-center gap-3 rounded-card border border-border bg-card px-4 py-2 text-left shadow-sm outline-none cz-transition hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                >
                  <Numero valor={passo.numero} />
                  <span className="sr-only">Passo {passo.numero}:</span>
                  <span className="min-w-0 flex-1 text-[15px] font-bold tracking-[-0.01em] text-text-strong">
                    {passo.titulo}
                  </span>
                  <ChipDoPasso passo={passo} />
                  <ChevronDown
                    aria-hidden
                    className="size-[18px] shrink-0 text-text-secondary cz-transition group-data-[state=open]/passo:rotate-180 motion-reduce:transition-none"
                  />
                </AccordionPrimitive.Trigger>
              </h3>
            </AccordionPrimitive.Header>
            {/* forceMount: o Radix desmonta o passo fechado e o que foi
                digitado nele (token de leitura, frases do site, teste de
                mensagem) sumia ao fechar e reabrir. Fechado, fica so
                escondido (revisao de 17/11/2026). */}
            <AccordionPrimitive.Content
              forceMount
              className="grid gap-4 pb-2 data-[state=closed]:hidden"
            >
              <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
                <span className="font-semibold text-text-strong">
                  Para que serve:{" "}
                </span>
                {passo.paraQueServe}
              </p>
              {conteudo[passo.chave]}
            </AccordionPrimitive.Content>
          </AccordionPrimitive.Item>
        ))}
      </AccordionPrimitive.Root>
    </div>
  );
}
