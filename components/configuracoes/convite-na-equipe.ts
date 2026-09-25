// Convite para a equipe (achados L17 e L20 da revisao da leva 2).
//
// Convidar o e-mail de quem ja tem conta cria o vinculo na hora: a pessoa
// encontra a clinica em "Trocar de clinica" quando entrar. Quem convida NAO
// pode descobrir por esse caminho que o e-mail tem cadastro, nem o nome que a
// pessoa usa: o cadastro e publico, e qualquer um vira administrador criando
// uma clinica. Por isso, nos dois casos (conta nova e conta que ja existia):
// - a resposta da tela e a mesma (conviteRegistrado);
// - a trilha grava a mesma linha (ACAO_DE_CONVITE), porque administrador e
//   gestor leem a trilha e uma acao propria devolveria o oraculo;
// - a lista da equipe mostra, para quem foi convidado e ainda nao usou a
//   clinica, o nome que uma conta nova teria (o comeco do e-mail, a regra do
//   gatilho sincronizar_perfil), e nao o nome que a pessoa escolheu.
//
// Modulo puro: serve a Server Action e a pagina, sem espelho para
// dessincronizar.

/** Acao gravada em audit_log a cada convite, exista a conta ou nao. */
export const ACAO_DE_CONVITE = "convidou_membro";

/** Resposta de sucesso do convite, a mesma para conta nova e existente. */
export function conviteRegistrado(email: string): string {
  return `Convite registrado para ${email}`;
}

/**
 * Nome que o gatilho sincronizar_perfil da a uma conta criada sem nome (o
 * convite de conta nova): o comeco do e-mail, antes da arroba.
 */
export function nomeDoEmail(email: string): string {
  return email.split("@")[0] ?? "";
}

/**
 * Quem pode estar exibindo um nome escolhido pela propria pessoa: o nome do
 * perfil difere do comeco do e-mail. So esses precisam da conferencia de
 * convite; para os demais, esconder e mostrar dao o mesmo texto.
 */
export function temNomeProprio(
  nome: string | undefined,
  email: string | undefined,
): boolean {
  if (!nome) {
    return false;
  }
  return nome !== nomeDoEmail(email ?? "");
}

/**
 * Nome exibido na lista da equipe. Escondido, vira o comeco do e-mail, que e
 * exatamente o que aparece para um convite de conta nova.
 */
export function nomeNaEquipe({
  nome,
  email,
  esconder,
}: {
  nome: string | undefined;
  email: string | undefined;
  esconder: boolean;
}): string {
  if (esconder) {
    return nomeDoEmail(email ?? "") || "Usuário";
  }
  return nome ?? (email || "Usuário");
}

/**
 * Hora do convite MAIS RECENTE de cada pessoa, a partir das linhas da trilha
 * (entity_id = quem foi convidado). Linha sem pessoa e ignorada.
 */
export function ultimoConvitePorPessoa(
  linhas: { entity_id: string | null; created_at: string }[],
): Map<string, string> {
  const ultimo = new Map<string, string>();
  for (const linha of linhas) {
    if (!linha.entity_id) {
      continue;
    }
    const atual = ultimo.get(linha.entity_id);
    if (
      atual === undefined ||
      Date.parse(linha.created_at) > Date.parse(atual)
    ) {
      ultimo.set(linha.entity_id, linha.created_at);
    }
  }
  return ultimo;
}
