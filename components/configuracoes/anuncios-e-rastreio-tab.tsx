"use client";

import { ChevronDown } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { useState, type ReactNode } from "react";

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
  type DadosDasOrigens,
} from "@/components/configuracoes/origem-dos-leads-tab";
import { StatusChip } from "@/components/shared/status-chip";
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
// Tintim. Cada passo e uma linha que abre, com a situacao e o que falta, e
// dentro o "onde encontro" e os campos (a explicacao de cada passo saiu em
// 26/11/2026; a lista "Passo a passo" do topo, que repetia as mesmas sete
// linhas, saiu em 27/11/2026, a pedido do dono). As abas antigas (Anuncios
// da Meta, Anuncios do Google e Origem dos leads) viraram os passos, com os
// mesmos cartoes.

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
      className="w-5 shrink-0 text-center cz-num text-[13px] font-semibold text-text-secondary"
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

  const [abertos, setAbertos] = useState<string[]>(() =>
    passosAbertosDeInicio(passos, passoDoEndereco, abaDoEndereco),
  );

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
      <OrigemDosLeadsTab
        dados={origens}
        podeGerenciar={podeGerenciar}
        dica={dica}
      />
    ),
  };

  return (
    <div className="grid gap-4">
      <p className="text-xs text-text-secondary">
        <span className="cz-num">{prontos}</span> de{" "}
        <span className="cz-num">{passos.length}</span> passos prontos
      </p>

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
                  className="group/passo flex min-h-12 w-full flex-wrap items-center gap-3 rounded-card border border-border bg-card px-4 py-2 text-left outline-none cz-transition hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                >
                  <Numero valor={passo.numero} />
                  <span className="sr-only">Passo {passo.numero}:</span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-[15px] font-bold tracking-[-0.01em] text-text-strong">
                      {passo.titulo}
                    </span>
                    {passo.detalhe ? (
                      <span className="text-[12.5px] text-text-secondary">
                        {passo.detalhe}
                      </span>
                    ) : null}
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
              {conteudo[passo.chave]}
            </AccordionPrimitive.Content>
          </AccordionPrimitive.Item>
        ))}
      </AccordionPrimitive.Root>
    </div>
  );
}
