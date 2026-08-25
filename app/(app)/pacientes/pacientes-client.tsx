"use client";

import { useQuery } from "@tanstack/react-query";
import { SearchX, TriangleAlert, UsersRound } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  FiltrosPacientes,
  type ValoresFiltrosPacientes,
} from "@/components/pacientes/filtros-pacientes";
import { ListaPacientes } from "@/components/pacientes/lista-pacientes";
import { EmptyState } from "@/components/shared/empty-state";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import {
  filtrarPacientes,
  type FiltrosDePacientes,
} from "@/lib/domain/pacientes-ui";
import {
  fetchPacientes,
  pacientesKeys,
  type PacienteResumo,
} from "@/lib/queries/pacientes";
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
  pacientesIniciais,
  convenios,
  profissionais,
}: {
  clinicId: string;
  timezone: string;
  pacientesIniciais: PacienteResumo[];
  convenios: { id: string; name: string }[];
  profissionais: { id: string; name: string }[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const telaEstreita = useTelaEstreita();

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

  return (
    <div className="grid gap-4">
      <FiltrosPacientes
        valores={valores}
        convenios={convenios}
        profissionais={profissionais}
        aoMudar={(campo, valor) =>
          setParams({
            [campo]: typeof valor === "boolean" ? (valor ? "1" : null) : valor,
          })
        }
        aoLimpar={limparFiltros}
      />

      {pacientesQuery.isError && pacientes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
          <TriangleAlert
            strokeWidth={1.5}
            className="size-4 shrink-0 [color:var(--alert)]"
            aria-hidden
          />
          <p className="text-sm text-text-secondary">
            Não foi possível atualizar a lista. Os dados exibidos podem estar
            desatualizados.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => void pacientesQuery.refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : null}

      {pacientesQuery.isError && pacientes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
          <TriangleAlert
            strokeWidth={1.5}
            className="size-5 [color:var(--alert)]"
            aria-hidden
          />
          <p className="text-sm text-text-secondary">
            Não foi possível carregar os pacientes.
          </p>
          <Button
            variant="outline"
            onClick={() => void pacientesQuery.refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : pacientesQuery.isLoading ? (
        <TableSkeleton columns={telaEstreita ? 5 : 8} />
      ) : vazioInicial ? (
        <EmptyState
          icon={UsersRound}
          title="Nenhum paciente ainda"
          description="A pessoa entra aqui quando tem a primeira consulta marcada. Quem ainda não agendou fica em Leads."
          action={{ label: "Abrir a agenda", href: "/agenda" }}
        />
      ) : pacientesFiltrados.length === 0 ? (
        <EmptyState
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
  );
}
