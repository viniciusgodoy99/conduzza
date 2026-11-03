"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { ehAdminPleno } from "@/lib/domain/permissions";
import { CONSELHOS, ehUf } from "@/lib/domain/preparo";
import { createClient } from "@/lib/supabase/server";

// O responsavel tecnico (RT) da clinica (AG7, desenho 5.3 e 5.6; contrato
// 1.4 e 4.6): definir (ou trocar) e encerrar, pelas RPCs
// definir_responsavel_tecnico e encerrar_responsavel_tecnico da migration
// 20261103100000, com o cliente da SESSAO (as RPCs conferem o papel de novo,
// com auth.uid()).
//
// A guarda vive AQUI tambem (esconder botao nao protege nada): sessao com
// clinica ativa e so o administrador pleno (sem a marca de Implementador) ou
// a equipe Conduzza (super admin). Na duvida da marca (a leitura falhou), o
// administrador pode ser um Implementador: recusa com a mesma frase do
// banco. A clinica e SEMPRE a ativa da sessao, nunca uma vinda do cliente (o
// Zod estrito recusa qualquer chave a mais).
//
// O Zod confere os formatos que o banco confere (nome de 1 a 120 pontos de
// codigo, aparado e sem controle; conselho e UF das listas dos CHECKs;
// numero de 1 a 20 de letras, digitos, ponto, barra e hifen), e o nome e o
// numero vao aparados. Os erros do banco viram frase de recepcao; nada aqui
// vai para log (a action nao le nem grava dado de paciente, e o nome do RT
// so vai para a RPC).
//
// "use server": so funcoes assincronas saem daqui. Os textos sao repetidos
// em components/configuracoes/responsavel-tecnico-card.tsx (o cartao nao
// pode exportar para o servidor); o teste confere que batem.

export type ResultadoDoResponsavelTecnico =
  { ok: true } | { ok: false; error: string };

export type EntradaDoResponsavelTecnico = {
  userId: string;
  nome: string;
  conselho: string;
  numero: string;
  uf: string;
  confirmou: true;
};

// A frase 42501 das duas RPCs (contrato 1.4), exata.
const FRASE_DO_RT =
  "Só o administrador da clínica define o responsável técnico.";
const SESSAO_EXPIRADA = "Sessão expirada. Entre de novo.";
const NAO_SALVOU = "Não foi possível salvar agora. Tente de novo.";

// Por campo (o Zod daqui e o 22023 da RPC dizem a mesma coisa).
const TEXTO_DA_PESSOA = "Escolha a pessoa da equipe.";
const TEXTO_DO_NOME =
  "Confira o nome: até 120 caracteres, como está no conselho.";
const TEXTO_DO_CONSELHO = "Escolha o conselho.";
const TEXTO_DO_NUMERO =
  "Confira o número do registro: até 20 letras, números, ponto, barra ou hífen.";
const TEXTO_DA_UF = "Escolha a UF do registro.";
const TEXTO_DA_CONFIRMACAO = "Marque a confirmação para definir.";

// Mapas (e nao objetos): o codigo vem do banco, e "toString" num objeto
// acharia o prototipo.

// Os codigos de negocio (P0001) das duas RPCs (contrato 4.6).
const RECUSAS_DE_NEGOCIO = new Map<string, string>([
  [
    "responsavel_nao_e_membro_ativo",
    "Escolha uma pessoa com acesso ativo à clínica.",
  ],
  [
    "outra_definicao",
    "Outra pessoa definiu o responsável técnico agora. Feche e abra de novo.",
  ],
  [
    "sem_responsavel_tecnico",
    "A clínica não tem responsável técnico definido.",
  ],
]);

// As entradas invalidas (22023) de definir_responsavel_tecnico.
const ENTRADAS_INVALIDAS = new Map<string, string>([
  ["nome_invalido", TEXTO_DO_NOME],
  ["conselho_invalido", TEXTO_DO_CONSELHO],
  ["numero_invalido", TEXTO_DO_NUMERO],
  ["uf_invalida", TEXTO_DA_UF],
]);

const TEXTO_POR_CAMPO = new Map<PropertyKey, string>([
  ["userId", TEXTO_DA_PESSOA],
  ["nome", TEXTO_DO_NOME],
  ["conselho", TEXTO_DO_CONSELHO],
  ["numero", TEXTO_DO_NUMERO],
  ["uf", TEXTO_DA_UF],
  ["confirmou", TEXTO_DA_CONFIRMACAO],
]);

// O CHECK do nome: sem C0, DEL e C1 (o regex da RPC).
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/;
// O CHECK do numero, igual ao da RPC.
const NUMERO_DO_REGISTRO = /^[0-9A-Za-z./-]{1,20}$/;

/** Como o banco conta (char_length): pontos de codigo, nao unidades UTF-16. */
function tamanho(texto: string): number {
  return Array.from(texto).length;
}

