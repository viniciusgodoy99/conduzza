"use client";

import { Hourglass } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AutomacoesDeFluxoTab } from "@/components/configuracoes/automacoes-de-fluxo-tab";
import { ClinicaTab } from "@/components/configuracoes/clinica-tab";
import { EtiquetasTab } from "@/components/configuracoes/etiquetas-tab";
import {
  GoogleAdsTab,
  type DadosDoRastreio,
} from "@/components/configuracoes/google-ads-tab";
import { JornadaTab } from "@/components/configuracoes/jornada-tab";
import { ListaEquipe } from "@/components/configuracoes/lista-equipe";
import { MensagensPadraoTab } from "@/components/configuracoes/mensagens-padrao-tab";
import type {
  MembroEquipe,
  ProfissionalDaAgenda,
} from "@/components/configuracoes/lista-equipe";
import type { LeituraDoInvestimento } from "@/components/configuracoes/investimento-meta";
import {
  MetaAdsTab,
  type ContaMeta,
} from "@/components/configuracoes/meta-ads-tab";
import { PainelPapeis } from "@/components/configuracoes/painel-papeis";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ListaDeNumeros,
  type ListaDeNumerosProps,
} from "@/components/whatsapp/lista-de-numeros";
import type { AutomacaoDeFluxo } from "@/lib/domain/automacoes-de-fluxo";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import type { RespostaRapida } from "@/lib/domain/respostas-rapidas";

import { CodigoAcesso, PendentesList } from "./equipe-client";
import type { Pendente } from "./equipe-client";
import { InviteForm } from "./invite-form";

// Tela 12: a aba vive na URL (?aba=whatsapp) para link direto e para a volta
// do navegador funcionar, mesmo padrao de Cadastros. "?aba=conversoes" segue
// valendo como link antigo: cai na jornada, que absorveu aquela aba.
//
// Abas sublinhadas do design system (9 vistas), com contadores. Na equipe, o
// segundo contador e o de pedidos aguardando liberacao (ampulheta, tom de
// atencao e o texto por extenso para leitor de tela). Cada aba mostra o
// proprio erro de carregamento em vez de derrubar a tela inteira.

const ABAS = [
  ["equipe", "Equipe e permissões"],
  ["clinica", "Clínica"],
  ["whatsapp", "WhatsApp"],
  ["jornada", "Jornada e conversões"],
  // Automacoes de fluxo (02/10/2026): logo depois da jornada, que e de onde
  // vem a etapa de toda regra.
  ["fluxo", "Automações de fluxo"],
  ["etiquetas", "Etiquetas de conversa"],
  ["mensagens", "Mensagens padrão"],
  ["meta", "Anúncios da Meta"],
  // Anuncios do Google (F1, 04/10/2026): o rastreio do site e, em breve, a
  // conexao com o Google Ads. Logo depois da Meta.
  ["google", "Anúncios do Google"],
] as const;

type AbaKey = (typeof ABAS)[number][0];

function ErroDaAba({ titulo }: { titulo: string }) {
  return (
    <Card>
      <EmptyState
        tom="erro"
        title={titulo}
        description="Recarregue a página. Se continuar, fale com o suporte."
      />
    </Card>
  );
}

// Espaco literal antes do numero: o nome acessivel da aba fica "Etiquetas
// de conversa 4", e nao "conversa4".
function Contagem({ valor, rotulo }: { valor: number; rotulo: string }) {
  return (
    <>
      {" "}
      <TabsCount>
        <span aria-hidden>{valor}</span>
        <span className="sr-only">
          {valor} {rotulo}
        </span>
      </TabsCount>
    </>
  );
}

