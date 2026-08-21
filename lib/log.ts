// Logger estruturado do servidor. Etapa A da auditoria de escala: sem isto,
// nao existia UM log no projeto e uma clinica com WhatsApp caido ficava muda
// ate alguem notar.
//
// REGRA ABSOLUTA (CLAUDE.md 3.1): nenhum dado de paciente em log. A garantia
// aqui e estrutural, nao disciplinar: os campos passam por uma LISTA FECHADA
// e qualquer chave fora dela e descartada. Nao existe como logar corpo de
// mensagem, nome ou telefone por engano, porque essas chaves nao passam.

type NivelDeLog = "info" | "warn" | "error";

// Ids, codigos e medidas. NUNCA acrescentar chave que carregue conteudo
// (body, name, phone, email, transcript) nesta lista.
const CAMPOS_PERMITIDOS = new Set([
  "clinic_id",
  "conversation_id",
  "contact_id",
  "message_id",
  "wa_message_id",
  "user_id",
  "instance_id",
  "event_type",
  "status",
  "delivery_status",
  "connection_status",
  "error_code",
  "http_status",
  "provider",
  "path",
  "duration_ms",
  "count",
  "attempt",
  "job_id",
  "kind",
]);

export type CamposDeLog = Record<
  string,
  string | number | boolean | null | undefined
>;

function linha(
  nivel: NivelDeLog,
  evento: string,
  campos: CamposDeLog = {},
): string {
  const seguros: Record<string, string | number | boolean | null> = {};
  for (const [chave, valor] of Object.entries(campos)) {
    if (CAMPOS_PERMITIDOS.has(chave) && valor !== undefined) {
      seguros[chave] = valor;
    }
  }
  return `${JSON.stringify({
    ts: new Date().toISOString(),
    nivel,
    evento,
    ...seguros,
  })}\n`;
}

export const log = {
  info(evento: string, campos?: CamposDeLog): void {
    process.stdout.write(linha("info", evento, campos));
  },
  warn(evento: string, campos?: CamposDeLog): void {
    process.stdout.write(linha("warn", evento, campos));
  },
  error(evento: string, campos?: CamposDeLog): void {
    process.stderr.write(linha("error", evento, campos));
  },
};
