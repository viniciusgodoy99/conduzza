"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ListChecks,
  Plus,
  RotateCcw,
  Search,
  User,
  Users,
  X,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import {
  equipeDaAtividadeAction,
  listarAtividadesAction,
} from "@/app/(app)/atividades/actions";
import { DialogoDeAtividade } from "@/components/atividades/dialogo-de-atividade";
import {
  LinhaDeAtividade,
  type AcoesDaLinha,
  type ContextoDaLinha,
} from "@/components/atividades/linha-de-atividade";
import { useAcoesDeAtividade } from "@/components/atividades/use-acoes-de-atividade";
import { useAgora } from "@/components/atividades/use-agora";
import { Aviso } from "@/components/shared/aviso";
import { AvisoCelular } from "@/components/shared/aviso-celular";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  agruparAtividades,
  casaComQuem,
  contarPendencias,
  FILTROS_DE_SITUACAO,
  filtrarAtividades,
  hojeNaClinica,
  lerFiltrosDeAtividades,
  SEM_RESPONSAVEL,
  type FiltroDeSituacao,
  type QuemDaLista,
} from "@/lib/domain/atividades";
import { formatarTelefone } from "@/lib/domain/telefone";
import { useDadosDoServidor } from "@/lib/hooks/use-dados-do-servidor";
import {
  ATIVIDADES_PENDENTES_LIMITE,
  atividadesKeys,
  type AtividadeResumo,
  type ContatoDaAtividade,
  type EquipeDaAtividade,
  type ListaDeAtividades,
} from "@/lib/queries/atividades";
import { leadsKeys } from "@/lib/queries/leads";

// Tela Atividades. UMA lista da clinica (pendentes e concluidas dos ultimos
// 30 dias) com initialData do servidor, filtrada no cliente pelos filtros da
// URL: quem (Minhas, o padrao, ou Todas), situacao, responsavel, busca e
// contato. Os filtros trocam a URL com history.replaceState, que o roteador
// do Next acompanha sem ir ao servidor: digitar na busca nao recarrega a
// pagina nem grava trilha a cada letra. A recarga depois de uma acao passa
// pela listarAtividadesAction, que grava a trilha de leitura.
//
// Agrupamento por prazo no fuso da clinica: Atrasadas, Hoje, Amanha,
// Proximos 7 dias e Depois; no filtro Concluidas, um grupo so.

const QUEM: readonly {
  value: QuemDaLista;
  label: string;
  icon: typeof User;
}[] = [
  { value: "minhas", label: "Minhas", icon: User },
  { value: "todas", label: "Todas", icon: Users },
];

const ROTULO_DA_SITUACAO: Record<FiltroDeSituacao, string> = {
  pendentes: "Todas as pendentes",
  atrasadas: "Atrasadas",
  hoje: "Para hoje",
  proximas: "Próximas",
  concluidas: "Concluídas (30 dias)",
};

const VAZIO_DA_SITUACAO: Record<
  FiltroDeSituacao,
  { titulo: string; descricao: string }
> = {
  pendentes: {
    titulo: "Nenhuma atividade pendente",
    descricao: "Tudo em dia por aqui.",
  },
  atrasadas: {
    titulo: "Nada atrasado",
    descricao: "Nenhuma atividade passou do prazo.",
  },
  hoje: {
    titulo: "Nada para hoje",
    descricao: "Nenhuma atividade vence hoje.",
  },
  proximas: {
    titulo: "Nada para os próximos dias",
    descricao: "Nenhuma atividade marcada para depois de hoje.",
  },
  concluidas: {
    titulo: "Nenhuma atividade concluída",
    descricao: "Nada foi concluído nos últimos 30 dias.",
  },
};

type ParametroDaUrl = "quem" | "filtro" | "resp" | "busca" | "contato";

function plural(n: number, um: string, varios: string): string {
  return n === 1 ? um : varios;
}

