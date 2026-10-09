import type {
  ConfigDoAgente,
  ItemDaBase,
  Mudanca,
} from "@/lib/domain/agente/config";

// Tipos da tela do Agente de IA (Tela 6): o que a pagina (servidor) monta e
// o painel (cliente) desenha. Ficam aqui, e nao nas queries, para a tela nao
// depender do formato das linhas do banco: a pagina converte.

/** Uma versao publicada, com o que ela mudou em relacao a anterior. */
export type VersaoDoAgente = {
  versao: number;
  /** ISO; exibido no fuso da clinica. */
  publicadaEm: string;
  /** Nome de quem publicou; nulo quando a pessoa nao esta mais na clinica. */
  autor: string | null;
  /** diferencasDoRascunho(esta, anterior); a primeira compara com o padrao. */
  mudancas: Mudanca[];
  /** A ultima publicada: a que o assistente usa. */
  emUso: boolean;
};

/** O que o painel precisa para desenhar a tela inteira. */
export type DadosDoPainel = {
  clinicId: string;
  /** Fuso da clinica (CLAUDE.md 3.6): datas das versoes e da publicacao. */
  timezone: string;
  /**
   * O que a tela edita: o rascunho, ou, sem rascunho, a ultima publicada
   * (ou os padroes). A base e sempre a viva (knowledge_item).
   */
  config: ConfigDoAgente;
  /** Ha um rascunho gravado (versao em edicao). */
  temRascunho: boolean;
  /** A ultima publicada, para contar as alteracoes; nula se nunca publicou. */
  publicada: ConfigDoAgente | null;
  /** A base viva; nula quando a leitura falhou. */
  base: ItemDaBase[] | null;
  /** Historico, da mais nova para a mais antiga; nulo quando a leitura falhou. */
  versoes: VersaoDoAgente[] | null;
  /**
   * O rascunho muda as instrucoes da equipe Conduzza em relacao a ultima
   * publicada? Calculado no servidor (lib/agente/painel), sem o texto, para
   * todos os papeis: vira a linha "Instruções da equipe Conduzza" na
   * contagem, no publicar e na proxima versao. Nulo: nao deu para conferir
   * (a tela nao inventa a linha).
   */
  instrucoesMudaram: boolean | null;
  /** Administrador ou gestor com escrita, ou super admin. */
  podeEditar: boolean;
  /** A dica de quem nao edita (recepcao); nula para quem edita. */
  dicaSemPermissao: string | null;
  /** Equipe Conduzza: ve e edita as instrucoes e a previa. */
  superAdmin: boolean;
  /** Previa do texto que o modelo recebe (so super admin; nula para os outros). */
  previaDoPrompt: string | null;
  /**
   * Por que o simulador nao pode responder agora, em texto de recepcionista
   * (ambiente, interruptor). Nulo: pode tentar (a acao confere de novo, com o
   * teto do dia).
   */
  motivoDoSimulador: string | null;
};

/** Quem falou na conversa do simulador. */
export type AutorNoSimulador = "paciente" | "assistente";

/** Um passo do "Por que a IA respondeu isso" (nunca o texto do paciente). */
export type PassoDaTrilha = {
  tipo: "preco" | "base" | "equipe" | "bloqueio" | "outro";
  texto: string;
};

/** Uma fala da conversa do simulador, como a tela guarda. */
export type FalaDoSimulador = {
  id: string;
  autor: AutorNoSimulador;
  texto: string;
  /** So nas falas do assistente: resposta propria ou a frase fixa. */
  tipo?: "resposta" | "frase_fixa";
  /** So nas falas do assistente. */
  trilha?: PassoDaTrilha[];
  /**
   * O que o filtro barrou, quando a frase fixa veio de um bloqueio. So o
   * super admin recebe (o servidor manda nulo para os outros); nunca vai
   * para log.
   */
  rascunhoBloqueado?: string | null;
  /**
   * So nas falas do assistente: a assinatura do servidor, devolvida como
   * veio na rodada seguinte (sem ela, ou alterada, o servidor recusa).
   */
  assinatura?: string | null;
};

/**
 * O que a tela faz quando a acao termina: seDerCerto (fechar o formulario,
 * marcar como salvo) e seFalhar (mostrar o erro do servidor no formulario).
 */
export type RetornoDaAcao = {
  seDerCerto?: () => void;
  seFalhar?: (erro: string) => void;
};

/** O fim de uma acao, como a tela usa. */
export type ResultadoDaAcao = { ok: true } | { ok: false; erro: string };

/** O fim de uma rodada do simulador. */
export type ResultadoDaSimulacao =
  | {
      ok: true;
      resposta: string;
      tipo: "resposta" | "frase_fixa";
      trilha: PassoDaTrilha[];
      /** So para o super admin; nulo para os outros. */
      rascunhoBloqueado: string | null;
      /** A assinatura desta resposta (lib/agente/assinatura, no servidor). */
      assinatura: string;
    }
  | { ok: false; erro: string };
