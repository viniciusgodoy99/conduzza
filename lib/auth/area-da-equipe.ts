import type { SessionContext } from "@/lib/auth/active-clinic";

// A area do super admin (decisao do dono de 03/11/2026, "Conta propria so
// para o painel"): o super admin usa um e-mail so para isso, que nao e
// membro de clinica nenhuma e cai direto no Painel geral, numa area separada
// da clinica (app/(admin), com menu proprio). Para trabalhar numa clinica, a
// pessoa usa a conta normal. As contas antigas (super admin e membro de
// clinica ao mesmo tempo) continuam entrando na clinica como antes, ate a
// limpeza (supabase/operacao/super-admin-separado.md).
//
// Aqui so a escolha de para onde a pessoa vai, sem I/O: os layouts leem a
// sessao (getSessionContext) e chamam estas funcoes. Esconder a tela nao
// protege nada: cada Server Action do painel confere o super admin de novo
// e as funcoes do banco recusam (42501) quem nao e.

type SessaoDaEntrada = Pick<
  SessionContext,
  "isProductAdmin" | "memberships" | "vinculoIndisponivel"
>;

/** Tem vinculo ATIVO em alguma clinica (pendente e suspensa nao contam). */
export function temClinicaAtiva(
  sessao: Pick<SessionContext, "memberships">,
): boolean {
  return sessao.memberships.some((vinculo) => vinculo.status === "ativo");
}

/**
 * O super admin sem nenhum vinculo ativo vai direto para o Painel geral
 * (app/(app)/layout.tsx): a conta do painel nunca ve "Criar clinica" nem
 * "Sem clinica vinculada". Com a leitura dos vinculos falhando, nada se
 * decide aqui: o layout mostra "Seu acesso nao carregou".
 */
export function vaiDiretoParaOPainel(sessao: SessaoDaEntrada): boolean {
  return (
    sessao.isProductAdmin &&
    !sessao.vinculoIndisponivel &&
    !temClinicaAtiva(sessao)
  );
}

/** O que a guarda da area do super admin faz (app/(admin)/layout.tsx). */
export type EntradaNaAreaDaEquipe =
  | { destino: "login" }
  | { destino: "inicio" }
  | { destino: "indisponivel" }
  | {
      destino: "painel";
      /**
       * A conta ainda e membro ativo de alguma clinica (as contas antigas,
       * ate a limpeza): o menu ganha "Abrir a clinica", para o Inicio.
       */
      abrirClinica: boolean;
    };

/**
 * Sem sessao, o login. Leitura da sessao que falhou (o vinculo ou o proprio
 * super admin): "Seu acesso nao carregou", sem decidir nada, porque sem a
 * leitura nao da para saber se a pessoa e da equipe Conduzza. Quem nao e
 * super admin vai para o Inicio. O super admin fica no painel.
 */
export function entradaNaAreaDaEquipe(
  sessao: SessaoDaEntrada | null,
): EntradaNaAreaDaEquipe {
  if (!sessao) {
    return { destino: "login" };
  }
  if (sessao.vinculoIndisponivel) {
    return { destino: "indisponivel" };
  }
  if (!sessao.isProductAdmin) {
    return { destino: "inicio" };
  }
  return { destino: "painel", abrirClinica: temClinicaAtiva(sessao) };
}
