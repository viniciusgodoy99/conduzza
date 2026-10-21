"use client";

import { Hourglass } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
import {
  OrigemDosLeadsTab,
  TEXTOS_DA_ORIGEM,
  type DadosDasOrigens,
} from "@/components/configuracoes/origem-dos-leads-tab";
import { PainelPapeis } from "@/components/configuracoes/painel-papeis";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
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
// Abas sublinhadas do design system (9 vistas), com contadores. Na equipe,
// o segundo contador e o de pedidos aguardando liberacao (ampulheta, tom de
// atencao e o texto por extenso para leitor de tela). Cada aba mostra o
// proprio erro de carregamento em vez de derrubar a tela inteira.
//
// A aba Agente de IA (Fase 3) saiu daqui na onda 2 (item 8, decisao do dono
// de 20/10/2026): mora na aba WhatsApp da tela Agente de IA (?aba=ia a
// pagina redireciona para la). Nas clinicas com o agente habilitado, a aba
// WhatsApp daqui avisa onde ficaram os numeros e os telefones do
// assistente (AvisoDoAssistente).
//
// Automacoes de fluxo (02/10/2026) era a aba logo depois da jornada ate
// 20/10/2026, quando o dono a levou para a tela Automacoes (?aba=fluxo de
// la). O link antigo, /configuracoes?aba=fluxo, a pagina redireciona no
// servidor (page.tsx), antes de ler qualquer coisa.

const ABAS = [
  ["equipe", "Equipe e permissões"],
  ["clinica", "Clínica"],
  ["whatsapp", "WhatsApp"],
  ["jornada", "Jornada e conversões"],
  ["etiquetas", "Etiquetas de conversa"],
  ["mensagens", "Mensagens padrão"],
  ["meta", "Anúncios da Meta"],
  // Anuncios do Google (F1, 04/10/2026): o rastreio do site e, em breve, a
  // conexao com o Google Ads. Logo depois da Meta.
  ["google", "Anúncios do Google"],
  // Origem dos leads (onda 5, item 17; P17-1 do dono em 21/10/2026): as
  // regras que reconhecem o lead do link da bio, do perfil no Google, do QR
  // code ou de um parceiro. Logo depois dos anuncios: com ela, a fileira
  // fixa tem 9 abas (e o esqueleto de loading.tsx, 9 barras).
  ["origem", "Origem dos leads"],
] as const;

type AbaKey = (typeof ABAS)[number][0];

/** Onde o assistente de IA mora desde a onda 2 (item 8). */
export const AVISO_DO_ASSISTENTE = {
  texto:
    "Os números e os telefones da equipe do assistente de IA ficam agora na tela Agente de IA, aba WhatsApp.",
  acao: "Abrir Agente de IA",
  link: "/agente?aba=whatsapp",
} as const;

/**
 * O aviso da aba WhatsApp nas clinicas com o agente habilitado: os cartoes
 * do assistente que moravam em Configuracoes foram para a Tela 6.
 */
function AvisoDoAssistente() {
  return (
    <Aviso
      tom="info"
      role="note"
      acao={
        <Button variant="outline" size="sm" asChild>
          <Link href={AVISO_DO_ASSISTENTE.link} prefetch={false}>
            {AVISO_DO_ASSISTENTE.acao}
          </Link>
        </Button>
      }
    >
      {AVISO_DO_ASSISTENTE.texto}
    </Aviso>
  );
}

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
  ehAdminPleno = ehAdmin,
  dica,
  clinica,
  codigo,
  codigoAtivo,
  whatsapp,
  jornada,
  etiquetas,
  mensagens,
  origens = null,
  meta,
  google,
  comAgenteDeIa = false,
}: {
  abaInicial?: string;
  /** nulo: a leitura da equipe falhou */
  equipe: {
    membros: MembroEquipe[];
    pendentes: Pendente[];
    profissionais: ProfissionalDaAgenda[] | null;
    /** A clinica ativa (contagem das agendadas de quem perde a escrita) */
    clinicId: string;
  } | null;
  meuUserId: string;
  podeGerenciar: boolean;
  ehAdmin: boolean;
  /**
   * Administrador sem a marca de Implementador (onda 5, item 18): so ele
   * convida, libera ou faz de alguem administrador ou Implementador e mexe
   * no acesso de quem e (P18-2 e P18-4). As outras abas seguem com ehAdmin:
   * o Implementador faz o resto como o administrador. Ausente, vale ehAdmin.
   */
  ehAdminPleno?: boolean;
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
   * A aba Origem dos leads: as origens (todas), os numeros que servem ao
   * link e as frases do botao do site. Nulo (ou ausente): a leitura das
   * origens falhou, e a aba mostra o erro com "Tentar de novo".
   */
  origens?: DadosDasOrigens | null;
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
  /**
   * A clinica tem o agente de IA habilitado (decisao do servidor): a aba
   * WhatsApp avisa onde ficaram os numeros e os telefones do assistente.
   */
  comAgenteDeIa?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const abas: readonly (readonly [AbaKey, string])[] = ABAS;

  // Aba desconhecida cai na equipe (o ?aba=ia antigo a pagina ja mandou
  // para a Tela 6).
  const abaAtiva: AbaKey = abas.some(([key]) => key === abaInicial)
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
    if (aba === "etiquetas" && etiquetas) {
      return <Contagem valor={etiquetas.lista.length} rotulo="etiquetas" />;
    }
    if (aba === "mensagens" && mensagens) {
      return <Contagem valor={mensagens.lista.length} rotulo="mensagens" />;
    }
    if (aba === "origem" && origens) {
      return <Contagem valor={origens.regras.length} rotulo="origens" />;
    }
    return null;
  };

  return (
    <Tabs value={abaAtiva} onValueChange={trocarAba} className="gap-4">
      <TabsList>
        {abas.map(([key, label]) => (
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
              ehAdminPleno={ehAdminPleno}
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
                ehAdminPleno={ehAdminPleno}
                dica={dica}
                profissionais={equipe.profissionais}
                clinicId={equipe.clinicId}
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
              ehAdminPleno={ehAdminPleno}
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
        {comAgenteDeIa ? <AvisoDoAssistente /> : null}
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

      <TabsContent value="origem" className="grid gap-4">
        <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
          {TEXTOS_DA_ORIGEM.descricaoDaAba}
        </p>
        <OrigemDosLeadsTab
          dados={origens}
          podeGerenciar={podeGerenciar}
          dica={dica}
        />
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
