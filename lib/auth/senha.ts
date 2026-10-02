import { z } from "zod";

// Regras da senha nova num lugar so (pedido do dono em 02/10/2026): o
// cadastro (clinica e codigo), o convite e a redefinicao pedem a senha duas
// vezes. O servidor confere com Zod (fonte da verdade) e a tela usa as mesmas
// mensagens na conferencia do navegador. Fica fora dos arquivos "use server",
// que so podem exportar funcao async.
//
// O login NAO usa isto: la a senha ja existe e nao ha confirmacao.

export const SENHA_MINIMA = 8;

export const SENHA_CURTA = `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres`;
export const DICA_DA_SENHA = `Pelo menos ${SENHA_MINIMA} caracteres.`;
export const REPITA_A_SENHA = "Repita a senha para confirmar.";
export const SENHAS_DIFERENTES =
  "As senhas não são iguais. Digite a mesma senha nos dois campos.";

// Campo ausente no FormData chega como null: sem o `error` do tipo, o Zod
// responderia em ingles ("expected string, received null").
export const senhaNovaSchema = z
  .string({ error: SENHA_CURTA })
  .min(SENHA_MINIMA, SENHA_CURTA);

export const confirmacaoSchema = z
  .string({ error: REPITA_A_SENHA })
  .min(1, REPITA_A_SENHA);

// Sem trim nas duas pontas: espaco faz parte da senha.
export function senhasConferem(dados: {
  password: string;
  confirmacao: string;
}): boolean {
  return dados.password === dados.confirmacao;
}

// Segundo argumento do .refine(senhasConferem, ...): o erro cai no campo da
// confirmacao. Os erros de cada campo (senha curta, confirmacao vazia) vem
// antes deste na lista de issues, que e a ordem certa para a mensagem.
export const CONFERENCIA_DAS_SENHAS: { message: string; path: string[] } = {
  message: SENHAS_DIFERENTES,
  path: ["confirmacao"],
};
