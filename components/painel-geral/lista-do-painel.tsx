"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Search,
  SearchX,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AgenteNaLista } from "@/components/painel-geral/agente-na-lista";
import { corpoDoPedidoDoPainel } from "@/components/painel-geral/exportacao-do-painel";
import {
  AvisoDaExportacao,
  BotaoExportarPainel,
  useExportacaoDoPainel,
} from "@/components/painel-geral/exportar-painel";
import { ImplantacaoNaLinha } from "@/components/painel-geral/implantacao-da-clinica";
import {
  contagemDaEquipe,
  contagemNoPainel,
  dataEHoraNaClinica,
  dataNaClinica,
  dolares,
  dolaresPrecisos,
  filtrarClinicas,
  filtrosAtivos,
  haQuantoTempo,
  nenhumNumeroConectado,
  OPCOES_DA_CONTA,
  OPCOES_DA_SAUDE,
  OPCOES_DO_AGENTE,
  OPCOES_DO_USO,
  ordenarClinicas,
  proximaOrdem,
  quemEntrouNaLista,
  semUsoDeIa,
  SITUACAO_DA_CONTA_STATUS,
  situacaoDaConta,
  textoDasChamadas,
  textoDosNumeros,
  TEXTOS_DO_PAINEL,
  USO_DA_CLINICA_STATUS,
  type ColunaDaOrdem,
  type FiltroDaConta,
  type FiltroDaSaude,
  type FiltroDoAgente,
  type FiltroDoUso,
  type FiltrosDoPainel,
  type OrdemDaLista,
} from "@/components/painel-geral/painel-geral";
import { useParametrosDaLista } from "@/components/painel-geral/parametros-da-lista";
import { SaudeNaLinha } from "@/components/painel-geral/sinais-da-clinica";
import { TendenciaNaLinha } from "@/components/painel-geral/tendencia";
import { EmptyState } from "@/components/shared/empty-state";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WHATSAPP_CONNECTION_STATUS } from "@/lib/design/status";
import type {
  ClinicaNoPainel,
  TendenciaNoPainel,
} from "@/lib/queries/painel-geral";
import { cn } from "@/lib/utils";

// Lista do Painel geral como acompanhamento de cliente (pedido do dono de
// 26/10/2026): uma linha por clinica com o ultimo acesso da equipe (quando,
// ha quanto tempo e quem, no fuso de cada clinica, CLAUDE.md 3.6), a
// equipe (ativas e pendentes), o WhatsApp, o agente de IA com o "Liberar
// agente" e o "Retirar agente" na propria linha, o movimento dos ultimos 30
// dias e a conta. Status em 3 camadas (icone, rotulo e cor). De paciente,
// so contagens; nome e e-mail sao da equipe da clinica. A equipe Conduzza
// com vinculo ativo conta como qualquer pessoa ativa (o desenho) e aparece
// marcada: "(equipe Conduzza)" depois do nome no ultimo acesso, e "Inclui 1
// da equipe Conduzza" na coluna Equipe.
//
// Segunda leva (26/10/2026, escolhas do dono): a coluna Saude (a saude e
// cada sinal de alerta aceso, em 3 camadas), a coluna IA no mes (o gasto do
// mes com a precisao real, as chamadas e o teto por dia; sem agente e sem
// gasto, "Sem uso de IA"), Leads e Conversas em colunas proprias com a
// tendencia contra os 30 dias anteriores, a Implantacao ("N de 6 passos",
// com os passos na dica), a data da ultima nota interna embaixo do nome, o
// filtro de saude, o "Exportar" e a ordem por coluna (clique no cabecalho,
// com aria-sort).
//
// Ordem: sem clique, o ultimo acesso mais recente primeiro (a do banco).
// Busca, filtros e ordem na URL (parametros-da-lista), trocados com
// history.replaceState (o roteador do Next acompanha sem ir ao servidor):
// digitar na busca nao recarrega a pagina, e o link leva o mesmo recorte. A
// busca da tela e a do campo (estado local); a URL so acompanha. O vazio
// inicial (nenhuma clinica) e o vazio por filtro sao estados diferentes; o
// erro de leitura e o carregando ficam com a pagina (ErroDoPainel e
// loading.tsx).

