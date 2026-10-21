import { ROTULO_DO_PAPEL, type PapelNaTela } from "@/lib/domain/permissions";

// O Implementador na equipe (onda 5, item 18; contrato B.2 e B.3). Modulo
// puro: serve as Server Actions da equipe e do convite, a lista da equipe, a
// liberacao dos pedidos e o formulario de convite, sem espelho para
// dessincronizar. As mesmas travas existem no banco (gatilhos de
// clinic_member e da marca, migration 20261025110000); aqui elas so explicam
// ANTES de tentar, com o nome da acao certa.
//
// Decisoes do dono (21/10/2026):
// - P18-2: o Implementador nao mexe em administrador nem em outro
//   Implementador (fica como o gestor diante deles);
// - P18-3: ele nao conta como o administrador que a clinica precisa ter;
// - P18-4: so o administrador da clinica (sem a marca, o "pleno") faz
//   alguem Implementador, e so ele cria administrador.

/**
 * Aviso fixo do convite (e da liberacao) de Implementador: a clinica decide
 * quem ve dado de saude (LGPD).
 */
export const AVISO_DO_IMPLEMENTADOR =
  "O implementador vê tudo o que o administrador vê, inclusive as conversas e os dados dos pacientes. Convide só quem a clínica autorizou.";

/** Papeis que so o administrador pleno da (P18-2 e P18-4). */
export function papelSoDoAdminPleno(papel: PapelNaTela): boolean {
  return papel === "admin" || papel === "implementador";
}

export type AcaoDePapel = "convidar" | "liberar" | "trocar";

/**
 * Quem nao e administrador pleno nao DA o papel de administrador nem o de
 * Implementador (convite, liberacao de pedido ou troca). Nulo: pode.
 */
export function recusaDePapelDeAdmin(
  chamadorPleno: boolean,
  papel: PapelNaTela,
  acao: AcaoDePapel,
): string | null {
  if (chamadorPleno || !papelSoDoAdminPleno(papel)) {
    return null;
  }
  if (papel === "implementador") {
    return acao === "convidar"
      ? "Somente um administrador da clínica convida um implementador."
      : "Somente um administrador da clínica faz de alguém implementador.";
  }
  return acao === "convidar"
    ? "Somente um administrador convida outro administrador."
    : "Somente um administrador cria outro administrador.";
}

export const PAPEL_PROPRIO_NAO_CONFERIDO =
  "Não foi possível conferir o seu papel. Tente de novo.";

/**
 * A marca de Implementador da PROPRIA sessao nao carregou (a leitura falhou;
 * tabela ausente nao conta: ai ninguem tem marca). Com o vinculo admin, a
 * pessoa pode ser Implementador, e a sessao a trata como administrador
 * pleno. Onde algo sai ANTES de o banco recusar (o e-mail do convite: o
 * GoTrue manda e so depois o vinculo admin ou a RPC sao recusados), o papel
 * que so o administrador pleno da nao sai na duvida: recusa e pede para
 * tentar de novo, como a exportacao dos leads (503). Nulo: pode seguir.
 */
export function recusaSemConferirAMarca(
  marcaIndisponivel: boolean,
  papelDoChamador: string,
  papel: PapelNaTela,
): string | null {
  return marcaIndisponivel &&
    papelDoChamador === "admin" &&
    papelSoDoAdminPleno(papel)
    ? PAPEL_PROPRIO_NAO_CONFERIDO
    : null;
}

/**
 * Quem nao e administrador pleno nao mexe no acesso de administrador nem de
 * Implementador (papel, tirar ou devolver o acesso). Nulo: pode.
 */
export function barrarMexidaEmAdmin(
  chamadorPleno: boolean,
  papelDoAlvo: PapelNaTela,
): string | null {
  if (chamadorPleno) {
    return null;
  }
  if (papelDoAlvo === "admin") {
    return "Somente um administrador altera o acesso de outro administrador.";
  }
  if (papelDoAlvo === "implementador") {
    return "Somente um administrador altera o acesso de um implementador.";
  }
  return null;
}

const SUFIXO_DA_OPCAO_TRAVADA: Record<AcaoDePapel, string> = {
  convidar: "só um administrador convida",
  liberar: "só um administrador libera",
  trocar: "só um administrador promove",
};

/**
 * O rotulo da opcao do seletor: travada para quem nao e administrador pleno
 * nos papeis que so ele da (visivel e desabilitada, com o porque).
 */
export function rotuloDaOpcao(
  papel: PapelNaTela,
  travada: boolean,
  acao: AcaoDePapel,
): string {
  if (!travada) {
    return ROTULO_DO_PAPEL[papel];
  }
  const sufixo =
    papel === "implementador"
      ? "só um administrador escolhe"
      : SUFIXO_DA_OPCAO_TRAVADA[acao];
  return `${ROTULO_DO_PAPEL[papel]} (${sufixo})`;
}

/**
 * O unico administrador PLENO ativo da clinica (P18-3: o Implementador nao
 * conta), ou nulo quando ha mais de um (ou nenhum). A linha dele fica
 * travada: a clinica sempre precisa de um.
 */
export function unicoAdminPlenoId(
  membros: readonly {
    userId: string;
    papel: string;
    implementador: boolean;
    ativo: boolean;
  }[],
): string | null {
  const plenos = membros.filter(
    (membro) =>
      membro.ativo && membro.papel === "admin" && !membro.implementador,
  );
  return plenos.length === 1 ? (plenos[0]?.userId ?? null) : null;
}

// Recusas do banco que ja vem em portugues e explicam o motivo (gatilhos de
// clinic_member e da marca): repassar ajuda mais que um "algo deu errado".
export const RECUSAS_DA_EQUIPE = [
  "Somente um administrador",
  "A clínica precisa de pelo menos um administrador ativo.",
  "Você não pode alterar o próprio papel",
  "Você não altera o próprio papel.",
  "Só um administrador da clínica pode ser implementador.",
  // Gatilho exigir_cadastro_da_mesma_clinica (leva 1): o vinculo usuario ->
  // profissional so aceita profissional da mesma clinica.
  "O profissional informado não pertence a esta clínica.",
] as const;

// As chaves das RPCs do Implementador (P0001 e 22023, nunca 40001).
const CHAVES_DO_IMPLEMENTADOR: readonly { chave: string; texto: string }[] = [
  {
    chave: "papel_mudou",
    texto: "O papel mudou em outro lugar. Recarregue a página.",
  },
  { chave: "ja_e_implementador", texto: "Esta pessoa já é implementador." },
  {
    chave: "situacao_invalida",
    texto: "A situação desta pessoa mudou. Recarregue a página.",
  },
  {
    chave: "papel_invalido",
    texto: "O papel mudou em outro lugar. Recarregue a página.",
  },
];

/**
 * A recusa do banco na equipe em texto de recepcao: as chaves das RPCs do
 * Implementador, as frases dos gatilhos (repassadas) e a falta de
 * permissao. Nulo: nada conhecido (quem chama usa o texto padrao dele).
 */
export function recusaDaEquipe(
  error: { code?: string; message?: string } | null,
): string | null {
  if (!error) {
    return null;
  }
  const mensagem = error.message ?? "";
  const chave = CHAVES_DO_IMPLEMENTADOR.find(
    (item) => mensagem === item.chave || mensagem.includes(item.chave),
  );
  if (chave) {
    return chave.texto;
  }
  if (RECUSAS_DA_EQUIPE.some((trecho) => mensagem.includes(trecho))) {
    return mensagem;
  }
  if (error.code === "42501") {
    return "Seu perfil não altera o acesso da equipe.";
  }
  return null;
}
