import {
  montarCatalogoDoAgente,
  type CatalogoDoAgente,
  type LinhasDoCatalogo,
} from "@/lib/agente/ferramentas/buscar-procedimento";

import { CONV, PROC, PROF, SALA, VINC } from "./agenda-fixtures";

// O Cadastro da clinica ficticia da agenda (agenda-fixtures.ts) com o que a
// AG2 le (27/10/2026): unidades, jornada por unidade, requisitos, convenios
// do profissional, idade atendida e os procedimentos que so a equipe marca.
// Nenhum dado real: nomes, enderecos, precos e convenios inventados. O
// indice continua o da agenda (p1 Consulta, p2 Exame, p3 Limpeza de pele);
// fora dele, p4 Botox (so a equipe marca, deixa informar) e p5 Implante (so
// a equipe marca, nao deixa informar).

export const PROC_AG2 = {
  botox: "77777777-7777-4777-8777-777777777777",
  implante: "88888888-8888-4888-8888-888888888888",
  peeling: "99999999-9999-4999-8999-999999999999",
} as const;

export const PROF_AG2 = {
  carla: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  saiu: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
} as const;

export const UNID = {
  aldeota: "a1a1a1a1-0000-4000-8000-000000000001",
  centro: "a1a1a1a1-0000-4000-8000-000000000002",
  antiga: "a1a1a1a1-0000-4000-8000-000000000003",
  comTelefone: "a1a1a1a1-0000-4000-8000-000000000004",
} as const;

export const CONV_INATIVO = "c0c0c0c0-0000-4000-8000-000000000099";

export const VINC_AG2 = {
  botoxAna: "5b000000-0000-4000-8000-000000000001",
  botoxAnaUnimed: "5b000000-0000-4000-8000-000000000002",
  implanteBruno: "5b000000-0000-4000-8000-000000000003",
} as const;

/** O endereco montado da unidade Aldeota (num campo so, sem CEP). */
export const ENDERECO_DA_ALDEOTA =
  "Av. Santos Dumont, 1500, sala 302, Aldeota, Fortaleza, CE";

export const ENDERECO_DO_CENTRO =
  "Rua Barão do Rio Branco, 900, Centro, Fortaleza, CE";

function vinculo(
  id: string,
  procedure_id: string,
  professional_id: string,
  insurance_id: string | null,
  price_cents: number | null,
  duration_min: number,
  bookable_by_ai = true,
) {
  return {
    id,
    procedure_id,
    professional_id,
    insurance_id,
    price_cents,
    covered_by_insurance: insurance_id !== null && price_cents === null,
    bookable_by_ai,
    active: true,
    duration_min,
  };
}