export function ListaDoPainel({
  clinicas,
  agoraIso,
}: {
  clinicas: ClinicaNoPainel[];
  /**
   * O relogio do banco na leitura (gerado_em): "Hoje", "Ontem" e "Há N
   * dias" no fuso de cada clinica, pelo mesmo relogio do "Em uso".
   */
  agoraIso: string;
}) {
  const {
    filtros: daUrl,
    ordem,
    definir,
    definirOrdem,
  } = useParametrosDaLista();
  const [busca, setBusca] = useState(daUrl.busca);
  const agora = useMemo(() => new Date(agoraIso), [agoraIso]);

  const filtros = useMemo<FiltrosDoPainel>(
    () => ({ ...daUrl, busca }),
    [daUrl, busca],
  );
  const visiveis = useMemo(
    () => ordenarClinicas(filtrarClinicas(clinicas, filtros), ordem),
    [clinicas, filtros, ordem],
  );
  const exportacao = useExportacaoDoPainel(
    corpoDoPedidoDoPainel(filtros, ordem),
  );

  const limpar = () => {
    setBusca("");
    definir({ busca: null, uso: null, conta: null, agente: null, saude: null });
  };

  return (
    <section
      aria-label="Clínicas"
      className="flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border p-3">
        <div className="relative w-full sm:w-[280px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary"
          />
          <Input
            type="search"
            aria-label="Buscar clínica"
            placeholder={TEXTOS_DO_PAINEL.buscaPlaceholder}
            autoComplete="off"
            className="h-10 pl-9"
            value={busca}
            maxLength={80}
            onChange={(evento) => {
              setBusca(evento.target.value);
              definir({ busca: evento.target.value.trim() || null });
            }}
          />
        </div>
        <FiltroComNome nome="Saúde">
          <SegmentedControl<FiltroDaSaude>
            ariaLabel="Saúde"
            className="max-w-full overflow-x-auto"
            value={filtros.saude}
            onChange={(valor) =>
              definir({ saude: valor === "todas" ? null : valor })
            }
            options={OPCOES_DA_SAUDE}
          />
        </FiltroComNome>
        <FiltroComNome nome="Uso">
          <SegmentedControl<FiltroDoUso>
            ariaLabel="Uso"
            className="max-w-full overflow-x-auto"
            value={filtros.uso}
            onChange={(valor) =>
              definir({ uso: valor === "todas" ? null : valor })
            }
            options={OPCOES_DO_USO}
          />
        </FiltroComNome>
        <FiltroComNome nome="Conta">
          <SegmentedControl<FiltroDaConta>
            ariaLabel="Conta"
            className="max-w-full overflow-x-auto"
            value={filtros.conta}
            onChange={(valor) =>
              definir({ conta: valor === "todas" ? null : valor })
            }
            options={OPCOES_DA_CONTA}
          />
        </FiltroComNome>
        <FiltroComNome nome="Agente">
          <SegmentedControl<FiltroDoAgente>
            ariaLabel="Agente de IA"
            className="max-w-full overflow-x-auto"
            value={filtros.agente}
            onChange={(valor) =>
              definir({ agente: valor === "todos" ? null : valor })
            }
            options={OPCOES_DO_AGENTE}
          />
        </FiltroComNome>
        {filtrosAtivos(filtros) ? (
          <Button variant="ghost" onClick={limpar}>
            Limpar filtros
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          <p
            aria-live="polite"
            className="cz-num text-[13px] text-text-secondary"
          >
            {visiveis.length === 1
              ? "1 clínica"
              : `${contagemNoPainel(visiveis.length)} clínicas`}
          </p>
          <BotaoExportarPainel
            temClinicas={visiveis.length > 0}
            exportando={exportacao.exportando}
            aoExportar={exportacao.exportar}
          />
        </div>
      </div>

      {exportacao.aviso ? (
        <div className="border-b border-border p-3">
          <AvisoDaExportacao
            aviso={exportacao.aviso}
            aoDispensar={exportacao.dispensar}
            aoTentarDeNovo={exportacao.exportar}
          />
        </div>
      ) : null}

      {clinicas.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={TEXTOS_DO_PAINEL.vazio}
          description={TEXTOS_DO_PAINEL.vazioDescricao}
        />
      ) : visiveis.length === 0 ? (
        <EmptyState
          compact
          icon={SearchX}
          title={TEXTOS_DO_PAINEL.vazioPorFiltro}
          description={TEXTOS_DO_PAINEL.vazioPorFiltroDescricao}
          onClearFilters={limpar}
        />
      ) : (
        <TabelaDoPainel
          clinicas={visiveis}
          agora={agora}
          ordem={ordem}
          aoOrdenar={(coluna) => definirOrdem(proximaOrdem(ordem, coluna))}
        />
      )}
    </section>
  );
}

/**
 * O nome visivel do filtro, ao lado do segmentado ("Saúde", "Uso",
 * "Conta", "Agente"): as barras comecam por "Todas" ou "Todos". O nome
 * acessivel do grupo e o ariaLabel do segmentado.
 */
function FiltroComNome({
  nome,
  children,
}: {
  nome: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex max-w-full min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="text-[12px] font-semibold whitespace-nowrap text-text-secondary"
      >
        {nome}
      </span>
      {children}
    </div>
  );
}

/**
 * O cabecalho que ordena: o botao com o nome da coluna (40px) e a seta do
 * sentido; aria-sort no proprio cabecalho diz a ordem ao leitor de tela
 * ("ascending", "descending" ou "none" nas outras colunas que ordenam).
 */
function CabecalhoQueOrdena({
  coluna,
  rotulo,
  ordem,
  aoOrdenar,
}: {
  coluna: ColunaDaOrdem;
  rotulo: string;
  ordem: OrdemDaLista;
  aoOrdenar: (coluna: ColunaDaOrdem) => void;
}) {
  const ativa = ordem.coluna === coluna;
  const Seta = ativa
    ? ordem.sentido === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <TableHead
      scope="col"
      className="py-0"
      aria-sort={
        ativa ? (ordem.sentido === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => aoOrdenar(coluna)}
        className={cn(
          "-mx-1.5 inline-flex min-h-10 items-center gap-1 rounded-md px-1.5 cz-eyebrow whitespace-nowrap cz-transition hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus focus-visible:outline-solid",
          ativa ? "text-text-strong" : "text-text-secondary",
        )}
      >
        {rotulo}
        <Seta aria-hidden className="size-3.5 shrink-0" />
      </button>
    </TableHead>
  );
}

function TabelaDoPainel({
  clinicas,
  agora,
  ordem,
  aoOrdenar,
}: {
  clinicas: ClinicaNoPainel[];
  agora: Date;
  ordem: OrdemDaLista;
  aoOrdenar: (coluna: ColunaDaOrdem) => void;
}) {
  const ordenavel = (coluna: ColunaDaOrdem, rotulo: string) => (
    <CabecalhoQueOrdena
      coluna={coluna}
      rotulo={rotulo}
      ordem={ordem}
      aoOrdenar={aoOrdenar}
    />
  );
  return (
    <Table aria-label="Clínicas do sistema">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Clínica</TableHead>
          {ordenavel("saude", "Saúde")}
          {ordenavel("ultimo_acesso", "Último acesso")}
          <TableHead scope="col">Equipe</TableHead>
          <TableHead scope="col">WhatsApp</TableHead>
          <TableHead scope="col">Agente de IA</TableHead>
          {ordenavel("ia", "IA no mês")}
          {ordenavel("leads", "Leads em 30 dias")}
          {ordenavel("conversas", "Conversas em 30 dias")}
          {ordenavel("implantacao", "Implantação")}
          <TableHead scope="col">Conta</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clinicas.map((clinica) => (
          <LinhaDaClinica key={clinica.id} clinica={clinica} agora={agora} />
        ))}
      </TableBody>
    </Table>
  );
}

