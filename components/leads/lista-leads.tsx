"use client";

import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { createContext, useContext, type ReactNode } from "react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import {
  SeletorDeEtapa,
  useMudarEtapaDoLead,
} from "@/components/leads/etapa-do-lead";
import { EtiquetasDoLead } from "@/components/leads/etiquetas-do-lead";
import {
  BotaoEtiquetarLead,
  useEtiquetarUmLead,
} from "@/components/leads/etiquetar-um-lead";
import { dataLocal, tempoRelativo } from "@/components/leads/rotulos";
import { DataTable } from "@/components/shared/data-table";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CONSENT_STATUS, STATUS_TONE_VARS } from "@/lib/design/status";
import {
  SEM_TONS,
  type LeituraDasEtiquetas,
  type OpcaoDeEtiqueta,
  type TonsDasEtiquetas,
} from "@/lib/domain/etiquetas-do-lead";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import {
  campanhaDoContato,
  ehLeadDeAnuncio,
  textoDaOrigem,
} from "@/lib/domain/leads-ui";
import { formatarTelefone } from "@/lib/domain/telefone";
import type { LeadResumo, ReguaDaEtapa } from "@/lib/queries/leads";
import { cn } from "@/lib/utils";

// Visao em lista da Tela 4: tabela densa dentro de um Card, com cabecalho
// grudado e selecao multipla para as acoes em massa (docs/06 secao 5.4). A
// linha marcada ganha o selecionado do DS (lime suave e fio a esquerda). A
// autorizacao segue as 3 camadas (icone, rotulo, cor) do CONSENT_STATUS:
// nunca so cor.
//
// O NOME e um botao de verdade, do mesmo jeito que o cartao do Kanban: abaixo
// de 1024px a tela forca a lista, e sem ele o drawer so abriria com o mouse. O
// clique na linha continua valendo, e o botao segura o evento (o
// stopPropagation) para o drawer nao abrir duas vezes. Botao, e nao link,
// porque o drawer nao tem URL propria.
//
// Origem e Campanha (origem real do anuncio, 04/10/2026): a Origem junta
// canal, origem e plataforma ("Tráfego pago, Meta (Instagram)"); a Campanha
// do lead de anuncio vem de meta_anuncio pelo id do anuncio (lida junto com
// a lista, em fetchLeads) e, sem ela, diz que a Meta ainda nao identificou.
// Nome de campanha da Meta pode ser longo: a celula corta com reticencias e
// o texto inteiro fica no title e no drawer. Campo vazio continua vazio.
//
// Etiquetas (relato do dono em 20/10/2026: a etiqueta gravava, mas a lista
// nao mostrava): ate 2 chips e "+N", no tom da etiqueta cadastrada com o
// mesmo nome (sem ela, neutro). A lista inteira fica no title e no nome
// acessivel (etiquetas-do-lead.tsx). Sem etiqueta, nenhum chip.
//
// ETAPA E ETIQUETAS NA PROPRIA LINHA (pedido do dono em 20/10/2026, com o
// print da lista: "nao consigo alterar a etapa nem adicionar uma etiqueta
// por aqui, era pra eu conseguir"): o chip da etapa e um botao que abre as
// etapas da jornada (etapa-do-lead.tsx, as regras da barra em massa) e o
// "+" ao lado dos chips abre o painel de etiquetar daquele lead
// (etiquetar-um-lead.tsx). Os dois ficam num ControleDaLinha: o clique e o
// Enter ou Espaco param nele e nao abrem a gaveta. Sem permissao, visiveis e
// desabilitados com a dica.
//
// As colunas sao FIXAS (definidas fora do componente) e as celulas leem o
// que muda por contexto. Coluna recriada a cada render fazia o React montar
// todas as celulas de novo (o TanStack desenha cada celula como componente):
// o popover aberto fechava a cada mensagem que chegava pelo tempo real, e o
// foco se perdia ao escolher a etapa. Pelo mesmo motivo a linha e
// identificada pelo id do lead, nao pela posicao.

const SEM_OPCOES: readonly OpcaoDeEtiqueta[] = [];

