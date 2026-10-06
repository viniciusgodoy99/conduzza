// Trava de rede dos testes (Fase 3), carregada pelas tres configs do vitest
// (setupFiles: unidade, integracao e RLS) antes de cada arquivo de teste.
//
// O alias de "openai" para tests/stubs/openai-proibido.ts so pega o nome
// EXATO do pacote. Um import por outro caminho ("openai/client",
// "openai/index.js", um SDK da Anthropic que alguem traga de volta) montaria
// um cliente de verdade. Esta trava nao depende do caminho: embrulha o
// globalThis.fetch e lanca para qualquer host terminado em openai.com ou
// anthropic.com, antes de qualquer byte sair da maquina. O SDK da OpenAI
// le o fetch global no construtor, entao todo cliente criado num teste
// passa por aqui.
//
// Teste que injeta fetch proprio (vi.stubGlobal("fetch", ...) ou a opcao
// fetch do cliente) continua funcionando: o falso nao chama a rede, e o
// vi.unstubAllGlobals devolve esta trava. Os outros hosts (o Supabase local
// e o remoto dos testes de integracao) passam intactos.
//
// Nao cobre node:http, node:https nem o undici chamado direto: nenhum SDK de
// LLM do projeto usa esses caminhos.

/** Sufixos de host que nenhum teste pode chamar. */
export const HOSTS_PROIBIDOS = ["openai.com", "anthropic.com"] as const;

export const MENSAGEM_DA_TRAVA_DE_REDE =
  "Teste tentou chamar um provedor de LLM pela rede. Nenhum teste chama a OpenAI nem a Anthropic: injete um cliente ou um fetch falso.";

/** Marca no fetch embrulhado, para nao embrulhar duas vezes. */
export const MARCA_DA_TRAVA = Symbol.for("conduzza.testes.sem-rede-de-llm");

type Fetch = typeof fetch;
type FetchComMarca = Fetch & { [MARCA_DA_TRAVA]?: true };

/** Host da requisicao, minusculo e sem o ponto final; null se nao der. */
function hostDe(entrada: Parameters<Fetch>[0]): string | null {
  try {
    const endereco =
      entrada instanceof Request
        ? entrada.url
        : entrada instanceof URL
          ? entrada.href
          : String(entrada);
    return new URL(endereco).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    // Endereco que nem vira URL: o fetch de verdade tambem recusa.
    return null;
  }
}

export function hostProibido(entrada: Parameters<Fetch>[0]): boolean {
  const host = hostDe(entrada);
  return (
    host !== null && HOSTS_PROIBIDOS.some((sufixo) => host.endsWith(sufixo))
  );
}

/** Embrulha um fetch: host proibido rejeita, o resto vai para a base. */
export function fetchSemRedeDeLlm(base: Fetch): Fetch {
  const embrulhado: FetchComMarca = async (entrada, opcoes) => {
    if (hostProibido(entrada)) {
      throw new Error(MENSAGEM_DA_TRAVA_DE_REDE);
    }
    return base(entrada, opcoes);
  };
  embrulhado[MARCA_DA_TRAVA] = true;
  return embrulhado;
}

export function travaDeRedeInstalada(fetchAtual: unknown): boolean {
  return (
    typeof fetchAtual === "function" &&
    (fetchAtual as FetchComMarca)[MARCA_DA_TRAVA] === true
  );
}

// Sem fetch global (nao acontece no Node 18+), nao ha o que embrulhar: o SDK
// da OpenAI tambem nao monta cliente sem ele.
if (
  typeof globalThis.fetch === "function" &&
  !travaDeRedeInstalada(globalThis.fetch)
) {
  globalThis.fetch = fetchSemRedeDeLlm(globalThis.fetch);
}
