"use client";

import { Building2, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import {
  AGENTE_DA_CLINICA_STATUS,
  apoioDoAgente,
  contagemNoPainel,
  dataNaClinica,
  dolares,
  estadoDoGasto,
  filtrarClinicas,
  filtrosAtivos,
  GASTO_STATUS,
  lerFiltrosDoPainel,
  nenhumNumeroConectado,
  OPCOES_DA_SITUACAO,
  OPCOES_DO_AGENTE,
  quandoNaClinica,
  SITUACAO_DA_CONTA_STATUS,
  situacaoDaConta,
  textoDosNumeros,
  TEXTOS_DO_PAINEL,
  type FiltroDaSituacao,
  type FiltroDoAgente,
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

// Lista do Painel geral (onda 1): uma linha por clinica com a conta e o
// agente em 3 camadas (icone, rotulo e cor), os numeros conectados, o
// movimento dos ultimos 30 dias, a ultima mensagem recebida (no fuso de
// cada clinica, CLAUDE.md 3.6) e o gasto de IA contra o teto. So contagens:
// nenhum dado de paciente.
//
// Busca e filtros na URL, trocados com history.replaceState (o roteador do
// Next acompanha sem ir ao servidor): digitar na busca nao recarrega a
// pagina, e o link leva o mesmo recorte. A busca da tela e a do campo
// (estado local); a URL so acompanha. O vazio inicial (nenhuma clinica) e
// o vazio por filtro sao estados diferentes; o erro de leitura e o
// carregando ficam com a pagina (ErroDoPainel e loading.tsx).

type ParametroDaUrl = "busca" | "situacao" | "agente";

export function ListaDoPainel({
  clinicas,
  agoraIso,
}: {
  clinicas: ClinicaNoPainel[];
  /** O relogio do servidor na carga: "Hoje" e "Ontem" no fuso de cada clinica. */
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
    setParams({ busca: null, situacao: null, agente: null });
  };

  return (
    <section
      aria-label="Clínicas"
      className="flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative w-full sm:w-[280px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary"
          />
          <Input
            type="search"
            aria-label="Buscar clínica"
            placeholder="Clínica, administrador ou e-mail"
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
        <SegmentedControl<FiltroDaSituacao>
          ariaLabel="Situação da conta"
          className="max-w-full overflow-x-auto"
          value={filtros.situacao}
          onChange={(valor) =>
            setParams({ situacao: valor === "todas" ? null : valor })
          }
          options={OPCOES_DA_SITUACAO}
        />
        <SegmentedControl<FiltroDoAgente>
          ariaLabel="Agente de IA"
          className="max-w-full overflow-x-auto"
          value={filtros.agente}
          onChange={(valor) =>
            setParams({ agente: valor === "todos" ? null : valor })
          }
          options={OPCOES_DO_AGENTE}
        />
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
          <TableHead scope="col">Conta</TableHead>
          <TableHead scope="col">Agente</TableHead>
          <TableHead scope="col">Números</TableHead>
          <TableHead scope="col">Últimos 30 dias</TableHead>
          <TableHead scope="col">Última mensagem</TableHead>
          <TableHead scope="col">Gasto de IA</TableHead>
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
  const apoio = apoioDoAgente(clinica);
  const gasto = estadoDoGasto(
    clinica.gasto.ultimas24hCentavos,
    clinica.tetoDiarioCentavos,
  );
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
      <TableCell className="py-2">
        <div className="grid justify-items-start gap-1">
          <StatusChip
            size="sm"
            definition={AGENTE_DA_CLINICA_STATUS[clinica.agente.estado]}
          />
          {apoio ? (
            <span className="text-[12px] text-text-secondary">{apoio}</span>
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
            <span className="cz-num text-[12px] text-text-secondary">
              {textoDosNumeros(clinica)}
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
      <TableCell className="py-2 cz-num">
        {clinica.ultimaMensagemEm ? (
          quandoNaClinica(clinica.ultimaMensagemEm, clinica.fuso, agora)
        ) : (
          <span className="text-text-secondary">Nenhuma</span>
        )}
      </TableCell>
      <TableCell className="py-2">
        <div className="grid justify-items-start gap-0.5">
          <span>
            <span className="cz-num font-semibold text-text-strong">
              {dolares(clinica.gasto.ultimas24hCentavos)}
            </span>{" "}
            <span className="text-[12px] text-text-secondary">em 24 h</span>
          </span>
          <span className="text-[12px] text-text-secondary">
            {clinica.tetoDiarioCentavos === null ? (
              "Sem teto"
            ) : (
              <>
                Teto de{" "}
                <span className="cz-num">
                  {dolares(clinica.tetoDiarioCentavos)}
                </span>
              </>
            )}
          </span>
          <span className="text-[12px] text-text-secondary">
            <span className="cz-num">{dolares(clinica.gasto.mesCentavos)}</span>{" "}
            no mês
          </span>
          {gasto === "perto" || gasto === "atingido" ? (
            <StatusChip size="sm" definition={GASTO_STATUS[gasto]} />
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