/**
 * Controle dentro de uma linha da lista: o clique (e o Enter ou Espaco do
 * teclado) para nele e nao chega a linha, que abriria a gaveta. Vale tambem
 * para o que o controle abre: o React leva o evento do popover e do dialogo
 * pela arvore dos componentes, mesmo de dentro do portal.
 */
export function ControleDaLinha({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-controle-da-linha=""
      className={cn("inline-flex min-w-0 items-center", className)}
      onClick={(evento) => evento.stopPropagation()}
      onKeyDown={(evento) => {
        if (evento.key === "Enter" || evento.key === " ") {
          evento.stopPropagation();
        }
      }}
    >
      {children}
    </span>
  );
}

function Autorizacao({ autorizado }: { autorizado: boolean }) {
  const definicao = autorizado
    ? CONSENT_STATUS.autorizado
    : CONSENT_STATUS.sem_autorizacao;
  const Icone = definicao.icon;
  return (
    <span
      className="flex items-center gap-1.5 font-medium whitespace-nowrap"
      style={{ color: STATUS_TONE_VARS[definicao.tone].text }}
    >
      {Icone ? <Icone className="size-[15px] shrink-0" aria-hidden /> : null}
      {autorizado ? "Autorizado" : "Sem autorização"}
    </span>
  );
}

/** O que muda de um render para outro, lido pelas celulas. */
type DadosDaLista = {
  leads: LeadResumo[];
  membros: Record<string, string>;
  jornada: EtapaDaJornada[];
  reguas: ReguaDaEtapa[] | null;
  timezone: string;
  tonsDeEtiqueta: TonsDasEtiquetas;
  podeEditar: boolean;
  dica: string;
  etiquetasDaClinica: readonly OpcaoDeEtiqueta[];
  leituraDasEtiquetas: LeituraDasEtiquetas;
  aoTentarDeNovoAsEtiquetas?: () => void;
  selecionados: ReadonlySet<string>;
  onSelecionar: (id: string, marcado: boolean) => void;
  onSelecionarTodos: (ids: string[], marcado: boolean) => void;
  onAbrirLead: (lead: LeadResumo) => void;
  aoEscolherEtapa: (
    lead: LeadResumo,
    etapa: EtapaDaJornada,
    gatilho: HTMLElement | null,
  ) => void;
  aoAdicionarEtiqueta: (lead: LeadResumo, nome: string) => void;
  aoRemoverEtiqueta: (lead: LeadResumo, nome: string) => void;
};

const ContextoDaLista = createContext<DadosDaLista | null>(null);

function useDadosDaLista(): DadosDaLista {
  const dados = useContext(ContextoDaLista);
  if (dados === null) {
    throw new Error("Célula da lista de Leads fora da ListaLeads.");
  }
  return dados;
}

type Celula = CellContext<LeadResumo, unknown>;

function CabecalhoDaSelecao() {
  const { leads, selecionados, onSelecionarTodos } = useDadosDaLista();
  const marcadosNaTela = leads.filter((lead) =>
    selecionados.has(lead.id),
  ).length;
  const cabecalho: boolean | "indeterminate" =
    leads.length > 0 && marcadosNaTela === leads.length
      ? true
      : marcadosNaTela > 0
        ? "indeterminate"
        : false;
  return (
    <span className="flex">
      <Checkbox
        aria-label="Selecionar todos os leads visíveis"
        checked={cabecalho}
        onCheckedChange={(v) =>
          onSelecionarTodos(
            leads.map((lead) => lead.id),
            // Indeterminado vira "marcar todos", como nos leitores de
            // planilha: o proximo clique desmarca.
            v === true || v === "indeterminate",
          )
        }
      />
    </span>
  );
}

function CelulaDaSelecao({ row }: Celula) {
  const { selecionados, onSelecionar } = useDadosDaLista();
  return (
    <span className="flex" onClick={(e) => e.stopPropagation()}>
      <Checkbox
        aria-label={`Selecionar ${row.original.name ?? formatarTelefone(row.original.phone_e164)}`}
        checked={selecionados.has(row.original.id)}
        onCheckedChange={(v) => onSelecionar(row.original.id, v === true)}
      />
    </span>
  );
}

