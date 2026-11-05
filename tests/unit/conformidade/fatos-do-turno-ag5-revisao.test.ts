import { describe, expect, it, vi } from "vitest";

import {
  fatosVazios,
  FONTES_DOS_FATOS,
  regrasDosFatos,
  type EntradaDaEsperaDoFato,
  type FatosDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { filtrarSaida } from "@/lib/domain/conformidade/filtro";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import {
  CADASTRO_DA_AGENDA,
  CATALOGO_DA_AGENDA,
  CONTEXTO_PADRAO,
  CONVENIOS_DA_BATERIA,
  HORARIOS_DA_BUSCA_DE_HORARIO,
  PROCEDIMENTOS_DA_BATERIA,
  SAIDA_DA_BUSCA_DE_HORARIO,
  TERCA_COM_A_ANA,
} from "@/tests/fixtures/ia/conformidade/casos";

// Revisao independente da AG5 (28/10/2026):
//  - achado 1 (MEDIO): a vaga_prometida barrava frases certas da marcacao
//    da AG3, em todas as clinicas ("O horario e seu", "O horario fica com
//    voce por 10 minutos", "Com certeza tenho vaga na terca"). Agora o
//    horario que "e seu" e o prazo so valem na frase de um horario que
//    AINDA vai abrir (abrir, surgir, aparecer, liberar, vagar, ficar vago, a
//    desistencia, o cancelamento de outra pessoa) ou da lista e da fila; o
//    substantivo "vaga" nunca e o verbo do prazo; a clinica que abre nao e
//    abertura. Provado aqui pelo filtro INTEIRO, com o verificador aprovando,
//    sem e com a habilidade;
//  - achado 2 (BAIXO): as formas que dependiam so do verificador ("a
//    proxima a ser chamada", "tera prioridade quando abrir", "assim que
//    abrir, eu reservo para voce", o procedimento citado em parte), com os
//    controles das regras novas.
// O verificador e um duble: nenhum teste chama a OpenAI.

const USO = {
  tokensEntrada: 900,
  tokensSaida: 30,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};

function verificadorQueSempreAprova() {
  return vi.fn<Verificador>(async () => ({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: USO,
  }));
}

function fatos(parcial: Partial<FatosDoTurno> = {}): FatosDoTurno {
  return {
    ...fatosVazios(2026),
    ...CADASTRO_DA_AGENDA,
    convenios: CONVENIOS_DA_BATERIA,
    procedimentos: PROCEDIMENTOS_DA_BATERIA,
    hoje: { dia: 20, mes: 10, ano: 2026 },
    ...parcial,
  };
}

const SAIDA_DA_MARCACAO = JSON.stringify({
  resultado: "marcado",
  pendente: true,
  dia: "terça, 21/10",
  hora: "14:00",
  profissional: "Dra. Ana Lima",
  procedimento: "Consulta dermatológica",
  unidade: "Centro",
});
const SAIDA_DA_RESERVA = JSON.stringify({
  resultado: "reservado",
  minutos: 10,
  dia: "terça, 21/10",
  hora: "14:00",
  profissional: "Dra. Ana Lima",
  procedimento: "Consulta dermatológica",
  unidade: "Centro",
});

/** agendar: terca, 21/10 as 14:00 com a Dra. Ana Lima. */
const MARCOU = fatos({
  saidasDasFerramentas: [SAIDA_DA_MARCACAO],
  acoes: ["marcou"],
  horariosDasAcoes: [{ ...TERCA_COM_A_ANA, acao: "marcou" }],
});
/** A busca e a reserva de terca, 21/10 as 14:00. */
const RESERVOU = fatos({
  saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO, SAIDA_DA_RESERVA],
  horariosLivres: HORARIOS_DA_BUSCA_DE_HORARIO,
  acoes: ["reservou"],
  horariosDasAcoes: [{ ...TERCA_COM_A_ANA, acao: "reservou" }],
});
/** So os horarios livres da busca. */
const BUSCOU = fatos({
  saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO],
  horariosLivres: HORARIOS_DA_BUSCA_DE_HORARIO,
});

const ENTRADA_DA_ANA: EntradaDaEsperaDoFato = {
  procedimento: "Limpeza de pele",
  profissional: "Dra. Ana Lima",
  turnos: ["manha"],
  dias: [1, 3],
  origem: "turno",
};
/** A entrada feita no turno (a acao e a entrada), com a lista ligada. */
const ENTROU = fatos({
  listaDeEsperaLigada: true,
  acoes: ["lista_de_espera"],
  entradasDaEspera: [ENTRADA_DA_ANA],
});

