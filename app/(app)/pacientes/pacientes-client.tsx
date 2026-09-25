"use client";

import { useQuery } from "@tanstack/react-query";
import { RotateCw, SearchX, UsersRound } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  FiltrosPacientes,
  type ValoresFiltrosPacientes,
} from "@/components/pacientes/filtros-pacientes";
import { IndicadoresDaLista } from "@/components/pacientes/indicadores-lista";
import { ListaPacientes } from "@/components/pacientes/lista-pacientes";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import {
  filtrarPacientes,
  indicadoresDaLista,
  type FiltrosDePacientes,
} from "@/lib/domain/pacientes-ui";
import {
  fetchPacientes,
  PACIENTES_LIMIT,
  pacientesKeys,
  type PacienteResumo,
} from "@/lib/queries/pacientes";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import { createClient } from "@/lib/supabase/client";

// Tela 9: UMA query da clinica (a RPC pacientes_resumo) com initialData do
// servidor, filtros na URL aplicados no cliente (filtrarPacientes, puro).
// Sem tempo real de proposito: a RPC agrega consulta e pacote, tabelas fora
// da publicacao de Realtime; a lista se atualiza quando a pessoa volta da
// ficha, que e quando o dado mudou. Abaixo de 1024px a tabela enxuga as
// colunas de apoio em vez de estourar a pagina.

function useTelaEstreita(): boolean {
  const [estreita, setEstreita] = useState(false);
  useEffect(() => {
    const consulta = window.matchMedia("(max-width: 1023px)");
    const atualizar = () => setEstreita(consulta.matches);
    atualizar();
    consulta.addEventListener("change", atualizar);
    return () => consulta.removeEventListener("change", atualizar);
  }, []);
  return estreita;
}

