"use client";

import { Link2 } from "lucide-react";

import {
  RastreioDoSiteCard,
  situacaoDaResposta,
  TEXTOS_DO_RASTREIO,
  type LinhaDoRastreio,
} from "@/components/configuracoes/rastreio-do-site-card";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Aba Anuncios do Google (Configuracoes; F1 do Google, 04/10/2026).
//
// - "Rastreio do site": a origem e a campanha reais do Google no lead, sem
//   credencial nenhuma do Google (o anuncio leva ao site da clinica e a
//   linha de script marca o clique no botao de WhatsApp).
// - "Conectar com o Google": o nome das campanhas e o investimento por
//   plataforma chegam na F2, que depende das credenciais do Google Ads da
//   Conduzza. Ate la o bloco fica VISIVEL e desabilitado, com a dica (regra
//   do brief: acao indisponivel nunca some).

export type DadosDoRastreio = {
  /** A linha de rastreio_do_site; nula enquanto o rastreio nunca foi ligado. */
  linha: LinhaDoRastreio | null;
  /** Resposta crua de situacao_do_rastreio; nula quando a leitura falhou. */
  situacao: unknown;
  /** PUBLIC_APP_URL do servidor, cru. */
  enderecoDoSistema: string | null;
  /** Fuso da clinica (CLAUDE.md 3.6). */
  timezone: string;
  /**
   * Date.now() do servidor, a hora de referencia do chip ("Recebendo
   * cliques" so com clique nos ultimos 7 dias).
   */
  agoraMs: number;
};

export function GoogleAdsTab({
  rastreio,
  podeGerenciar,
  dica,
}: {
  rastreio: DadosDoRastreio;
  podeGerenciar: boolean;
  dica: string;
}) {
  const botaoConectar = (
    <Button variant="outline" disabled>
      <Link2 aria-hidden />
      Conectar com o Google
    </Button>
  );

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <RastreioDoSiteCard
        linha={rastreio.linha}
        situacao={situacaoDaResposta(rastreio.situacao)}
        enderecoDoSistema={rastreio.enderecoDoSistema}
        timezone={rastreio.timezone}
        agoraMs={rastreio.agoraMs}
        podeGerenciar={podeGerenciar}
        dica={dica}
      />

      <Card>
        <CardHeader>
          <CardTitle>Conectar com o Google (em breve)</CardTitle>
          <CardDescription>
            Com a conta do Google Ads conectada, o Conduzza vai mostrar o nome
            de cada campanha e quanto foi investido nela, para o custo por lead
            do Google em Resultados.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-[13px] text-text-secondary">
            Enquanto isso, a origem e o número da campanha já chegam pelo
            rastreio do site.
          </p>
          <DisabledWithHint hint={TEXTOS_DO_RASTREIO.conectarEmBreve}>
            {botaoConectar}
          </DisabledWithHint>
        </CardContent>
      </Card>
    </div>
  );
}
