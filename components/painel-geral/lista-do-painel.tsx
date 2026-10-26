"use client";

import { Building2, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { AgenteNaLista } from "@/components/painel-geral/agente-na-lista";
import {
  contagemDaEquipe,
  contagemNoPainel,
  dataEHoraNaClinica,
  dataNaClinica,
  filtrarClinicas,
  filtrosAtivos,
  haQuantoTempo,
  lerFiltrosDoPainel,
  nenhumNumeroConectado,
  OPCOES_DA_CONTA,
  OPCOES_DO_AGENTE,
  OPCOES_DO_USO,
  quemEntrouNaLista,
  SITUACAO_DA_CONTA_STATUS,
  situacaoDaConta,
  textoDosNumeros,
  TEXTOS_DO_PAINEL,
  USO_DA_CLINICA_STATUS,
  type FiltroDaConta,
  type FiltroDoAgente,
  type FiltroDoUso,
  type FiltrosDoPainel,
} from "@/components/painel-geral/painel-geral";
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
import type { ClinicaNoPainel } from "@/lib/queries/painel-geral";

// Lista do Painel geral como acompanhamento de cliente (pedido do dono de
// 26/10/2026): uma linha por clinica com o ultimo acesso da equipe (quando,
// ha quanto tempo e quem, no fuso de cada clinica, CLAUDE.md 3.6), a
// equipe (ativas e pendentes), o WhatsApp, o agente de IA com o "Liberar
// agente" e o "Retirar agente" na propria linha, o movimento dos ultimos 30
// dias e a conta. Status em 3 camadas (icone, rotulo e cor); so o "Sem uso"
// vira chip no ultimo acesso (o que pede atencao). De paciente, so
// contagens; nome e e-mail sao da equipe da clinica. A equipe Conduzza com
// vinculo ativo conta como qualquer pessoa ativa (o desenho) e aparece
// marcada: "(equipe Conduzza)" depois do nome no ultimo acesso, e "Inclui 1
// da equipe Conduzza" na coluna Equipe, para o uso dela nao passar pelo da
// clinica.
//
// Ordem: o ultimo acesso mais recente primeiro, quem nunca entrou no fim (a
// mesma do banco). Busca e filtros na URL, trocados com
// history.replaceState (o roteador do Next acompanha sem ir ao servidor):
// digitar na busca nao recarrega a pagina, e o link leva o mesmo recorte. A
// busca da tela e a do campo (estado local); a URL so acompanha. O vazio
// inicial (nenhuma clinica) e o vazio por filtro sao estados diferentes; o
// erro de leitura e o carregando ficam com a pagina (ErroDoPainel e
// loading.tsx).

type ParametroDaUrl = "busca" | "uso" | "conta" | "agente";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const daUrl = useMemo(() => lerFiltrosDoPainel(searchParams), [searchParams]);
  const [busca, setBusca] = useState(daUrl.busca);
  const agora = useMemo(() => new Date(agoraIso), [agoraIso]);

  const filtros = useMemo<FiltrosDoPainel>(
    () => ({ ...daUrl, busca }),
    [daUrl, busca],
  );
  const visiveis = useMemo(
    () => filtrarClinicas(clinicas, filtros),
    [clinicas, filtros],
  );

  const setParams = useCallback(
    (mudancas: Partial<Record<ParametroDaUrl, string | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [chave, valor] of Object.entries(mudancas)) {
        if (valor === null || valor === undefined || valor === "") {
          params.delete(chave);
        } else {
          params.set(chave, valor);
        }
      }
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        qs ? `${pathname}?${qs}` : pathname,
      );
    },
    [pathname, searchParams],
  );

  const limpar = () => {
    setBusca("");
    setParams({ busca: null, uso: null, conta: null, agente: null });
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
              setParams({ busca: evento.target.value.trim() || null });
            }}
          />
        </div>
        <FiltroComNome nome="Uso">
          <SegmentedControl<FiltroDoUso>
            ariaLabel="Uso"
            className="max-w-full overflow-x-auto"
            value={filtros.uso}
            onChange={(valor) =>
              setParams({ uso: valor === "todas" ? null : valor })
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
              setParams({ conta: valor === "todas" ? null : valor })
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
              setParams({ agente: valor === "todos" ? null : valor })
            }
            options={OPCOES_DO_AGENTE}
          />
        </FiltroComNome>
        {filtrosAtivos(filtros) ? (
          <Button variant="ghost" onClick={limpar}>
            Limpar filtros
          </Button>
        ) : null}
        <p
          aria-live="polite"
          className="ml-auto cz-num text-[13px] text-text-secondary"
        >
          {visiveis.length === 1
            ? "1 clínica"
            : `${contagemNoPainel(visiveis.length)} clínicas`}
        </p>
      </div>

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
        <TabelaDoPainel clinicas={visiveis} agora={agora} />
      )}
    </section>
  );
}

/**
 * O nome visivel do filtro, ao lado do segmentado ("Uso", "Conta",
 * "Agente"): as tres barras comecam por "Todas" ou "Todos". O nome
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

function TabelaDoPainel({
  clinicas,
  agora,
}: {
  clinicas: ClinicaNoPainel[];
  agora: Date;
}) {
  return (
    <Table aria-label="Clínicas do sistema">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Clínica</TableHead>
          <TableHead scope="col">Último acesso</TableHead>
          <TableHead scope="col">Equipe</TableHead>
          <TableHead scope="col">WhatsApp</TableHead>
          <TableHead scope="col">Agente de IA</TableHead>
          <TableHead scope="col">Últimos 30 dias</TableHead>
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
        </div>
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
        <div className="grid gap-0.5">
          <span>
            <span className="cz-num">
              {contagemNoPainel(clinica.leads30Dias)}
            </span>{" "}
            <span className="text-text-secondary">
              {clinica.leads30Dias === 1 ? "lead" : "leads"}
            </span>
          </span>
          <span>
            <span className="cz-num">
              {contagemNoPainel(clinica.conversas30Dias)}
            </span>{" "}
            <span className="text-text-secondary">
              {clinica.conversas30Dias === 1 ? "conversa" : "conversas"}
            </span>
          </span>
        </div>
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