export function AtividadesClient({
  clinicId,
  timezone,
  eu,
  listaInicial,
  equipeInicial,
  agoraInicial,
  podeEditar,
  dica,
}: {
  clinicId: string;
  timezone: string;
  eu: string;
  /** null: a leitura falhou no servidor (a tela mostra o erro e tenta de novo) */
  listaInicial: ListaDeAtividades | null;
  equipeInicial: EquipeDaAtividade | null;
  agoraInicial: string;
  podeEditar: boolean;
  dica: string;
}) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useDadosDoServidor(atividadesKeys.lista(clinicId), listaInicial ?? undefined);
  const listaQuery = useQuery({
    queryKey: atividadesKeys.lista(clinicId),
    queryFn: async () => {
      const resultado = await listarAtividadesAction();
      if (!resultado.ok) {
        throw new Error(resultado.error);
      }
      return resultado.lista;
    },
    initialData: listaInicial ?? undefined,
    staleTime: 30_000,
  });

  const equipeQuery = useQuery({
    queryKey: [...atividadesKeys.equipe, clinicId],
    queryFn: async () => {
      const resultado = await equipeDaAtividadeAction();
      if (!resultado.ok) {
        throw new Error(resultado.error);
      }
      return resultado.equipe;
    },
    initialData: equipeInicial ?? undefined,
    staleTime: 5 * 60_000,
  });
  const equipe = equipeQuery.data;

  const agora = useAgora(agoraInicial);
  const hoje = hojeNaClinica(timezone, agora);

  const filtros = useMemo(
    () => lerFiltrosDeAtividades(searchParams),
    [searchParams],
  );
  const [busca, setBusca] = useState(filtros.busca);
  const [novaAberta, setNovaAberta] = useState(false);
  const [editando, setEditando] = useState<AtividadeResumo | null>(null);

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

  const invalidar = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: atividadesKeys.todas });
    // O drawer do lead traz as atividades dentro do detalhe.
    void queryClient.invalidateQueries({ queryKey: leadsKeys.detalhes });
  }, [queryClient]);

  const base = useMemo(
    () => listaQuery.data?.atividades ?? [],
    [listaQuery.data],
  );
  const acoes = useAcoesDeAtividade({ lista: base, aoMudar: invalidar });
  const lista = acoes.lista;

  // A busca da tela e a do campo (estado local), nao a da URL: a URL so
  // acompanha, para o link levar a mesma busca.
  const filtrosEfetivos = useMemo(
    () => ({ ...filtros, busca }),
    [filtros, busca],
  );
  const filtradas = useMemo(
    () => filtrarAtividades(lista, filtrosEfetivos, { eu, agora, hoje }),
    [lista, filtrosEfetivos, eu, agora, hoje],
  );
  const grupos = useMemo(
    () => agruparAtividades(filtradas, agora, hoje),
    [filtradas, agora, hoje],
  );

  // O recorte de "quem" e do contato, sem situacao nem busca: as contagens
  // da frase do cabecalho.
  const doRecorte = useMemo(
    () =>
      lista.filter(
        (atividade) =>
          (filtros.contato === null ||
            atividade.contact_id === filtros.contato) &&
          casaComQuem(atividade, filtros, eu),
      ),
    [lista, filtros, eu],
  );
  const pendencias = contarPendencias(doRecorte, agora, hoje);

  // Contato do recorte "Ver todas" (para o chip e para a Nova atividade ja
  // nele): sai de qualquer atividade dele na lista.
  const contatoDoRecorte: ContatoDaAtividade | null = useMemo(() => {
    if (filtros.contato === null) {
      return null;
    }
    return (
      base.find((atividade) => atividade.contact_id === filtros.contato)
        ?.contato ?? null
    );
  }, [base, filtros.contato]);

  // Responsavel no filtro: os ativos e quem ja e responsavel por alguma
  // atividade carregada (inclusive quem saiu, para achar as dele).
  const opcoesDeResponsavel = useMemo(() => {
    const ids = new Set<string>(equipe?.ativos ?? []);
    for (const atividade of base) {
      if (atividade.assignee_user_id) {
        ids.add(atividade.assignee_user_id);
      }
    }
    if (filtros.responsavel && filtros.responsavel !== SEM_RESPONSAVEL) {
      ids.add(filtros.responsavel);
    }
    const nomes = equipe?.nomes ?? {};
    return [...ids]
      .map((id) => ({
        id,
        nome:
          id === eu
            ? `${nomes[id] ?? "Você"} (você)`
            : (nomes[id] ?? "Pessoa da equipe"),
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [equipe, base, filtros.responsavel, eu]);

  const contexto: ContextoDaLinha = {
    agora,
    hoje,
    timezone,
    nomes: equipe?.nomes ?? {},
    ativos: equipe?.ativos ?? null,
    eu,
    podeEditar,
    dica,
  };
  const acoesDaLinha: AcoesDaLinha = {
    concluir: acoes.concluir,
    reabrir: acoes.reabrir,
    cancelar: acoes.cancelar,
    adiar: acoes.adiar,
    editar: (atividade) => setEditando(atividade),
  };

  const filtrosNoPadrao =
    filtros.quem === "minhas" &&
    filtros.situacao === "pendentes" &&
    filtros.responsavel === null &&
    filtros.contato === null &&
    busca.trim() === "";

  const limparFiltros = () => {
    setBusca("");
    setParams({
      quem: null,
      filtro: null,
      resp: null,
      busca: null,
      contato: null,
    });
  };

  const descricao = !listaQuery.data ? (
    "Os lembretes da equipe sobre leads e pacientes."
  ) : pendencias.atrasadas === 0 && pendencias.hoje === 0 ? (
    filtros.quem === "minhas" ? (
      "Nada seu atrasado nem para hoje."
    ) : (
      "Nada atrasado nem para hoje."
    )
  ) : (
    <>
      {filtros.quem === "minhas" ? "Suas atividades: " : "Da equipe: "}
      <span className="cz-num">{pendencias.atrasadas}</span>{" "}
      {plural(pendencias.atrasadas, "atrasada", "atrasadas")} e{" "}
      <span className="cz-num">{pendencias.hoje}</span> para hoje.
    </>
  );

  const novaAtividade = (
    <>
      <Plus aria-hidden />
      Nova atividade
    </>
  );
  const botaoNova = podeEditar ? (
    <Button onClick={() => setNovaAberta(true)}>{novaAtividade}</Button>
  ) : (
    <DisabledWithHint hint={dica}>
      <Button disabled>{novaAtividade}</Button>
    </DisabledWithHint>
  );

  const semNadaNaClinica = listaQuery.data !== undefined && base.length === 0;
  const vazioDoFiltro = VAZIO_DA_SITUACAO[filtros.situacao];

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-4 p-4 md:p-6">
      <PageHeader title="Atividades" description={descricao}>
        {botaoNova}
      </PageHeader>
      <AvisoCelular />

      <div className="flex flex-wrap items-end gap-3">
        <SegmentedControl
          ariaLabel="De quem"
          options={QUEM}
          value={filtros.quem}
          onChange={(quem) =>
            setParams({
              quem: quem === "minhas" ? null : quem,
              // O responsavel so existe em Todas.
              resp: null,
            })
          }
        />
        <Select
          value={filtros.situacao}
          onValueChange={(valor) =>
            setParams({ filtro: valor === "pendentes" ? null : valor })
          }
        >
          <SelectTrigger aria-label="Situação" className="min-w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTROS_DE_SITUACAO.map((situacao) => (
              <SelectItem key={situacao} value={situacao}>
                {ROTULO_DA_SITUACAO[situacao]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtros.quem === "todas" ? (
          <Select
            value={filtros.responsavel ?? "todos"}
            onValueChange={(valor) =>
              setParams({ resp: valor === "todos" ? null : valor })
            }
          >
            <SelectTrigger aria-label="Responsável" className="min-w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os responsáveis</SelectItem>
              {opcoesDeResponsavel.map((opcao) => (
                <SelectItem key={opcao.id} value={opcao.id}>
                  {opcao.nome}
                </SelectItem>
              ))}
              <SelectItem value={SEM_RESPONSAVEL}>Sem responsável</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        <div className="relative w-full sm:w-[280px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary"
          />
          <Input
            type="search"
            aria-label="Buscar atividade"
            placeholder="Paciente, telefone ou atividade"
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
        {filtros.contato !== null ? (
          <span className="inline-flex h-10 items-center gap-1 rounded-lg border border-border-strong bg-card pr-1 pl-3 text-[13px] font-medium text-foreground">
            Só de{" "}
            {contatoDoRecorte
              ? (contatoDoRecorte.nome ??
                formatarTelefone(contatoDoRecorte.telefone))
              : "um contato"}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Ver de todos os contatos"
              onClick={() => setParams({ contato: null })}
            >
              <X aria-hidden />
            </Button>
          </span>
        ) : null}
        {!filtrosNoPadrao ? (
          <Button variant="ghost" onClick={limparFiltros}>
            Limpar filtros
          </Button>
        ) : null}
      </div>

      {listaQuery.data?.cortada ? (
        <Aviso tom="info" role="note">
          A lista mostra as{" "}
          <span className="cz-num">
            {ATIVIDADES_PENDENTES_LIMITE.toLocaleString("pt-BR")}
          </span>{" "}
          pendentes de prazo mais próximo. As de prazo mais distante aparecem
          conforme estas forem concluídas.
        </Aviso>
      ) : null}

      {listaQuery.isError && listaQuery.data ? (
        <Aviso
          tom="warning"
          acao={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void listaQuery.refetch()}
            >
              <RotateCcw aria-hidden />
              Tentar de novo
            </Button>
          }
        >
          Não foi possível atualizar a lista agora. O que aparece pode estar
          desatualizado.
        </Aviso>
      ) : null}

      {!listaQuery.data ? (
        listaQuery.isError ? (
          <Card>
            <EmptyState
              tom="erro"
              title="Não foi possível carregar as atividades"
              description="Confira a conexão e tente de novo. Nada foi perdido."
            >
              <Button
                variant="outline"
                onClick={() => void listaQuery.refetch()}
              >
                <RotateCcw aria-hidden />
                Tentar de novo
              </Button>
            </EmptyState>
          </Card>
        ) : (
          <Card className="p-4" role="status">
            <span className="sr-only">Carregando as atividades</span>
            <ListSkeleton rows={5} />
          </Card>
        )
      ) : semNadaNaClinica ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title="Nenhuma atividade ainda"
            description="Crie pelo lead, pela conversa ou pela ficha do paciente, ou aqui mesmo. Ela aparece nesta lista com o prazo."
          >
            {botaoNova}
          </EmptyState>
        </Card>
      ) : grupos.length === 0 ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title={
              filtros.quem === "minhas" && filtrosNoPadrao
                ? "Nenhuma atividade sua pendente"
                : vazioDoFiltro.titulo
            }
            description={
              filtros.quem === "minhas" && filtrosNoPadrao
                ? "As atividades da equipe aparecem em Todas."
                : busca.trim()
                  ? "Nada com essa busca neste filtro."
                  : vazioDoFiltro.descricao
            }
            onClearFilters={filtrosNoPadrao ? undefined : limparFiltros}
          >
            {filtros.quem === "minhas" ? (
              <Button
                variant="outline"
                onClick={() => setParams({ quem: "todas" })}
              >
                <Users aria-hidden />
                Ver as da equipe
              </Button>
            ) : null}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-5">
          {grupos.map((grupo) => (
            <section
              key={grupo.chave}
              aria-labelledby={`grupo-${grupo.chave}`}
              className="grid gap-2"
            >
              <h2
                id={`grupo-${grupo.chave}`}
                className="flex items-baseline gap-2 text-[13px] font-bold text-text-strong"
              >
                {grupo.rotulo}
                <span className="cz-num text-xs font-medium text-text-secondary">
                  {grupo.itens.length}
                </span>
              </h2>
              <Card>
                <ul>
                  {grupo.itens.map((atividade) => (
                    <LinhaDeAtividade
                      key={atividade.id}
                      atividade={atividade}
                      forma="lista"
                      ocupada={acoes.ocupadas.has(atividade.id)}
                      acoes={acoesDaLinha}
                      contexto={contexto}
                    />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      <DialogoDeAtividade
        aberto={novaAberta}
        aoFechar={() => setNovaAberta(false)}
        aoSalvar={() => invalidar()}
        clinicId={clinicId}
        timezone={timezone}
        contato={contatoDoRecorte}
        equipe={equipe}
      />
      <DialogoDeAtividade
        aberto={editando !== null}
        aoFechar={() => setEditando(null)}
        aoSalvar={() => invalidar()}
        clinicId={clinicId}
        timezone={timezone}
        atividade={editando}
        equipe={equipe}
      />
    </div>
  );
}
