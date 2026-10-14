import { filtrarSaida } from "@/lib/domain/conformidade/filtro";
import type { TextoAprovado } from "@/lib/domain/conformidade/texto-aprovado";

// O UNICO jeito de os testes da IA no WhatsApp terem um TextoAprovado: o
// proprio filtro de saida (regras deterministicas e depois o verificador),
// com um verificador falso que aprova. Nada de retomarTextoAprovado: so o
// executor a chama, com a decisao lida do banco (revisao do E3; o teste de
// varredura em retomar-texto-aprovado.test.ts confere). Nenhuma chamada a
// OpenAI.

/**
 * TextoAprovado de teste pelo filtrarSaida. precosDoTurno: os price_cents
 * que a busca teria devolvido (texto com preco precisa deles). Lanca se as
 * regras barrarem o texto: o teste esta usando um texto que nao sairia.
 */
export async function aprovarParaTeste(
  texto: string,
  precosDoTurno: readonly number[] = [],
): Promise<TextoAprovado> {
  const decisao = await filtrarSaida({
    rascunho: texto,
    contexto: {
      precosDoTurno,
      nomesDoCatalogo: [],
      mensagensDoPaciente: ["Oi"],
    },
    verificador: async () => ({
      tipo: "veredicto",
      veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
      modelo: "verificador-de-teste",
      uso: null,
    }),
  });
  if (!decisao.aprovado) {
    throw new Error("texto de teste nao passou no filtro de saida");
  }
  return decisao.texto;
}