/** As linhas, como o carregador entrega (lib/agente/contexto.ts). */
export function linhasDoCadastro(
  extra: Partial<LinhasDoCatalogo> = {},
): LinhasDoCatalogo {
  return {
    procedimentos: [
      {
        id: PROC.consulta,
        name: "Consulta",
        active: true,
        bookable_by_ai: true,
        ia_pode_informar: true,
        requires_evaluation: false,
      },
      {
        id: PROC.limpeza,
        name: "Limpeza de pele",
        active: true,
        bookable_by_ai: true,
        resource_id: SALA,
        ia_pode_informar: true,
        requires_evaluation: false,
      },
      {
        id: PROC.exame,
        name: "Exame",
        active: true,
        bookable_by_ai: true,
        ia_pode_informar: true,
        requires_evaluation: false,
      },
      {
        id: PROC_AG2.botox,
        name: "Botox",
        active: true,
        bookable_by_ai: false,
        ia_pode_informar: true,
        requires_evaluation: true,
      },
      {
        id: PROC_AG2.implante,
        name: "Implante",
        active: true,
        bookable_by_ai: false,
        ia_pode_informar: false,
        requires_evaluation: false,
      },
      {
        id: PROC_AG2.peeling,
        name: "Peeling",
        active: false,
        bookable_by_ai: true,
        ia_pode_informar: true,
        requires_evaluation: false,
      },
    ],
    profissionais: [
      {
        id: PROF.ana,
        name: "Dra. Ana Lima",
        active: true,
        specialties: ["Dermatologia", "Estética"],
        idade_minima: 12,
        idade_maxima: null,
      },
      {
        id: PROF.bruno,
        name: "Dr. Bruno Costa",
        active: true,
        specialties: ["Cardiologia"],
        idade_minima: 18,
        idade_maxima: 65,
      },
      {
        id: PROF_AG2.carla,
        name: "Dra. Carla Dias",
        active: true,
        specialties: ["Ginecologia"],
        idade_minima: null,
        idade_maxima: null,
      },
      {
        id: PROF_AG2.saiu,
        name: "Dr. Antigo",
        active: false,
        specialties: ["Dermatologia"],
      },
    ],
    convenios: [
      { id: CONV.unimed, name: "Unimed", plan_name: "Nacional", active: true },
      { id: CONV.amil, name: "Amil", plan_name: null, active: true },
      {
        id: CONV.bradescoTop,
        name: "Bradesco Saúde",
        plan_name: "Top",
        active: true,
      },
      {
        id: CONV.bradescoFlex,
        name: "Bradesco Saúde",
        plan_name: "Flex",
        active: true,
      },
      {
        id: CONV.unimedFortaleza,
        name: "Unimed Fortaleza",
        plan_name: "Flex",
        active: true,
      },
      { id: CONV_INATIVO, name: "Golden", plan_name: null, active: false },
    ],
    // Os vinculos do agente: os mesmos da agenda.
    vinculos: [
      vinculo(VINC.consultaAna, PROC.consulta, PROF.ana, null, 30_000, 30),
      vinculo(VINC.consultaBruno, PROC.consulta, PROF.bruno, null, 28_000, 30),
      vinculo(
        VINC.consultaAnaUnimed,
        PROC.consulta,
        PROF.ana,
        CONV.unimed,
        null,
        30,
      ),
      vinculo(VINC.limpezaAna, PROC.limpeza, PROF.ana, null, 12_000, 60),
      vinculo(
        VINC.exameBrunoAmil,
        PROC.exame,
        PROF.bruno,
        CONV.amil,
        5_000,
        20,
      ),
    ],
    // Os vinculos que a IA nao marca (so ids): os do Botox e do Implante.
    vinculosSoDaEquipe: [
      {
        procedure_id: PROC_AG2.botox,
        professional_id: PROF.ana,
        insurance_id: null,
      },
      {
        procedure_id: PROC_AG2.botox,
        professional_id: PROF.ana,
        insurance_id: CONV.unimed,
      },
      {
        procedure_id: PROC_AG2.implante,
        professional_id: PROF.bruno,
        insurance_id: null,
      },
    ],
    // Os vinculos com preco dos procedimentos so com a equipe que deixam
    // informar: so o Botox (o Implante nao deixa e nunca e lido; esta aqui
    // so para provar que, se vier, nao sai).
    vinculosDaEquipe: [
      vinculo(
        VINC_AG2.botoxAna,
        PROC_AG2.botox,
        PROF.ana,
        null,
        120_000,
        60,
        false,
      ),
      vinculo(
        VINC_AG2.botoxAnaUnimed,
        PROC_AG2.botox,
        PROF.ana,
        CONV.unimed,
        null,
        60,
        false,
      ),
      vinculo(
        VINC_AG2.implanteBruno,
        PROC_AG2.implante,
        PROF.bruno,
        null,
        500_000,
        90,
        false,
      ),
    ],
    clinica: { name: "Clínica Bem Estar" },
    unidades: [
      {
        id: UNID.centro,
        name: "Centro",
        active: true,
        logradouro: "Rua Barão do Rio Branco",
        numero: "900",
        complemento: null,
        bairro: "Centro",
        cidade: "Fortaleza",
        uf: "CE",
        referencia: null,
        estacionamento: null,
        acessibilidade: null,
        horario_de_funcionamento: null,
        observacao_ao_paciente: null,
      },
      {
        id: UNID.aldeota,
        name: "Aldeota",
        active: true,
        logradouro: "Av. Santos Dumont",
        numero: "1500",
        complemento: "sala 302",
        bairro: "Aldeota",
        cidade: "Fortaleza",
        uf: "CE",
        referencia: "Em frente à praça Portugal.",
        estacionamento: "Estacionamento no subsolo do prédio.",
        acessibilidade: "Acesso por rampa e elevador.",
        horario_de_funcionamento: {
          "1": [
            { inicio: "08:00", fim: "12:00" },
            { inicio: "14:00", fim: "18:00" },
          ],
          "2": [
            { inicio: "08:00", fim: "12:00" },
            { inicio: "14:00", fim: "18:00" },
          ],
          "3": [
            { inicio: "08:00", fim: "12:00" },
            { inicio: "14:00", fim: "18:00" },
          ],
          "4": [
            { inicio: "08:00", fim: "12:00" },
            { inicio: "14:00", fim: "18:00" },
          ],
          "5": [
            { inicio: "14:00", fim: "18:00" },
            { inicio: "08:00", fim: "12:00" },
          ],
          "6": [{ inicio: "08:00", fim: "12:00" }],
        },
        observacao_ao_paciente: "Entrada pela portaria principal.",
      },
      {
        id: UNID.antiga,
        name: "Antiga",
        active: false,
        logradouro: "Rua Velha",
        numero: "1",
      },
    ],
    jornadas: [
      { professional_id: PROF.ana, unit_id: UNID.aldeota },
      { professional_id: PROF.ana, unit_id: UNID.aldeota },
      // Sem unidade: qualquer unidade.
      { professional_id: PROF.bruno, unit_id: null },
      { professional_id: PROF_AG2.carla, unit_id: UNID.centro },
      // Unidade inativa e profissional inativo: fora.
      { professional_id: PROF_AG2.carla, unit_id: UNID.antiga },
      { professional_id: PROF_AG2.saiu, unit_id: UNID.aldeota },
    ],
    requisitos: [
      {
        procedure_id: PROC.consulta,
        insurance_id: null,
        tipo: "documento_com_foto",
        valor_inteiro: null,
        texto_ao_paciente: null,
        ativo: true,
      },
      {
        procedure_id: PROC.consulta,
        insurance_id: null,
        tipo: "chegar_antes_minutos",
        valor_inteiro: 15,
        texto_ao_paciente: "Chegue com antecedência para o cadastro.",
        ativo: true,
      },
      {
        procedure_id: PROC.consulta,
        insurance_id: CONV.unimed,
        tipo: "carteirinha",
        valor_inteiro: null,
        texto_ao_paciente: null,
        ativo: true,
      },
      {
        procedure_id: PROC.consulta,
        insurance_id: CONV.unimed,
        tipo: "autorizacao_previa",
        valor_inteiro: null,
        texto_ao_paciente: null,
        ativo: true,
      },
      {
        procedure_id: PROC.exame,
        insurance_id: null,
        tipo: "pedido_medico",
        valor_inteiro: null,
        texto_ao_paciente: "Traga o pedido médico.",
        ativo: true,
      },
      {
        procedure_id: PROC.exame,
        insurance_id: null,
        tipo: "exames_anteriores",
        valor_inteiro: null,
        texto_ao_paciente: null,
        ativo: true,
      },
      {
        procedure_id: PROC.exame,
        insurance_id: null,
        tipo: "outro",
        valor_inteiro: null,
        texto_ao_paciente: "Traga o comprovante de residência.",
        ativo: true,
      },
      // Preparo clinico gravado direto no banco: as regras barram (fica de
      // fora inteiro e conta).
      {
        procedure_id: PROC.exame,
        insurance_id: null,
        tipo: "outro",
        valor_inteiro: null,
        texto_ao_paciente: "Venha em jejum de 8 horas.",
        ativo: true,
      },
      {
        procedure_id: PROC_AG2.botox,
        insurance_id: null,
        tipo: "avaliacao_previa",
        valor_inteiro: null,
        texto_ao_paciente: null,
        ativo: true,
      },
      {
        procedure_id: PROC_AG2.botox,
        insurance_id: null,
        tipo: "idade_minima",
        valor_inteiro: 18,
        texto_ao_paciente: null,
        ativo: true,
      },
      {
        procedure_id: PROC_AG2.implante,
        insurance_id: null,
        tipo: "acompanhante",
        valor_inteiro: null,
        texto_ao_paciente: null,
        ativo: true,
      },
      // Inativo, de convenio inativo e de procedimento inativo: fora.
      {
        procedure_id: PROC.limpeza,
        insurance_id: null,
        tipo: "acompanhante",
        valor_inteiro: null,
        texto_ao_paciente: null,
        ativo: false,
      },
      {
        procedure_id: PROC.consulta,
        insurance_id: CONV_INATIVO,
        tipo: "carteirinha",
        valor_inteiro: null,
        texto_ao_paciente: null,
        ativo: true,
      },
      {
        procedure_id: PROC_AG2.peeling,
        insurance_id: null,
        tipo: "acompanhante",
        valor_inteiro: null,
        texto_ao_paciente: null,
        ativo: true,
      },
    ],
    conveniosDosProfissionais: [
      { professional_id: PROF.ana, insurance_id: CONV.unimed },
      { professional_id: PROF.bruno, insurance_id: CONV.amil },
      { professional_id: PROF_AG2.carla, insurance_id: CONV.unimed },
      { professional_id: PROF_AG2.carla, insurance_id: CONV_INATIVO },
      { professional_id: PROF_AG2.saiu, insurance_id: CONV.amil },
    ],
    ...extra,
  };
}

/** O catalogo com o Cadastro da AG2. */
export function catalogoDoCadastro(
  extra: Partial<LinhasDoCatalogo> = {},
): CatalogoDoAgente {
  return montarCatalogoDoAgente(linhasDoCadastro(extra));
}

/** As opcoes das consultas com tudo ligado. */
export const TUDO_LIGADO = { informarConvenio: true, agendaLigada: true };