const CATALOGO = [...CATALOGO_DA_AGENDA, "Dra. Bruna Reis"];

function regras(rascunho: string, f: FatosDoTurno): string[] {
  return regrasDosFatos(rascunho, {
    fatos: f,
    nomesDoCatalogo: CATALOGO,
    mensagensDoPaciente: [],
  }).map((a) => a.regra);
}

async function noFiltro(rascunho: string, f: FatosDoTurno) {
  const verificador = verificadorQueSempreAprova();
  const decisao = await filtrarSaida({
    rascunho,
    contexto: { ...CONTEXTO_PADRAO, nomesDoCatalogo: CATALOGO, fatos: f },
    verificador,
  });
  return { decisao, verificador };
}

describe("achado 1: as frases certas da marcação da AG3 passam no filtro inteiro", () => {
  const CERTAS: readonly [string, string, FatosDoTurno][] = [
    [
      "a marcacao",
      "Pronto! Sua consulta ficou marcada para terça, 21/10 às 14:00. O horário é seu.",
      MARCOU,
    ],
    [
      "a reserva (fica com voce)",
      "Reservei terça, 21/10 às 14:00. O horário fica com você por 10 minutos.",
      RESERVOU,
    ],
    [
      "a reserva (fica para voce)",
      "Reservei terça, 21/10 às 14:00. Esse horário fica para você por 10 minutos.",
      RESERVOU,
    ],
    [
      "a busca (o horario e seu)",
      "Tenho terça, 21/10 às 14:00. Se quiser, o horário é seu.",
      BUSCOU,
    ],
    [
      "a busca (com certeza tenho vaga)",
      "Com certeza tenho vaga na terça, 21/10 às 14:00.",
      BUSCOU,
    ],
  ];

  it.each(CERTAS)("%s, sem a habilidade", async (_nome, rascunho, f) => {
    expect(regras(rascunho, f), rascunho).toEqual([]);
    const { decisao, verificador } = await noFiltro(rascunho, f);
    expect(decisao, rascunho).toMatchObject({ aprovado: true });
    if (decisao.aprovado) {
      expect(decisao.texto).toBe(rascunho);
    }
    expect(verificador).toHaveBeenCalledTimes(1);
  });

  it.each(CERTAS)("%s, com a lista de espera ligada", async (_nome, rascunho, f) => {
    const ligada = { ...f, listaDeEsperaLigada: true };
    expect(regras(rascunho, ligada), rascunho).toEqual([]);
    const { decisao } = await noFiltro(rascunho, ligada);
    expect(decisao, rascunho).toMatchObject({ aprovado: true });
  });

  it("o substantivo vaga nunca é o verbo do prazo", () => {
    for (const texto of [
      "Tenho vaga sim, com certeza: terça, 21/10 às 14:00.",
      "Com certeza tenho vaga na terça, 21/10 às 14:00 e na quarta, 22/10 às 09:30.",
      "Certamente há vaga na terça, 21/10 às 14:00.",
    ]) {
      expect(regras(texto, BUSCOU), texto).not.toContain("vaga_prometida");
    }
  });

  it("a clínica que abre (o funcionamento) não é abertura de horário", () => {
    for (const texto of [
      "A clínica abre logo cedo, às 8h.",
      "Com certeza a clínica abre aos sábados, e tenho horário às 9h.",
      "A unidade abre com certeza no sábado, e o horário das 9h é seu.",
      "Se surgir alguma dúvida, é só chamar por aqui.",
      "Assim que você escolher, eu reservo para você.",
      "A agenda de dezembro ainda não abriu.",
    ]) {
      expect(regras(texto, BUSCOU), texto).not.toContain("vaga_prometida");
    }
  });

  it("a promessa da lista continua barrada: horário que ainda vai abrir, a lista ou a fila", () => {
    for (const texto of [
      "Assim que abrir uma vaga, ela é sua.",
      "Quando abrir, o horário é seu.",
      "Se o horário de terça ficar livre, ele é seu.",
      "Se alguém cancelar, o horário é seu.",
      "Se houver desistência, a vaga é sua.",
      "Você já está na lista, e o horário vai ser seu.",
      "Logo abre um horário para você.",
      "Vai abrir um horário em breve, pode ficar tranquila.",
      "Com certeza vai abrir um horário essa semana.",
      "A agenda de dezembro abre em breve.",
    ]) {
      for (const f of [fatos(), ENTROU, MARCOU]) {
        expect(regras(texto, f), texto).toContain("vaga_prometida");
      }
    }
  });
});

