import { fraseDeNumerosDesconectados } from "@/lib/jobs/numero-de-envio";

// O aviso depois do "Cobrar agora" da Tela 2, em portugues de recepcao.
// PURO: a tela so repassa o resultado da action e mostra o que sai daqui.
//
// Com varios numeros de WhatsApp (docs/07), parte da selecao pode parar num
// numero desconectado. Essas consultas NAO entram na fila (o envio nunca troca
// de numero sozinho, lib/jobs/cobranca-manual.ts), entao o aviso nao promete
// que elas saem depois: diz quantas ficaram sem cobranca, por qual numero, e
// o que fazer.

export type ResultadoDaCobranca = {
  enfileirados?: number;
  pulados_sem_autorizacao?: number;
  pulados_desconectado?: number;
  numeros_desconectados?: string[];
};

export type ResumoDaCobranca = {
  /** success so quando algo saiu e nada ficou preso em numero desconectado. */
  tom: "success" | "warning";
  titulo: string;
  /** O numero desconectado e o que fazer; nulo quando nada ficou preso. */
  detalhe: string | null;
};

const FIM_DO_DETALHE = ". Reconecte em Configurações e cobre de novo.";

export function resumoDaCobranca(
  resultado: ResultadoDaCobranca,
): ResumoDaCobranca {
  const enfileirados = resultado.enfileirados ?? 0;
  const semAutorizacao = resultado.pulados_sem_autorizacao ?? 0;
  const desconectadas = resultado.pulados_desconectado ?? 0;

  const partes: string[] = [
    enfileirados === 1
      ? "1 cobrança na fila de envio"
      : `${enfileirados} cobranças na fila de envio`,
  ];
  if (semAutorizacao > 0) {
    partes.push(
      semAutorizacao === 1
        ? "1 pulada por falta de autorização"
        : `${semAutorizacao} puladas por falta de autorização`,
    );
  }
  if (desconectadas > 0) {
    partes.push(
      desconectadas === 1
        ? "1 não cobrada por número desconectado"
        : `${desconectadas} não cobradas por número desconectado`,
    );
  }

  return {
    tom: enfileirados > 0 && desconectadas === 0 ? "success" : "warning",
    titulo: partes.join(", "),
    detalhe:
      desconectadas > 0
        ? `${
            fraseDeNumerosDesconectados(
              resultado.numeros_desconectados ?? [],
            ) ?? "O WhatsApp está desconectado"
          }${FIM_DO_DETALHE}`
        : null,
  };
}
