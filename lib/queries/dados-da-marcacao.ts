import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// Os dados que o paciente informou a IA para marcar a consulta (AG3, D-7;
// migration 20261027120000), pela RPC ler_dados_informados_na_marcacao, a
// UNICA leitura humana da tabela dados_informados_na_marcacao (nenhuma
// sessao le a tabela). A RPC confere quem le (quem escreve na clinica,
// user_can_write; o profissional so na propria agenda) e grava a trilha
// leu_dados_da_marcacao quando ha dado, sem o conteudo. Por isso so e
// chamada sob demanda, pelo "Ver dados informados" da Agenda, nunca a cada
// renderizacao.
//
// O retorno do banco passa por um Zod antes de chegar a tela: campo que falta
// ou fora da forma vira erro (nunca dado pela metade); chave que o banco
// acrescentar depois e descartada (nunca chega a tela sem codigo que a
// mostre). Nada daqui vai para log.

/** A linha como a tela usa (os nomes do banco traduzidos). */
export type DadosInformadosNaMarcacao = {
  nomeCompleto: string | null;
  /** "AAAA-MM-DD" (dia civil, sem fuso). */
  dataNascimento: string | null;
  /** So os 11 digitos (o banco confere o digito verificador). */
  cpf: string | null;
  carteirinha: string | null;
  /** A consulta e para o proprio contato da conversa. */
  paraOTitular: boolean;
  /** ISO (timestamptz): quando o paciente comecou a informar. */
  informadoEm: string;
  /** ISO: a ultima mudanca da linha. */
  atualizadoEm: string;
  /** ISO: quando a aprovacao aplicou ao cadastro; nulo se ainda nao. */
  aplicadoEm: string | null;
  /** Quem aprovou (o id da pessoa); nulo sem sessao. */
  aplicadoPorId: string | null;
};

export type LeituraDosDadosInformados =
  | { ok: true; dados: DadosInformadosNaMarcacao | null }
  /** codigo: o SQLSTATE do banco, ou "forma" quando o retorno nao fecha. */
  | { ok: false; codigo: string | null };

const DIA = /^\d{4}-\d{2}-\d{2}$/;

const linhaSchema = z.object({
  nome_completo: z.string().nullable(),
  data_nascimento: z.string().regex(DIA).nullable(),
  cpf: z
    .string()
    .regex(/^\d{11}$/)
    .nullable(),
  carteirinha: z.string().nullable(),
  para_o_titular: z.boolean(),
  informado_em: z.string().min(1),
  atualizado_em: z.string().min(1),
  aplicado_em: z.string().min(1).nullable(),
  aplicado_por: z.uuid().nullable(),
});

const retornoSchema = z.object({ dados: linhaSchema.nullable() });

/**
 * Le o que o paciente informou para a consulta, pela sessao (a RPC confere
 * o papel). Nunca lanca: erro do banco ou retorno fora da forma voltam como
 * { ok: false, codigo }.
 */
export async function lerDadosInformadosNaMarcacao(
  supabase: SupabaseClient,
  clinicId: string,
  appointmentId: string,
): Promise<LeituraDosDadosInformados> {
  let resposta: { data: unknown; error: { code?: string } | null };
  try {
    resposta = await supabase.rpc("ler_dados_informados_na_marcacao", {
      p_clinic_id: clinicId,
      p_appointment_id: appointmentId,
    });
  } catch {
    return { ok: false, codigo: null };
  }
  if (resposta.error) {
    return { ok: false, codigo: resposta.error.code ?? null };
  }
  const lido = retornoSchema.safeParse(resposta.data);
  if (!lido.success) {
    return { ok: false, codigo: "forma" };
  }
  const linha = lido.data.dados;
  if (linha === null) {
    return { ok: true, dados: null };
  }
  return {
    ok: true,
    dados: {
      nomeCompleto: linha.nome_completo,
      dataNascimento: linha.data_nascimento,
      cpf: linha.cpf,
      carteirinha: linha.carteirinha,
      paraOTitular: linha.para_o_titular,
      informadoEm: linha.informado_em,
      atualizadoEm: linha.atualizado_em,
      aplicadoEm: linha.aplicado_em,
      aplicadoPorId: linha.aplicado_por,
    },
  };
}
