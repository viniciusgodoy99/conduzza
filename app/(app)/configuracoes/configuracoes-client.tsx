"use client";

import { Hourglass } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ClinicaTab } from "@/components/configuracoes/clinica-tab";
import { EtiquetasTab } from "@/components/configuracoes/etiquetas-tab";
import { JornadaTab } from "@/components/configuracoes/jornada-tab";
import { ListaEquipe } from "@/components/configuracoes/lista-equipe";
import type {
  MembroEquipe,
  ProfissionalDaAgenda,
} from "@/components/configuracoes/lista-equipe";
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
import { ConnectClient } from "@/components/whatsapp/connect-client";
import type { ConnectState } from "@/lib/actions/whatsapp-connect";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import type { EtapaDaJornada } from "@/lib/domain/jornada";

import { CodigoAcesso, PendentesList } from "./equipe-client";
import type { Pendente } from "./equipe-client";
import { InviteForm } from "./invite-form";

// Tela 12: a aba vive na URL (?aba=whatsapp) para link direto e para a volta
// do navegador funcionar, mesmo padrao de Cadastros. "?aba=conversoes" segue
// valendo como link antigo: cai na jornada, que absorveu aquela aba.
//
// Abas sublinhadas do design system (6 vistas), com contadores. Na equipe, o
// segundo contador e o de pedidos aguardando liberacao (ampulheta, tom de
// atencao e o texto por extenso para leitor de tela). Cada aba mostra o
// proprio erro de carregamento em vez de derrubar a tela inteira.

const ABAS = [
  ["equipe", "Equipe e permissões"],
  ["clinica", "Clínica"],
  ["whatsapp", "WhatsApp"],
  ["jornada", "Jornada e conversões"],
  ["etiquetas", "Etiquetas de conversa"],
  ["meta", "Anúncios da Meta"],
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
  etiquetas,
  meta,
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
  whatsapp: {
    initial: ConnectState;
    connectedAt: string | null;
    providerName: string | null;
    timezone: string;
  };
  jornada: EtapaDaJornada[] | null;
  etiquetas: {
    lista: EtiquetaDeConversa[];
    contagem: Record<string, number>;
  } | null;
  meta: { conta: ContaMeta | null; temToken: boolean } | null;
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
    if (aba === "etiquetas" && etiquetas) {
      return <Contagem valor={etiquetas.lista.length} rotulo="etiquetas" />;
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
          O número conectado aqui é o WhatsApp que a clínica usa para atender.
          Toda conversa de paciente entra e sai por ele, então desconectar
          interrompe o atendimento na hora.
        </p>
        <ConnectClient
          initial={whatsapp.initial}
          connectedAt={whatsapp.connectedAt}
          canManage={podeGerenciar}
          hint={dica}
          providerName={whatsapp.providerName}
          timezone={whatsapp.timezone}
        />
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

      <TabsContent value="meta" className="grid gap-4">
        <p className="max-w-[72ch] text-[13.5px] text-text-secondary">
          A conta de anúncios que recebe as conversões de volta: quando um
          contato chega numa etapa com evento configurado na Jornada, a clínica
          devolve a conversão para a Meta medir o anúncio.
        </p>
        {meta ? (
          <MetaAdsTab
            conta={meta.conta}
            temToken={meta.temToken}
            podeGerenciar={podeGerenciar}
            dica={dica}
          />
        ) : (
          <ErroDaAba titulo="Não foi possível carregar a conta de anúncios" />
        )}
      </TabsContent>
    </Tabs>
  );
}
