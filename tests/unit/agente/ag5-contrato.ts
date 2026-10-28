import { randomUUID } from "node:crypto";

import type { CatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";

import {
  mensagemNovaDoPaciente,
  respondidasPelosTurnos,
  type MensagemNoBanco,
  type OpcoesDoContrato,
} from "./ag3-contrato";
import type { AgendaEmMemoria, Linha } from "./agenda-em-memoria";
import { CLINICA, CONTATO } from "./agenda-fixtures";

// O CONTRATO das RPCs da AG5 (migration 20261029100000_lista_de_espera_
// pela_ia.sql; o contrato da frente de banco, ag5/contrato.md) em memoria,
// para as conversas de varias falas com o LLM falso:
//  - pedir_lista_de_espera_pela_ia (fase 1): a idempotencia pelo job (o
//    mesmo pedido volta reutilizado; outro e 22023), ia_desligada,
//    lista_de_espera_desligada, mais_de_uma_unidade, so_com_a_equipe (o
//    vinculo que a IA marca), sem_autorizacao, ja_na_lista (com a entrada),
//    consulta_para_outra_pessoa, menor_de_idade e ja_tem_consulta (com
//    starts_at), na ORDEM do banco; grava o pedido (apaga o vivo anterior da
//    conversa) e devolve a preferencia NORMALIZADA (em ordem; os tres
//    periodos ou os sete dias viram vazio);
//  - entrar_na_lista_de_espera_pela_ia (fase 2): a idempotencia pela
//    entrada do job, ia_desligada, lista_de_espera_desligada,
//    sem_pedido_de_espera (nenhum pedido vivo da janela atual), as
//    estruturais de novo, mensagem_nova_do_paciente (R12 da AG4: o mesmo
//    espelho do contrato da AG3), a D-8, ja_tem_consulta, pedido_vencido (a
//    pergunta com 60 minutos ou mais) e a ANCORA FORTE: a pergunta e a
//    mensagem da IA escrita pelo job do pedido (message.job_id), nao
//    falhada, depois do pedido e antes do "sim"; a ultima saida antes do
//    "sim" e ela, sem empate; nenhuma mensagem do paciente depois dela cita
//    outra (reply_to_message_id de outra, ou reply_to_wa_message_id sem a
//    mensagem nossa). Grava a entrada (origem ia), consome o pedido e grava
//    o evento no fio.
// As RPCs de verdade sao provadas nas suites de integracao e de RLS (com o
// banco), pela frente de banco.

/** A pergunta T-E1 vale 60 minutos (D-43, c_validade_da_pergunta). */
export const VALIDADE_DA_PERGUNTA_NO_BANCO_MS = 60 * 60_000;

export type OpcoesDaAg5 = Pick<
  OpcoesDoContrato,
  "catalogo" | "agora" | "conversa" | "lidas" | "turnos"
> & {
  /** A habilidade "Lista de espera" na versao publicada (com Agendar valendo). */
  ligada: () => boolean;
  /** A IA atende a conversa (senao, ia_desligada). */
  iaAtendendo?: () => boolean;
  /** Quantas unidades ativas a clinica tem (D-38). */
  unidadesAtivas?: () => number;
  /** O contato tem a autorizacao para receber mensagens. */
  autorizado?: () => boolean;
  /** As marcas da D-8 na janela (outra pessoa) e no cadastro (menor). */
  paraOutraPessoa?: () => boolean;
  menorDeIdade?: () => boolean;
  /** O nome do convenio e o plano pelo id (o Cadastro). */
  convenio?: (id: string) => { nome: string; plano: string | null } | null;
  /**
   * Uma resposta forcada (o motivo, ou um erro "22023" e "fora_do_formato"),
   * depois de ia_desligada e da habilidade: o que o cenario nao produz
   * sozinho.
   */
  forcar?: () => { pedir?: string | null; entrar?: string | null };
};

function recusa(motivo: string, extra: Record<string, unknown> = {}) {
  return { data: { ok: false, motivo, ...extra }, error: null };
}

function erro(codigo: string) {
  return { data: null, error: { code: codigo } };
}

/** A resposta forcada: um erro do banco, a resposta fora do formato ou o motivo. */
function respostaForcada(forcado: string) {
  if (forcado === "22023" || forcado === "22004") {
    return erro(forcado);
  }
  if (forcado === "fora_do_formato") {
    return { data: { ok: "talvez" }, error: null };
  }
  return recusa(forcado, forcado === "ja_tem_consulta" ? { starts_at: null } : {});
}

const ORDEM_DOS_PERIODOS = ["manha", "tarde", "noite"];

/** "a", "a e b", "a, b e c" (descrever_preferencia_da_espera). */
function unidos(itens: readonly string[]): string {
  return itens.length <= 1
    ? (itens[0] ?? "")
    : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * A preferencia do evento no fio (contrato da frente de banco, secao 6):
 * "manhã; segunda e quarta", "qualquer período; qualquer dia".
 */
function preferenciaDoEvento(turnos: unknown, dias: unknown): string {
  const t = (Array.isArray(turnos) ? (turnos as string[]) : []).map((x) =>
    x === "manha" ? "manhã" : x,
  );
  const nomes = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const d = (Array.isArray(dias) ? (dias as number[]) : []).map((x) => nomes[x] ?? "");
  return `${t.length === 0 ? "qualquer período" : unidos(t)}; ${d.length === 0 ? "qualquer dia" : unidos(d)}`;
}

/** A preferencia normalizada como o banco (em ordem; tudo = vazio). */
function normalizada(turnos: unknown, dias: unknown) {
  const t = Array.isArray(turnos) ? (turnos as string[]) : [];
  const d = Array.isArray(dias) ? (dias as number[]) : [];
  const periodos = ORDEM_DOS_PERIODOS.filter((p) => t.includes(p));
  const semana = [...new Set(d)].sort((a, b) => a - b);
  return {
    turnos: periodos.length === 3 ? [] : periodos,
    dias: semana.length === 7 ? [] : semana,
  };
}

/** A janela atual da IA na conversa (ia_janela_da_conversa). */
function janelaDe(banco: AgendaEmMemoria, conversa: unknown) {
  return banco
    .linhas("ia_janela_da_conversa")
    .find((j) => j.conversation_id === conversa && j.clinic_id === CLINICA);
}

export function rpcsDaAg5(banco: AgendaEmMemoria, opcoes: OpcoesDaAg5) {
  const catalogo: CatalogoDoAgente = opcoes.catalogo;
  const nomeDoProcedimento = (id: unknown) =>
    catalogo.procedimentos.find((p) => p.id === id)?.nome ?? null;
  const nomeDoProfissional = (id: unknown) =>
    id === null
      ? null
      : (catalogo.vinculos.find((v) => v.profissionalId === id)?.profissional ??
        null);
  const convenioDe = (id: unknown) => {
    if (typeof id !== "string") {
      return null;
    }
    if (opcoes.convenio) {
      return opcoes.convenio(id);
    }
    const c = [...catalogo.conveniosDoCadastro, ...catalogo.convenios].find(
      (x) => x.id === id,
    );
    return c === undefined ? null : { nome: c.nome, plano: c.plano };
  };
  const nomes = (p: Linha) => ({
    procedimento: nomeDoProcedimento(p.procedure_id),
    profissional: nomeDoProfissional(p.professional_id),
    convenio: convenioDe(p.insurance_id)?.nome ?? null,
    plano: convenioDe(p.insurance_id)?.plano ?? null,
  });

  /** As estruturais e as da pessoa (conferir_pedido_de_espera_da_ia). */
  function conferir(p: Linha): {
    motivo: string | null;
    entrada?: Record<string, unknown>;
    daPessoa: string | null;
    inicio?: string;
  } {
    if ((opcoes.unidadesAtivas?.() ?? 0) > 1) {
      return { motivo: "mais_de_uma_unidade", daPessoa: null };
    }
    const vinculoDaIa = catalogo.vinculos.some(
      (v) =>
        v.id !== null &&
        v.procedimentoId === p.procedure_id &&
        v.convenioId === (p.insurance_id ?? null) &&
        (p.professional_id === null || v.profissionalId === p.professional_id),
    );
    if (!vinculoDaIa) {
      return { motivo: "so_com_a_equipe", daPessoa: null };
    }
    if (opcoes.autorizado !== undefined && !opcoes.autorizado()) {
      return { motivo: "sem_autorizacao", daPessoa: null };
    }
    // Revisao da AG5 (contrato da frente de banco, C1): qualquer entrada
    // ATIVA do contato do mesmo procedimento (de qualquer profissional, ou
    // de outro) ou de qualquer procedimento (procedure_id nulo), de qualquer
    // origem. A entrada devolvida: a do grupo exato primeiro; depois a do
    // mesmo procedimento com qualquer profissional; a de outro profissional;
    // a de qualquer procedimento.
    const ativas = banco
      .linhas("waitlist")
      .filter(
        (w) =>
          w.clinic_id === CLINICA &&
          w.contact_id === CONTATO &&
          w.active === true &&
          ((w.procedure_id ?? null) === null ||
            w.procedure_id === p.procedure_id),
      );
    const ordem = (w: Linha): number =>
      (w.procedure_id ?? null) === null
        ? 3
        : (w.professional_id ?? null) === (p.professional_id ?? null)
          ? 0
          : (w.professional_id ?? null) === null
            ? 1
            : 2;
    const existente = [...ativas].sort((a, b) => ordem(a) - ordem(b))[0];
    if (existente !== undefined) {
      return {
        motivo: "ja_na_lista",
        entrada: {
          procedimento: nomeDoProcedimento(existente.procedure_id ?? null),
          profissional: nomeDoProfissional(existente.professional_id ?? null),
          turnos: existente.preferred_shifts,
          dias: existente.preferred_weekdays,
        },
        daPessoa: null,
      };
    }
    if (opcoes.paraOutraPessoa?.() === true) {
      return { motivo: null, daPessoa: "consulta_para_outra_pessoa" };
    }
    if (opcoes.menorDeIdade?.() === true) {
      return { motivo: null, daPessoa: "menor_de_idade" };
    }
    const agora = opcoes.agora();
    const consulta = banco
      .linhas("appointment")
      .filter(
        (a) =>
          a.clinic_id === CLINICA &&
          a.contact_id === CONTATO &&
          Date.parse(String(a.starts_at)) > agora &&
          !["cancelado_paciente", "cancelado_clinica", "faltou", "compareceu"].includes(
            String(a.status),
          ) &&
          a.approval_status !== "recusado" &&
          catalogo.vinculos.find((v) => v.id === a.service_link_id)
            ?.procedimentoId === p.procedure_id,
      )
      .sort((a, b) => Date.parse(String(a.starts_at)) - Date.parse(String(b.starts_at)))[0];
    if (consulta !== undefined) {
      return {
        motivo: null,
        daPessoa: "ja_tem_consulta",
        inicio: String(consulta.starts_at),
      };
    }
    return { motivo: null, daPessoa: null };
  }

  /** A resposta das recusas de conferir (com a entrada e o inicio). */
  function respostaDaConferencia(c: ReturnType<typeof conferir>) {
    if (c.motivo === "ja_na_lista") {
      return recusa("ja_na_lista", { entrada: c.entrada ?? null });
    }
    if (c.motivo !== null) {
      return recusa(c.motivo);
    }
    if (c.daPessoa === "ja_tem_consulta") {
      return recusa("ja_tem_consulta", { starts_at: c.inicio ?? null });
    }
    if (c.daPessoa !== null) {
      return recusa(c.daPessoa);
    }
    return null;
  }

  banco.rpc("pedir_lista_de_espera_pela_ia", (args) => {
    if (
      [
        args.p_clinic_id,
        args.p_conversation_id,
        args.p_job_id,
        args.p_procedure_id,
        args.p_particular,
        args.p_turnos,
        args.p_dias,
      ].some((v) => v === null || v === undefined)
    ) {
      return erro("22004");
    }
    const preferencia = normalizada(args.p_turnos, args.p_dias);
    // A idempotencia pelo job.
    const doJob = banco
      .linhas("ia_pedido_de_espera")
      .find((p) => p.job_id === args.p_job_id);
    if (doJob !== undefined) {
      const mesmo =
        doJob.conversation_id === args.p_conversation_id &&
        doJob.procedure_id === args.p_procedure_id &&
        (doJob.professional_id ?? null) === (args.p_professional_id ?? null) &&
        (doJob.insurance_id ?? null) === (args.p_insurance_id ?? null) &&
        doJob.particular === args.p_particular &&
        JSON.stringify(doJob.preferred_shifts) === JSON.stringify(preferencia.turnos) &&
        JSON.stringify(doJob.preferred_weekdays) === JSON.stringify(preferencia.dias);
      if (!mesmo) {
        return erro("22023");
      }
      return {
        data: {
          ok: true,
          pedido_id: doJob.id,
          reutilizado: true,
          ...nomes(doJob),
          particular: doJob.particular,
          turnos: doJob.preferred_shifts,
          dias: doJob.preferred_weekdays,
        },
        error: null,
      };
    }
    if (args.p_particular !== ((args.p_insurance_id ?? null) === null)) {
      return erro("22023");
    }
    const janela = janelaDe(banco, args.p_conversation_id);
    if (opcoes.iaAtendendo?.() === false || janela === undefined) {
      return recusa("ia_desligada");
    }
    if (!opcoes.ligada()) {
      return recusa("lista_de_espera_desligada");
    }
    const forcado = opcoes.forcar?.().pedir ?? null;
    if (forcado !== null) {
      return respostaForcada(forcado);
    }
    const pedido = {
      procedure_id: args.p_procedure_id,
      professional_id: args.p_professional_id ?? null,
      insurance_id: args.p_insurance_id ?? null,
    };
    const resposta = respostaDaConferencia(conferir(pedido));
    if (resposta !== null) {
      return resposta;
    }
    // O pedido vivo anterior sai; o novo entra.
    banco.tabelas.set(
      "ia_pedido_de_espera",
      banco
        .linhas("ia_pedido_de_espera")
        .filter(
          (p) =>
            !(
              p.conversation_id === args.p_conversation_id &&
              p.consumido_em === null
            ),
        ),
    );
    const linha: Linha = {
      id: randomUUID(),
      clinic_id: args.p_clinic_id,
      conversation_id: args.p_conversation_id,
      contact_id: janela.contact_id,
      janela_desde: janela.desde,
      job_id: args.p_job_id,
      ...pedido,
      particular: args.p_particular,
      preferred_shifts: preferencia.turnos,
      preferred_weekdays: preferencia.dias,
      created_at: new Date(opcoes.agora()).toISOString(),
      consumido_em: null,
      waitlist_id: null,
      job_id_da_entrada: null,
    };
    banco.inserir("ia_pedido_de_espera", linha);
    return {
      data: {
        ok: true,
        pedido_id: linha.id,
        reutilizado: false,
        ...nomes(linha),
        particular: linha.particular,
        turnos: linha.preferred_shifts,
        dias: linha.preferred_weekdays,
      },
      error: null,
    };
  });

  banco.rpc("entrar_na_lista_de_espera_pela_ia", (args) => {
    if (
      [args.p_clinic_id, args.p_conversation_id, args.p_job_id].some(
        (v) => v === null || v === undefined,
      )
    ) {
      return erro("22004");
    }
    const agora = opcoes.agora();
    // A idempotencia pela entrada do job.
    const feita = banco
      .linhas("waitlist")
      .find((w) => w.ia_job_id === args.p_job_id);
    if (feita !== undefined) {
      if (feita.conversation_id !== args.p_conversation_id) {
        return erro("22023");
      }
      // Revisao da AG5 (contrato da frente de banco, C4): a entrada do job
      // fora da fila (a recepcao a removeu entre as tentativas, ou o SIM a
      // usou) nao e mais pedido a cumprir, na mesma posicao da idempotencia.
      if (feita.active !== true) {
        return recusa("sem_pedido_de_espera");
      }
      return {
        data: {
          ok: true,
          waitlist_id: feita.id,
          reutilizado: true,
          ...nomes(feita),
          particular: feita.particular,
          turnos: feita.preferred_shifts,
          dias: feita.preferred_weekdays,
        },
        error: null,
      };
    }
    const janela = janelaDe(banco, args.p_conversation_id);
    if (opcoes.iaAtendendo?.() === false || janela === undefined) {
      return recusa("ia_desligada");
    }
    if (!opcoes.ligada()) {
      return recusa("lista_de_espera_desligada");
    }
    const pedido = banco
      .linhas("ia_pedido_de_espera")
      .find(
        (p) =>
          p.conversation_id === args.p_conversation_id &&
          p.consumido_em === null &&
          p.janela_desde === janela.desde &&
          p.contact_id === janela.contact_id,
      );
    if (pedido === undefined) {
      return recusa("sem_pedido_de_espera");
    }
    const conferido = conferir(pedido);
    if (conferido.motivo !== null) {
      return respostaDaConferencia(conferido)!;
    }
    const forcado = opcoes.forcar?.().entrar ?? null;
    if (forcado !== null) {
      return respostaForcada(forcado);
    }
    // O "sim" (a ultima mensagem do paciente) e a pergunta do job do pedido.
    const conversa: readonly MensagemNoBanco[] = opcoes.conversa?.() ?? [];
    const sim = conversa
      .filter((m) => m.direcao === "entrada" && m.autor === "paciente")
      .at(-1)?.em;
    const pedidoEm = Date.parse(String(pedido.created_at));
    const pergunta =
      sim === undefined
        ? null
        : (conversa
            .filter(
              (m) =>
                m.direcao === "saida" &&
                m.autor === "ia" &&
                m.job === pedido.job_id &&
                m.falhou !== true &&
                m.em > pedidoEm &&
                m.em < sim,
            )
            .at(-1) ?? null);
    // R12 da AG4: a mensagem que nenhum turno leu e nova (antes de tudo o
    // que depende da pessoa).
    if (
      mensagemNovaDoPaciente(
        conversa,
        opcoes.lidas?.(String(args.p_job_id)),
        pergunta,
        respondidasPelosTurnos(opcoes, String(args.p_job_id)),
      )
    ) {
      return recusa("mensagem_nova_do_paciente");
    }
    const daPessoa = respostaDaConferencia({ ...conferido, motivo: null });
    if (daPessoa !== null) {
      return daPessoa;
    }
    if (pergunta !== null && pergunta.em <= agora - VALIDADE_DA_PERGUNTA_NO_BANCO_MS) {
      return recusa("pedido_vencido");
    }
    // A ancora forte.
    if (pergunta === null || sim === undefined) {
      return recusa("sem_confirmacao_do_paciente");
    }
    const saidas = conversa.filter((m) => m.direcao === "saida" && m.em < sim);
    const ultima = saidas.at(-1);
    const empate = saidas.some((m) => m !== pergunta && m.em === pergunta.em);
    const citaOutra = banco
      .linhas("message")
      .some(
        (m) =>
          m.conversation_id === args.p_conversation_id &&
          m.direction === "entrada" &&
          m.author === "paciente" &&
          (m.deleted_at ?? null) === null &&
          Date.parse(String(m.created_at)) > pergunta.em &&
          Date.parse(String(m.created_at)) <= sim &&
          ((m.reply_to_message_id ?? null) !== null ||
            (m.reply_to_wa_message_id ?? null) !== null) &&
          m.reply_to_message_id !== pergunta.id,
      );
    if (ultima !== pergunta || empate || citaOutra) {
      return recusa("sem_confirmacao_do_paciente");
    }
    // A entrada (origem ia), o pedido consumido e o evento no fio.
    const entrada: Linha = {
      id: randomUUID(),
      clinic_id: args.p_clinic_id,
      contact_id: janela.contact_id,
      procedure_id: pedido.procedure_id,
      professional_id: pedido.professional_id ?? null,
      preferred_shifts: pedido.preferred_shifts,
      preferred_weekdays: pedido.preferred_weekdays,
      priority: 0,
      active: true,
      origem: "ia",
      ia_job_id: args.p_job_id,
      conversation_id: args.p_conversation_id,
      insurance_id: pedido.insurance_id ?? null,
      particular: pedido.particular,
      created_at: new Date(agora).toISOString(),
    };
    banco.inserir("waitlist", entrada);
    Object.assign(pedido, {
      consumido_em: new Date(agora).toISOString(),
      waitlist_id: entrada.id,
      job_id_da_entrada: args.p_job_id,
    });
    const n = nomes(pedido);
    banco.inserir("message", {
      id: randomUUID(),
      clinic_id: args.p_clinic_id,
      conversation_id: args.p_conversation_id,
      direction: "saida",
      author: "sistema",
      content_type: "evento",
      body: `A IA colocou o paciente na lista de espera: ${n.procedimento ?? "procedimento"}, ${n.profissional ?? "qualquer profissional"}, ${pedido.particular === true ? "particular" : `convênio ${n.convenio ?? ""}${n.plano === null ? "" : ` (${n.plano})`}`}. Preferência: ${preferenciaDoEvento(pedido.preferred_shifts, pedido.preferred_weekdays)}.`,
      is_internal_note: false,
      created_at: new Date(agora).toISOString(),
      billable: false,
      cost_cents: 0,
    });
    return {
      data: {
        ok: true,
        waitlist_id: entrada.id,
        reutilizado: false,
        ...n,
        particular: pedido.particular,
        turnos: pedido.preferred_shifts,
        dias: pedido.preferred_weekdays,
      },
      error: null,
    };
  });
}
