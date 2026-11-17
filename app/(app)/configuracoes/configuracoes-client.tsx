"use client";

import { Hourglass } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  AnunciosERastreioTab,
  type DadosDaMeta,
} from "@/components/configuracoes/anuncios-e-rastreio-tab";
import { ClinicaTab } from "@/components/configuracoes/clinica-tab";
import { ErroDaAba } from "@/components/configuracoes/erro-da-aba";
import { EtiquetasTab } from "@/components/configuracoes/etiquetas-tab";
import type { DadosDoRastreio } from "@/components/configuracoes/google-ads-tab";
import { JornadaTab } from "@/components/configuracoes/jornada-tab";
import { ListaEquipe } from "@/components/configuracoes/lista-equipe";
import { MensagensPadraoTab } from "@/components/configuracoes/mensagens-padrao-tab";
import type {
  MembroEquipe,
  ProfissionalDaAgenda,
} from "@/components/configuracoes/lista-equipe";
import type { DadosDasOrigens } from "@/components/configuracoes/origem-dos-leads-tab";
import { PainelPapeis } from "@/components/configuracoes/painel-papeis";
// [AG7 preparo] início
import {
  ResponsavelTecnicoCard,
  type ResponsavelTecnicoCardProps,
} from "@/components/configuracoes/responsavel-tecnico-card";
// [AG7 preparo] fim
import { Aviso } from "@/components/shared/aviso";
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
import { ehAbaAntigaDoRastreio } from "@/lib/domain/passos-do-rastreio";
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
  // Anuncios e rastreio (decisao do dono de 17/11/2026): um lugar so para o
  // que substitui o Tintim. Juntou as abas Anuncios da Meta, Anuncios do
  // Google e Origem dos leads, que viraram os passos dela; os links antigos
  // (?aba=meta, ?aba=google e ?aba=origem) caem aqui, com o passo aberto. Com
  // ela, a fileira tem 7 abas (e o esqueleto de loading.tsx, 7 barras).
  ["rastreio", "Anúncios e rastreio"],
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
  passoInicial,
  equipe,
  meuUserId,
  podeGerenciar,
  ehAdmin,
  ehAdminPleno = ehAdmin,
  dica,
  // [AG7 preparo] início
  responsavelTecnico,
  // [AG7 preparo] fim
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
  /** ?passo= do endereco: o passo aberto da aba Anuncios e rastreio. */
  passoInicial?: string;
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
  // [AG7 preparo] início
  /**
   * O cartao "Responsavel tecnico" da aba Equipe (AG7): os dados (nulos
   * quando a leitura do RT falhou), quem define (administrador pleno ou
   * equipe Conduzza) e o fuso da clinica. Ausente: o cartao nao aparece.
   */
  responsavelTecnico?: ResponsavelTecnicoCardProps;
  // [AG7 preparo] fim
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
   * O passo "Links e origens" da aba Anuncios e rastreio: as origens
   * (todas), os numeros que servem ao link e as frases do botao do site.
   * Nulo (ou ausente): a leitura das origens falhou, e o passo mostra o
   * erro com "Tentar de novo".
   */
  origens?: DadosDasOrigens | null;
  /**
   * Os passos da Meta na aba Anuncios e rastreio: a conta, se existe cada
   * token (nunca o valor) e a situacao da leitura do investimento. Nulo:
   * alguma leitura falhou.
   */
  meta: DadosDaMeta | null;
  /**
   * O passo "Rastreio do site" da aba Anuncios e rastreio: a linha do
   * rastreio do site (com a chave, que e publica), a resposta crua dos
   * totais e o endereco do sistema. Nulo: a leitura do rastreio falhou.
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
      : ehAbaAntigaDoRastreio(abaInicial) // meta, google e origem (17/11/2026)
        ? "rastreio"
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

            {/* [AG7 preparo] início */}
            {/* Antes de "Usuarios e permissoes" (contrato 3.3, EQ): o
                formulario escolhe entre as pessoas ativas da equipe, entao
                o cartao so aparece com a equipe lida. */}
            {responsavelTecnico ? (
              <ResponsavelTecnicoCard {...responsavelTecnico} />
            ) : null}
            {/* [AG7 preparo] fim */}

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

      <TabsContent value="rastreio" className="grid gap-4">
        <AnunciosERastreioTab
          meta={meta}
          google={google}
          origens={origens ?? null}
          podeGerenciar={podeGerenciar}
          dica={dica}
          passoDoEndereco={passoInicial}
          abaDoEndereco={abaInicial}
        />
      </TabsContent>
    </Tabs>
  );
}