function CelulaDoNome({ row }: Celula) {
  const { onAbrirLead } = useDadosDaLista();
  const lead = row.original;
  return (
    <button
      type="button"
      aria-label={`Abrir ${lead.name ?? `Sem nome, ${formatarTelefone(lead.phone_e164)}`}`}
      onClick={(evento) => {
        evento.stopPropagation();
        onAbrirLead(lead);
      }}
      className={cn(
        "flex h-10 max-w-[240px] min-w-0 items-center gap-2 rounded-md text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
        lead.name ? "font-semibold text-text-strong" : "text-text-secondary",
      )}
    >
      <ContactAvatar name={lead.name} phone={lead.phone_e164} size={24} />
      <span className="truncate">{lead.name ?? "Sem nome"}</span>
    </button>
  );
}

function CelulaDoTelefone({ row }: Celula) {
  return (
    <span className="cz-num whitespace-nowrap">
      {formatarTelefone(row.original.phone_e164)}
    </span>
  );
}

function CelulaDaOrigem({ row }: Celula) {
  const texto = textoDaOrigem(row.original) ?? "";
  return (
    <span
      className="block max-w-[220px] truncate text-text-secondary"
      title={texto || undefined}
    >
      {texto}
    </span>
  );
}

function CelulaDaCampanha({ row }: Celula) {
  const lead = row.original;
  const campanha = campanhaDoContato(lead, lead.anuncio_meta);
  // "Sem campanha" de quem nao veio de anuncio fica vazio, como antes.
  const texto =
    campanha.tipo === "nenhuma" && !ehLeadDeAnuncio(lead) ? "" : campanha.texto;
  return (
    <span
      className="block max-w-[240px] truncate text-text-secondary"
      title={texto || undefined}
    >
      {texto}
    </span>
  );
}

function CelulaDaEtapa({ row }: Celula) {
  const { jornada, reguas, podeEditar, dica, aoEscolherEtapa } =
    useDadosDaLista();
  const lead = row.original;
  return (
    <ControleDaLinha>
      <SeletorDeEtapa
        lead={lead}
        jornada={jornada}
        reguas={reguas}
        podeEditar={podeEditar}
        dica={dica}
        aoEscolher={(etapa, gatilho) => aoEscolherEtapa(lead, etapa, gatilho)}
      />
    </ControleDaLinha>
  );
}

function CelulaDasEtiquetas({ row }: Celula) {
  const dados = useDadosDaLista();
  const lead = row.original;
  // O "+" fica ao lado dos chips, ou sozinho quando o lead nao tem etiqueta.
  return (
    <span className="flex items-center gap-1">
      <EtiquetasDoLead
        tags={lead.tags}
        tons={dados.tonsDeEtiqueta}
        className="max-w-[240px]"
      />
      <ControleDaLinha className="shrink-0">
        <BotaoEtiquetarLead
          lead={lead}
          podeEditar={dados.podeEditar}
          dica={dados.dica}
          opcoes={dados.etiquetasDaClinica}
          leitura={dados.leituraDasEtiquetas}
          aoTentarDeNovo={dados.aoTentarDeNovoAsEtiquetas}
          aoAdicionar={(nome) => dados.aoAdicionarEtiqueta(lead, nome)}
          aoRemover={(nome) => dados.aoRemoverEtiqueta(lead, nome)}
        />
      </ControleDaLinha>
    </span>
  );
}

function CelulaDoResponsavel({ row }: Celula) {
  const { membros } = useDadosDaLista();
  return (
    <span className="text-text-secondary">
      {row.original.owner_user_id
        ? (membros[row.original.owner_user_id] ?? "")
        : ""}
    </span>
  );
}

function CelulaDoUltimoContato({ row }: Celula) {
  return row.original.last_contact_at ? (
    <span className="whitespace-nowrap text-text-secondary">
      {tempoRelativo(row.original.last_contact_at)}
    </span>
  ) : (
    <span className="whitespace-nowrap text-text-secondary">Sem contato</span>
  );
}

function CelulaDaEntrada({ row }: Celula) {
  const { timezone } = useDadosDaLista();
  return (
    <span className="whitespace-nowrap">
      {dataLocal(row.original.first_contact_at, timezone)}
    </span>
  );
}

function CelulaDaAutorizacao({ row }: Celula) {
  return <Autorizacao autorizado={row.original.consent_ativo} />;
}