export function PacientesClient({
  clinicId,
  timezone,
  termoPacientes,
  termoConsulta,
  soDaSuaAgenda,
  pacientesIniciais,
  convenios,
  profissionais,
}: {
  clinicId: string;
  timezone: string;
  /** "pacientes" no vocabulario da clinica (white-label) */
  termoPacientes: string;
  /** "consulta" no vocabulario da clinica (white-label) */
  termoConsulta: string;
  /** Profissional: a RLS de appointment recorta a propria agenda */
  soDaSuaAgenda: boolean;
  pacientesIniciais: PacienteResumo[];
  convenios: { id: string; name: string }[];
  profissionais: { id: string; name: string }[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const telaEstreita = useTelaEstreita();

  // Revisita usa o dado que o servidor acabou de buscar, nao o cache parado
  // da visita anterior (initialData so vale na criacao da entrada).
  useDadosDoServidor(pacientesKeys.lista(clinicId), pacientesIniciais);

  const pacientesQuery = useQuery({
    queryKey: pacientesKeys.lista(clinicId),
    queryFn: () => fetchPacientes(supabase, clinicId),
    initialData: pacientesIniciais,
    staleTime: 30_000,
  });

  const valores: ValoresFiltrosPacientes = {
    falta: searchParams.get("falta") === "1",
    inativos: searchParams.get("inativos") === "1",
    pacote: searchParams.get("pacote") === "1",
    convenio: searchParams.get("convenio") ?? "",
    prof: searchParams.get("prof") ?? "",
  };
  const setParams = (mudancas: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === "") {
        params.delete(chave);
      } else {
        params.set(chave, valor);
      }
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Com initialData a query sempre tem dados definidos.
  const pacientes = pacientesQuery.data;

  // Um "agora" so por carga de dados, e o instante em que a carga chegou:
  // inativo e risco de falta sao derivados do relogio, e um Date novo por
  // linha faria a mesma lista responder diferente no meio da varredura.
  const carregadoEm = pacientesQuery.dataUpdatedAt;
  const agora = useMemo(
    () => new Date(carregadoEm || Date.now()),
    [carregadoEm],
  );

  const filtros = useMemo<FiltrosDePacientes>(
    () => ({
      comFalta: valores.falta || undefined,
      inativos: valores.inativos || undefined,
      comPacote: valores.pacote || undefined,
      convenio: valores.convenio || undefined,
      profissional: valores.prof || undefined,
    }),
    [
      valores.falta,
      valores.inativos,
      valores.pacote,
      valores.convenio,
      valores.prof,
    ],
  );

  const pacientesFiltrados = useMemo(
    () => filtrarPacientes(pacientes, filtros, agora),
    [pacientes, filtros, agora],
  );

  const limparFiltros = () =>
    setParams({
      falta: null,
      inativos: null,
      pacote: null,
      convenio: null,
      prof: null,
    });

  const vazioInicial = !pacientesQuery.isError && pacientes.length === 0;
  const semDado = pacientesQuery.isError && pacientes.length === 0;

  // Indicadores do topo (decisao C28 do dono) contados sobre a lista INTEIRA,
  // nao sobre o recorte dos filtros: sao o retrato da clinica.
  const indicadores = useMemo(
    () => indicadoresDaLista(pacientes, agora, timezone),
    [pacientes, agora, timezone],
  );
  const tentarDeNovo = () => void pacientesQuery.refetch();

  return (
    <>
      {soDaSuaAgenda ? (
        <Aviso tom="info" role="note">
          Você vê só as consultas da sua agenda. Última e próxima consulta,
          comparecimento e sinais contam só elas.
        </Aviso>
      ) : null}

      {semDado ? null : (
        <IndicadoresDaLista
          indicadores={indicadores}
          agora={agora}
          timezone={timezone}
          termoPacientes={termoPacientes}
          termoConsulta={termoConsulta}
          soDaSuaAgenda={soDaSuaAgenda}
          noLimite={pacientes.length >= PACIENTES_LIMIT}
        />
      )}

      <div className="flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <FiltrosPacientes
            valores={valores}
            convenios={convenios}
            profissionais={profissionais}
            aoMudar={(campo, valor) =>
              setParams({
                [campo]:
                  typeof valor === "boolean" ? (valor ? "1" : null) : valor,
              })
            }
            aoLimpar={limparFiltros}
          />
        </div>

        {pacientesQuery.isError && pacientes.length > 0 ? (
          <Aviso
            tom="warning"
            className="m-3 mb-0"
            acao={
              <Button variant="ghost" onClick={tentarDeNovo}>
                <RotateCw aria-hidden />
                Tentar de novo
              </Button>
            }
          >
            Não foi possível atualizar a lista. Os dados exibidos podem estar
            desatualizados.
          </Aviso>
        ) : null}

        {semDado ? (
          <EmptyState
            tom="erro"
            title="Não foi possível carregar os pacientes"
            description="Confira a conexão e tente de novo. Nada foi perdido."
          >
            <Button variant="outline" onClick={tentarDeNovo}>
              <RotateCw aria-hidden />
              Tentar de novo
            </Button>
          </EmptyState>
        ) : pacientesQuery.isLoading ? (
          <TableSkeleton columns={telaEstreita ? 5 : 8} variant="bare" />
        ) : vazioInicial ? (
          <EmptyState
            icon={UsersRound}
            title="Nenhum paciente ainda"
            description="A pessoa entra aqui quando tem a primeira consulta marcada. Quem ainda não agendou fica em Leads."
            action={{
              label: "Abrir a agenda",
              href: "/agenda",
              variant: "outline",
            }}
          />
        ) : pacientesFiltrados.length === 0 ? (
          <EmptyState
            compact
            icon={SearchX}
            title="Nenhum paciente com esses filtros"
            description="Ajuste os filtros ou limpe para ver todos os pacientes."
            onClearFilters={limparFiltros}
          />
        ) : (
          <ListaPacientes
            pacientes={pacientesFiltrados}
            timezone={timezone}
            telaEstreita={telaEstreita}
            agora={agora}
            onAbrirFicha={(paciente) =>
              router.push(`/pacientes/${paciente.contact_id}`)
            }
          />
        )}
      </div>
    </>
  );
}