function LinhaDaClinica({
  clinica,
  agora,
}: {
  clinica: ClinicaNoPainel;
  agora: Date;
}) {
  const situacao = situacaoDaConta(clinica);
  return (
    <TableRow>
      <TableCell className="min-w-[180px] py-2 whitespace-normal">
        <div className="grid gap-0.5">
          <Link
            href={`/painel-geral/${clinica.id}`}
            className="inline-flex min-h-10 items-center font-semibold break-words text-text-strong underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {clinica.nome}
          </Link>
          <span className="cz-num text-[12px] text-text-secondary">
            Criada em {dataNaClinica(clinica.criadaEm, clinica.fuso)}
          </span>
          {clinica.ultimaNotaEm ? (
            <span className="cz-num text-[12px] text-text-secondary">
              {TEXTOS_DO_PAINEL.ultimaNotaEm(
                dataNaClinica(clinica.ultimaNotaEm, clinica.fuso),
              )}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="min-w-[170px] py-2 whitespace-normal">
        <SaudeNaLinha clinica={clinica} />
      </TableCell>
      <TableCell className="min-w-[170px] py-2 whitespace-normal">
        <UltimoAcessoNaLinha clinica={clinica} agora={agora} />
      </TableCell>
      <TableCell className="py-2">
        <div className="grid gap-0.5">
          <ContagemDaEquipe valor={clinica.membrosAtivos} tipo="ativas" />
          <ContagemDaEquipe
            valor={clinica.membrosPendentes}
            tipo="pendentes"
            className="text-[12px]"
          />
          {clinica.membrosEquipeConduzza > 0 ? (
            <span className="text-[12px] text-text-secondary">
              {TEXTOS_DO_PAINEL.incluiEquipeConduzza(
                clinica.membrosEquipeConduzza,
              )}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="py-2">
        {nenhumNumeroConectado(clinica) ? (
          <div className="grid justify-items-start gap-1">
            <StatusChip
              size="sm"
              definition={WHATSAPP_CONNECTION_STATUS.desconectado}
              label="Nenhum conectado"
            />
            <span className="text-[12px] text-text-secondary">
              <span className="cz-num">{textoDosNumeros(clinica)}</span>{" "}
              conectados
            </span>
          </div>
        ) : clinica.numerosTotal === 0 ? (
          <span className="text-text-secondary">
            {textoDosNumeros(clinica)}
          </span>
        ) : (
          <span>
            <span className="cz-num">{textoDosNumeros(clinica)}</span>{" "}
            <span className="text-text-secondary">conectados</span>
          </span>
        )}
      </TableCell>
      <TableCell className="py-2">
        <AgenteNaLista
          clinicId={clinica.id}
          nome={clinica.nome}
          estado={clinica.agente.estado}
          suspensa={clinica.suspensao !== null}
          tetoDiarioCentavos={clinica.tetoDiarioCentavos}
        />
      </TableCell>
      <TableCell className="py-2">
        <IaNoMesNaLinha clinica={clinica} />
      </TableCell>
      <TableCell className="py-2">
        <MovimentoNaLinha
          valor={clinica.leads30Dias}
          tendencia={clinica.tendencia.leads}
          singular="lead"
          plural="leads"
        />
      </TableCell>
      <TableCell className="py-2">
        <MovimentoNaLinha
          valor={clinica.conversas30Dias}
          tendencia={clinica.tendencia.conversas}
          singular="conversa"
          plural="conversas"
        />
      </TableCell>
      <TableCell className="py-2">
        <ImplantacaoNaLinha clinica={clinica} />
      </TableCell>
      <TableCell className="py-2">
        <div className="grid justify-items-start gap-1">
          <StatusChip
            size="sm"
            definition={SITUACAO_DA_CONTA_STATUS[situacao]}
          />
          {clinica.suspensao ? (
            <span className="cz-num text-[12px] text-text-secondary">
              Desde {dataNaClinica(clinica.suspensao.suspensaEm, clinica.fuso)}
            </span>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * IA no mes: o gasto do mes com a precisao real ("US$ 0,001"; nunca "US$
 * 0,00" quando houve gasto), as chamadas e, quando ha, o teto por dia. Sem
 * agente liberado, sem gasto e sem chamada: "Sem uso de IA".
 */
function IaNoMesNaLinha({ clinica }: { clinica: ClinicaNoPainel }) {
  if (semUsoDeIa(clinica)) {
    return (
      <span className="text-text-secondary">{TEXTOS_DO_PAINEL.semUsoDeIa}</span>
    );
  }
  return (
    <div className="grid gap-0.5">
      <span className="cz-num font-semibold text-text-strong">
        {dolaresPrecisos(clinica.gasto.mesMicrodolares)}
      </span>
      <span className="text-[12px] text-text-secondary">
        {textoDasChamadas(clinica.gasto.mesChamadas)}
      </span>
      {clinica.tetoDiarioCentavos !== null ? (
        <span className="cz-num text-[12px] text-text-secondary">
          {TEXTOS_DO_PAINEL.tetoPorDia(dolares(clinica.tetoDiarioCentavos))}
        </span>
      ) : null}
    </div>
  );
}

/** "14 leads" e, embaixo, a tendencia contra os 30 dias anteriores. */
function MovimentoNaLinha({
  valor,
  tendencia,
  singular,
  plural,
}: {
  valor: number;
  tendencia: TendenciaNoPainel;
  singular: string;
  plural: string;
}) {
  return (
    <div className="grid justify-items-start gap-0.5">
      <span>
        <span className="cz-num">{contagemNoPainel(valor)}</span>{" "}
        <span className="text-text-secondary">
          {valor === 1 ? singular : plural}
        </span>
      </span>
      <TendenciaNaLinha tendencia={tendencia} />
    </div>
  );
}

/** "3 ativas": o numero em mono e a palavra no texto; sem nenhuma, a frase. */
function ContagemDaEquipe({
  valor,
  tipo,
  className,
}: {
  valor: number;
  tipo: "ativas" | "pendentes";
  className?: string;
}) {
  const { numero, palavra } = contagemDaEquipe(valor, tipo);
  return (
    <span className={className}>
      {numero ? (
        <>
          <span className="cz-num">{numero}</span>{" "}
        </>
      ) : null}
      <span className="text-text-secondary">{palavra}</span>
    </span>
  );
}

/**
 * Quando e quem: ha quanto tempo, o dia e a hora no fuso da clinica e o
 * nome da pessoa (com "(equipe Conduzza)" quando foi ela). Sem uso (mais de
 * 30 dias, ou nunca), o chip em 3 camadas em cima; quem nunca entrou,
 * "Ninguém entrou ainda".
 */
function UltimoAcessoNaLinha({
  clinica,
  agora,
}: {
  clinica: ClinicaNoPainel;
  agora: Date;
}) {
  const acesso = clinica.ultimoAcesso;
  return (
    <div className="grid justify-items-start gap-0.5">
      {clinica.emUso ? null : (
        <StatusChip
          size="sm"
          className="mb-0.5"
          definition={USO_DA_CLINICA_STATUS.sem_uso}
        />
      )}
      {acesso ? (
        <>
          <span className="font-semibold text-text-strong">
            {haQuantoTempo(acesso.em, clinica.fuso, agora)}
          </span>
          <span className="cz-num text-[12px] text-text-secondary">
            {dataEHoraNaClinica(acesso.em, clinica.fuso)}
          </span>
          <span className="text-[12px] break-words text-text-secondary">
            por {quemEntrouNaLista(acesso)}
          </span>
        </>
      ) : (
        <span className="text-text-secondary">
          {TEXTOS_DO_PAINEL.ninguemEntrou}
        </span>
      )}
    </div>
  );
}