const COLUNAS: ColumnDef<LeadResumo>[] = [
  { id: "selecao", header: CabecalhoDaSelecao, cell: CelulaDaSelecao },
  { accessorKey: "name", header: "Nome", cell: CelulaDoNome },
  { accessorKey: "phone_e164", header: "Telefone", cell: CelulaDoTelefone },
  { accessorKey: "source_channel", header: "Origem", cell: CelulaDaOrigem },
  {
    accessorKey: "source_campaign",
    header: "Campanha",
    cell: CelulaDaCampanha,
  },
  { accessorKey: "funnel_stage", header: "Etapa", cell: CelulaDaEtapa },
  { id: "etiquetas", header: "Etiquetas", cell: CelulaDasEtiquetas },
  {
    accessorKey: "owner_user_id",
    header: "Responsável",
    cell: CelulaDoResponsavel,
  },
  {
    accessorKey: "last_contact_at",
    header: "Último contato",
    cell: CelulaDoUltimoContato,
  },
  {
    accessorKey: "first_contact_at",
    header: "Entrou em",
    meta: { align: "right" },
    cell: CelulaDaEntrada,
  },
  {
    accessorKey: "consent_ativo",
    header: "Autorização",
    cell: CelulaDaAutorizacao,
  },
];

const idDoLead = (lead: LeadResumo) => lead.id;

export function ListaLeads({
  clinicId,
  leads,
  membros,
  jornada,
  reguas,
  timezone,
  tonsDeEtiqueta = SEM_TONS,
  podeEditar,
  dica,
  etiquetasDaClinica = SEM_OPCOES,
  leituraDasEtiquetas = "pronto",
  aoTentarDeNovoAsEtiquetas,
  selecionados,
  onSelecionar,
  onSelecionarTodos,
  onAbrirLead,
}: {
  clinicId: string;
  leads: LeadResumo[];
  membros: Record<string, string>;
  jornada: EtapaDaJornada[];
  /** Etapas com regua de follow-up ligada; null quando nao deu para ler */
  reguas: ReguaDaEtapa[] | null;
  timezone: string;
  /** Tom das etiquetas cadastradas, pelo nome; sem catalogo, tudo neutro */
  tonsDeEtiqueta?: TonsDasEtiquetas;
  /** Muda a etapa e etiqueta na linha; sem permissao, desabilitado com a dica */
  podeEditar: boolean;
  dica: string;
  /** Cadastradas e em uso nos leads carregados, sem repetir */
  etiquetasDaClinica?: readonly OpcaoDeEtiqueta[];
  /** Leitura das cadastradas: sem ela, o painel avisa e fica com as em uso */
  leituraDasEtiquetas?: LeituraDasEtiquetas;
  aoTentarDeNovoAsEtiquetas?: () => void;
  selecionados: ReadonlySet<string>;
  onSelecionar: (id: string, marcado: boolean) => void;
  onSelecionarTodos: (ids: string[], marcado: boolean) => void;
  onAbrirLead: (lead: LeadResumo) => void;
}) {
  const etapa = useMudarEtapaDoLead({ clinicId, reguas });
  const etiquetas = useEtiquetarUmLead(clinicId);

  const dados: DadosDaLista = {
    leads,
    membros,
    jornada,
    reguas,
    timezone,
    tonsDeEtiqueta,
    podeEditar,
    dica,
    etiquetasDaClinica,
    leituraDasEtiquetas,
    aoTentarDeNovoAsEtiquetas,
    selecionados,
    onSelecionar,
    onSelecionarTodos,
    onAbrirLead,
    aoEscolherEtapa: etapa.escolher,
    aoAdicionarEtiqueta: etiquetas.adicionar,
    aoRemoverEtiqueta: etiquetas.remover,
  };

  return (
    <ContextoDaLista.Provider value={dados}>
      <Card>
        <DataTable
          variant="bare"
          stickyHeader
          columns={COLUNAS}
          data={leads}
          getRowId={idDoLead}
          onRowClick={onAbrirLead}
          isRowSelected={(lead) => selecionados.has(lead.id)}
          containerClassName="max-h-[min(720px,calc(100dvh-16rem))] cz-scroll"
        />
      </Card>
      {etapa.dialogos}
    </ContextoDaLista.Provider>
  );
}