describe("achado 2: as formas que só o verificador pegava", () => {
  it("a posição sem 'da fila', a prioridade e a ação que a IA promete fazer quando abrir", () => {
    for (const texto of [
      "Você é a próxima a ser chamada.",
      "Você vai ser a primeira a ser avisada.",
      "Você terá prioridade quando abrir um horário.",
      "Você tem prioridade na lista de espera.",
      "Assim que abrir um horário, eu reservo para você.",
      "Assim que abrir um horário, já marco para você.",
      "Quando surgir uma vaga, vou reservar para você.",
      "Se vagar um horário, eu te encaixo.",
      "Se aparecer um horário de manhã, marco para você.",
      "Quando liberar um horário, a gente agenda para você.",
    ]) {
      for (const f of [fatos(), ENTROU]) {
        expect(regras(texto, f), texto).toContain("vaga_prometida");
      }
    }
  });

  it("a negação, a pergunta e o que não é promessa não barram", () => {
    for (const texto of [
      "Você não é a próxima a ser chamada, mas continua na lista de espera.",
      "Não existe ordem de prioridade na lista: quando abre um horário, as pessoas da lista recebem a mensagem.",
      "A lista não funciona por prioridade.",
      "Idosos e gestantes têm prioridade no atendimento.",
      "Se abrir um horário, quer que eu reserve para você?",
      "Se abrir um horário, não consigo reservar para você: você recebe uma mensagem pelo WhatsApp.",
      "Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp.",
      "Em março, se abrir um horário assim, você recebe uma mensagem pelo WhatsApp.",
      "Se abrir um horário assim, eu não reservo: você recebe uma mensagem pelo WhatsApp.",
    ]) {
      expect(regras(texto, ENTROU), texto).not.toContain("vaga_prometida");
    }
  });

  it("espera_fora_da_entrada: o procedimento citado em parte (outro do Cadastro) barra", () => {
    for (const texto of [
      "Você está na lista de espera para peeling.",
      "Pronto, você entrou na lista de espera para a toxina.",
      "Você continua na lista de espera do botulínica, de manhã.",
    ]) {
      expect(regras(texto, ENTROU), texto).toContain("espera_fora_da_entrada");
    }
    // O procedimento da entrada, em parte ou inteiro, passa.
    for (const texto of [
      "Você está na lista de espera para a limpeza.",
      "Você está na lista de espera para Limpeza de pele, no particular.",
      "Você está na lista de espera para limpeza de pele com a Dra. Ana Lima, de manhã.",
    ]) {
      expect(regras(texto, ENTROU), texto).toEqual([]);
    }
  });

  it("o procedimento em parte não lê o pagamento, o profissional, a unidade nem as palavras genéricas", () => {
    // Um Cadastro em que procedimentos tem palavras do pagamento, do
    // convenio, do profissional e da unidade.
    const cadastro = fatos({
      listaDeEsperaLigada: true,
      acoes: ["lista_de_espera"],
      procedimentos: [
        "Limpeza de pele",
        "Consulta particular",
        "Avaliação Unimed",
        "Protocolo Lima",
        "Massagem Aldeota",
        "Tratamento de manhã",
      ],
      entradasDaEspera: [ENTRADA_DA_ANA],
    });
    for (const texto of [
      "Pronto, você entrou na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, de manhã, às segundas e às quartas.",
      "Você está na lista de espera para Limpeza de pele, pela Unimed, na unidade Aldeota.",
      "Você continua na lista de espera para o tratamento de limpeza de pele.",
    ]) {
      expect(regras(texto, cadastro), texto).not.toContain(
        "espera_fora_da_entrada",
      );
    }
    expect(
      regras("Você está na lista de espera para a massagem.", cadastro),
    ).toContain("espera_fora_da_entrada");
  });

  it("as regras novas entram na versão das regras", () => {
    const fontes = FONTES_DOS_FATOS.join("\n");
    expect(fontes).toContain("acao_futura");
    expect(fontes).toContain("contexto espera");
    expect(fontes).toContain("procedimento em parte");
  });
});