const definirSchema = z.strictObject({
  userId: z.uuid(),
  // O trim do JavaScript tira os mesmos 25 brancos de cadastro_texto_valido.
  nome: z
    .string()
    .trim()
    .refine(
      (nome) =>
        tamanho(nome) >= 1 && tamanho(nome) <= 120 && !CONTROLE.test(nome),
    ),
  conselho: z.enum(CONSELHOS),
  numero: z.string().trim().regex(NUMERO_DO_REGISTRO),
  uf: z.string().refine(ehUf),
  confirmou: z.literal(true),
});

type ErroDoBanco = { code?: string; message?: string } | null;

/** O SQLSTATE e o codigo da RPC em frase de recepcao. */
function traduzir(error: NonNullable<ErroDoBanco>): string {
  // 42501: a frase da RPC, que as duas so mandam com FRASE_DO_RT. Um 42501
  // com outra mensagem (o grant que faltou, em ingles) vira a mesma frase:
  // o texto tecnico do Postgres nunca chega a tela.
  if (error.code === "42501") {
    return FRASE_DO_RT;
  }
  if (error.code === "P0001") {
    return RECUSAS_DE_NEGOCIO.get(error.message ?? "") ?? NAO_SALVOU;
  }
  if (error.code === "22023") {
    return ENTRADAS_INVALIDAS.get(error.message ?? "") ?? NAO_SALVOU;
  }
  return NAO_SALVOU;
}

/**
 * A recusa que diz que o RT mudou por outra pessoa enquanto a tela estava
 * aberta (outra definicao, o RT ja encerrado, a pessoa que perdeu o acesso):
 * a pagina recarrega, para o "Feche e abra de novo" mostrar o que vale.
 */
function mudouEnquantoAberta(error: NonNullable<ErroDoBanco>): boolean {
  return error.code === "P0001" && RECUSAS_DE_NEGOCIO.has(error.message ?? "");
}

function revalidarTelas(): void {
  revalidatePath("/configuracoes");
  // O RT decide o que Cadastros mostra na orientacao de preparo e a nota da
  // habilidade na Tela 6.
  revalidatePath("/cadastros");
  revalidatePath("/agente");
}

/**
 * Sessao com clinica ativa e quem define o RT: o administrador pleno ou a
 * equipe Conduzza. Devolve a clinica ATIVA (a unica que vai para a RPC).
 */
async function exigirQuemDefine(): Promise<
  { clinicId: string } | { error: string }
> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: SESSAO_EXPIRADA };
  }
  const { clinicId, role, implementador } = context.active;
  if (context.isProductAdmin === true) {
    return { clinicId };
  }
  // A marca de Implementador nao foi lida: o administrador pode ser um
  // Implementador, que o banco recusa (user_e_admin_pleno).
  if (role === "admin" && context.marcaDeImplementadorIndisponivel === true) {
    return { error: FRASE_DO_RT };
  }
  if (!ehAdminPleno(role, implementador === true)) {
    return { error: FRASE_DO_RT };
  }
  return { clinicId };
}

/**
 * Define o RT da clinica ativa (ou troca: a RPC encerra a designacao aberta
 * e cria a nova na mesma transacao). As orientacoes aprovadas pelo RT
 * anterior deixam de ser enviadas na hora (D-73).
 */
export async function definirResponsavelTecnicoAction(
  entrada: EntradaDoResponsavelTecnico,
): Promise<ResultadoDoResponsavelTecnico> {
  const quem = await exigirQuemDefine();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const lido = definirSchema.safeParse(entrada);
  if (!lido.success) {
    // O campo do primeiro problema; a chave a mais (a clinica vinda do
    // cliente, por exemplo) nao tem campo e cai na frase geral.
    const campo = lido.error.issues[0]?.path[0];
    return {
      ok: false,
      error:
        (campo === undefined ? undefined : TEXTO_POR_CAMPO.get(campo)) ??
        NAO_SALVOU,
    };
  }
  const { userId, nome, conselho, numero, uf } = lido.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("definir_responsavel_tecnico", {
    p_clinic_id: quem.clinicId,
    p_user_id: userId,
    p_nome: nome,
    p_conselho: conselho,
    p_numero: numero,
    p_uf: uf,
  });
  if (error) {
    if (mudouEnquantoAberta(error)) {
      revalidatePath("/configuracoes");
    }
    return { ok: false, error: traduzir(error) };
  }
  revalidarTelas();
  return { ok: true };
}

/**
 * Encerra a designacao aberta do RT da clinica ativa: a clinica fica sem RT e
 * nenhuma orientacao de preparo sai ate definir outro e ele aprovar de novo.
 */
export async function encerrarResponsavelTecnicoAction(): Promise<ResultadoDoResponsavelTecnico> {
  const quem = await exigirQuemDefine();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("encerrar_responsavel_tecnico", {
    p_clinic_id: quem.clinicId,
  });
  if (error) {
    if (mudouEnquantoAberta(error)) {
      revalidatePath("/configuracoes");
    }
    return { ok: false, error: traduzir(error) };
  }
  revalidarTelas();
  return { ok: true };
}