export function ConfiguracoesClient({
  abaInicial,
  equipe,
  meuUserId,
  podeGerenciar,
  ehAdmin,
  dica,
  clinica,
  codigo,
  codigoAtivo,
  whatsapp,
  jornada,
  fluxo,
  etiquetas,
  mensagens,
  meta,
  google,
}: {
  abaInicial?: string;
  /** nulo: a leitura da equipe falhou */
  equipe: {
    membros: MembroEquipe[];
    pendentes: Pendente[];
    profissionais: ProfissionalDaAgenda[] | null;
  } | null;
  meuUserId: string;
  podeGerenciar: boolean;
  ehAdmin: boolean;
  dica: string;
  /** nulo: a leitura da clinica falhou */
  clinica: { nome: string; timezone: string } | null;
  /** nulo: a leitura do codigo falhou */
  codigo: string | null;
  codigoAtivo: boolean;
  /**
   * Os numeros de WhatsApp da clinica e o que a aba precisa deles (sem a
   * permissao, que vem de podeGerenciar e ehAdmin). Nulo: a leitura dos
   * numeros falhou.
   */
  whatsapp: Omit<
    ListaDeNumerosProps,
    "podeGerenciar" | "ehAdmin" | "dica"
  > | null;
  jornada: EtapaDaJornada[] | null;
  /**
   * As automacoes de fluxo e o que a aba precisa da clinica (a chave do
   * cache e o fuso do historico). Nulo: a leitura das regras falhou.
   */
  fluxo: {
    lista: AutomacaoDeFluxo[];
    clinicId: string;
    timezone: string;
  } | null;
  etiquetas: {
    lista: EtiquetaDeConversa[];
    contagem: Record<string, number>;
  } | null;
  /** As mensagens padrao (todas) e o nome da clinica para a previa. */
  mensagens: {
    lista: RespostaRapida[];
    nomeDaClinica: string;
  } | null;
  /**
   * A aba Anuncios da Meta: a conta, se existe cada token (nunca o valor) e
   * a situacao da leitura do investimento. Nulo: alguma leitura falhou.
   */
  meta: {
    conta: ContaMeta | null;
    temToken: boolean;
    temTokenDeLeitura: boolean;
    leitura: LeituraDoInvestimento | null;
    timezone: string;
    agoraMs: number;
  } | null;
  /**
   * A aba Anuncios do Google: a linha do rastreio do site (com a chave, que
   * e publica), a resposta crua dos totais e o endereco do sistema. Nulo: a
   * leitura do rastreio falhou.
   */
  google: DadosDoRastreio | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const abaAtiva: AbaKey = ABAS.some(([key]) => key === abaInicial)
    ? (abaInicial as AbaKey)
    : abaInicial === "conversoes" // link antigo, antes de a jornada absorver
      ? "jornada"
      : "equipe";

  const trocarAba = (aba: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("aba", aba);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const ativos = equipe?.membros.filter((membro) => membro.ativo).length;
  const pendentes = equipe?.pendentes.length ?? 0;

  const contador = (aba: AbaKey) => {
    if (aba === "equipe" && ativos !== undefined) {
      return (
        <>
          <Contagem valor={ativos} rotulo="com acesso" />
          {pendentes > 0 ? (
            <>
              {" "}
              <TabsCount className="ml-1 inline-flex items-center gap-1 bg-warning-bg text-warning-text">
                <Hourglass aria-hidden className="size-3" />
                <span aria-hidden>{pendentes}</span>
                <span className="sr-only">
                  {pendentes} aguardando liberação
                </span>
              </TabsCount>
            </>
          ) : null}
        </>
      );
    }
    if (aba === "jornada" && jornada) {
      return <Contagem valor={jornada.length} rotulo="etapas" />;
    }
    if (aba === "fluxo" && fluxo) {
      return <Contagem valor={fluxo.lista.length} rotulo="automações" />;
    }
    if (aba === "etiquetas" && etiquetas) {
      return <Contagem valor={etiquetas.lista.length} rotulo="etiquetas" />;
    }
    if (aba === "mensagens" && mensagens) {
      return <Contagem valor={mensagens.lista.length} rotulo="mensagens" />;
    }
    return null;
  };

  return (
    <Tabs value={abaAtiva} onValueChange={trocarAba} className="gap-4">
      <TabsList>
        {ABAS.map(([key, label]) => (
          <TabsTrigger key={key} value={key}>
            {label}
            {contador(key)}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="equipe" className="grid gap-4">
        {equipe === null ? (
          <ErroDaAba titulo="Não foi possível carregar a equipe" />
        ) : (
          <>
            <PendentesList
              pendentes={equipe.pendentes}
              podeGerenciar={podeGerenciar}
              ehAdmin={ehAdmin}
              dica={dica}
              profissionais={equipe.profissionais}
            />

            <Card>
              <CardHeader>
                <CardTitle>Usuários e permissões</CardTitle>
                <CardDescription>
                  Quem tem acesso a esta clínica e com qual papel. O papel
                  decide o que cada pessoa vê e altera; tirar o acesso não apaga
                  nada, e você devolve quando quiser.
                </CardDescription>
              </CardHeader>
              <ListaEquipe
                membros={equipe.membros}
                meuUserId={meuUserId}
                podeGerenciar={podeGerenciar}
                ehAdmin={ehAdmin}
                dica={dica}
                profissionais={equipe.profissionais}
              />
            </Card>
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Convidar por e-mail</CardTitle>
            <CardDescription>
              O acesso já nasce liberado, com o papel escolhido. Quem ainda não
              tem conta recebe o convite por e-mail; quem já usa o Conduzza em
              outra clínica entra com a senha que já tem e encontra esta em
              Trocar de clínica.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm
              canInvite={podeGerenciar}
              hint={dica}
              ehAdmin={ehAdmin}
            />
          </CardContent>
        </Card>

        <CodigoAcesso
          codigo={codigo}
          ativo={codigoAtivo}
          podeGerenciar={podeGerenciar}
          dica={dica}
        />

        <PainelPapeis />
      </TabsContent>

      <TabsContent value="clinica" className="grid gap-4">
        {clinica ? (
          <ClinicaTab
            nome={clinica.nome}
            timezone={clinica.timezone}
            podeEditar={ehAdmin}
          />
        ) : (
          <ErroDaAba titulo="Não foi possível carregar os dados da clínica" />
        )}
      </TabsContent>

      <TabsContent value="whatsapp" className="grid gap-4">
        <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
          Cada número é um WhatsApp separado. O paciente que escreve para um
          número é atendido por ele, e a conversa mostra por qual número está
          falando.
        </p>
        {whatsapp ? (
          <ListaDeNumeros
            {...whatsapp}
            podeGerenciar={podeGerenciar}
            ehAdmin={ehAdmin}
            dica={dica}
          />
        ) : (
          <ErroDaAba titulo="Não foi possível carregar os números de WhatsApp" />
        )}
      </TabsContent>

      <TabsContent value="jornada" className="grid gap-4">
        <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
          As etapas que um contato percorre, do primeiro oi até a consulta.
          Renomeie, reordene, crie etapas próprias e defina em qual delas a
          clínica registra uma conversão para os anúncios.
        </p>
        {jornada ? (
          <JornadaTab
            jornada={jornada}
            podeGerenciar={podeGerenciar}
            dica={dica}
          />
        ) : (
          <ErroDaAba titulo="Não foi possível carregar a jornada" />
        )}
      </TabsContent>

      <TabsContent value="fluxo" className="grid gap-4">
        <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
          Regras que andam com o lead sozinhas: quando ele fica parado, deixa de
          responder, entra numa etapa ou manda mensagem, a automação move de
          etapa, coloca etiqueta, cria uma atividade ou deixa uma nota interna.
          Nenhuma delas manda mensagem para o paciente.
        </p>
        {fluxo && jornada ? (
          <AutomacoesDeFluxoTab
            automacoes={fluxo.lista}
            jornada={jornada}
            etiquetas={etiquetas?.lista ?? null}
            clinicId={fluxo.clinicId}
            timezone={fluxo.timezone}
            podeGerenciar={podeGerenciar}
            dica={dica}
          />
        ) : (
          <ErroDaAba titulo="Não foi possível carregar as automações de fluxo" />
        )}
      </TabsContent>

      <TabsContent value="etiquetas" className="grid gap-4">
        <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
          As etiquetas que a equipe usa para marcar o estado de uma conversa no
          Atendimento, como orçamento enviado ou aguardando convênio. Quem
          atende aplica e remove; criar e apagar é da administração.
        </p>
        {etiquetas ? (
          <EtiquetasTab
            etiquetas={etiquetas.lista}
            contagem={etiquetas.contagem}
            podeGerenciar={podeGerenciar}
            dica={dica}
          />
        ) : (
          <ErroDaAba titulo="Não foi possível carregar as etiquetas" />
        )}
      </TabsContent>

      <TabsContent value="mensagens" className="grid gap-4">
        <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
          Textos prontos que a equipe usa no Atendimento: na resposta ao
          paciente, digite / e escolha um. O texto entra no campo com o nome do
          contato, para revisar antes de enviar; nada sai sozinho. Criar e
          editar é da administração.
        </p>
        {mensagens ? (
          <MensagensPadraoTab
            mensagens={mensagens.lista}
            nomeDaClinica={mensagens.nomeDaClinica}
            podeGerenciar={podeGerenciar}
            dica={dica}
          />
        ) : (
          <ErroDaAba titulo="Não foi possível carregar as mensagens padrão" />
        )}
      </TabsContent>

      <TabsContent value="meta" className="grid gap-4">
        <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
          A conta de anúncios da clínica serve a duas coisas: ler quanto foi
          investido, para o custo por lead em Resultados, e devolver as
          conversões para a Meta medir o anúncio quando um contato chega numa
          etapa com evento configurado na Jornada.
        </p>
        {meta ? (
          <MetaAdsTab
            conta={meta.conta}
            temToken={meta.temToken}
            temTokenDeLeitura={meta.temTokenDeLeitura}
            leitura={meta.leitura}
            timezone={meta.timezone}
            agoraMs={meta.agoraMs}
            podeGerenciar={podeGerenciar}
            dica={dica}
          />
        ) : (
          <ErroDaAba titulo="Não foi possível carregar a conta de anúncios" />
        )}
      </TabsContent>

      <TabsContent value="google" className="grid gap-4">
        <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
          Quando o anúncio do Google leva ao site da clínica, o rastreio do site
          marca o clique no botão do WhatsApp, e o lead chega com a origem e a
          campanha do Google, sem cadastro manual. O investimento em cada
          campanha chega com a conexão com o Google, em breve.
        </p>
        {google ? (
          <GoogleAdsTab
            rastreio={google}
            podeGerenciar={podeGerenciar}
            dica={dica}
          />
        ) : (
          <ErroDaAba titulo="Não foi possível carregar o rastreio do site" />
        )}
      </TabsContent>
    </Tabs>
  );
}
