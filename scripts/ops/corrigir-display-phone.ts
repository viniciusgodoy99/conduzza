import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { chaveDoCelularPareado } from "../../lib/domain/celular-duplicado";
import {
  getWhatsAppProvider,
  type InstanceStatus,
} from "../../lib/integrations/whatsapp/provider";
import { UazapiHttpError } from "../../lib/integrations/whatsapp/uazapi";

// Correcao UNICA do achado N[2] da revisao da Fase 2 (varios numeros por
// clinica, docs/07_multiplos_numeros_whatsapp.md).
//
// Instancias pareadas antes da correcao do parse do uazapi guardaram o NOME
// do perfil em whatsapp_account.display_phone, no lugar do telefone. Um
// numero assim fica invisivel para a trava do mesmo celular em duas
// instancias (nome nao se compara com telefone), e nada no fluxo normal o
// corrige: o "Verificar conexao" so aparece com o numero desconectado.
//
// Este script, por service role, pega os numeros CONECTADOS, nao removidos e
// que nao sao do simulador cujo display_phone nao e telefone, pergunta ao
// provedor (getStatus) e grava SO o telefone. Nunca mexe no status: o numero
// continua conectado como esta (passar pela trava aqui o derrubaria).
//
//   npx tsx scripts/ops/corrigir-display-phone.ts            (simulacao: so lista)
//   npx tsx scripts/ops/corrigir-display-phone.ts --gravar   (grava)
//
// Precisa de NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e
// UAZAPI_SERVER_URL (para o numero sem server_url proprio), lidos do ambiente
// ou do .env.local. A saida so tem ids e situacoes: nenhum telefone, nenhum
// dado de paciente.
//
// Conferencia depois de gravar (deve voltar vazia):
//   select id from whatsapp_account
//    where removido_em is null and connection_status = 'conectado'
//      and provider <> 'fake'
//      and length(regexp_replace(coalesce(display_phone, ''), '\D', '', 'g'))
//          not between 10 and 15;

const gravar = process.argv.includes("--gravar");

function carregarEnvLocal(): void {
  const caminho = join(process.cwd(), ".env.local");
  if (!existsSync(caminho)) {
    return;
  }
  for (const linha of readFileSync(caminho, "utf-8").split("\n")) {
    const igual = linha.indexOf("=");
    if (igual <= 0 || linha.trimStart().startsWith("#")) {
      continue;
    }
    const chave = linha.slice(0, igual).trim();
    if (!/^[A-Z0-9_]+$/.test(chave) || process.env[chave] !== undefined) {
      continue;
    }
    let valor = linha.slice(igual + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (valor) {
      process.env[chave] = valor;
    }
  }
}

function clienteDeServico(): SupabaseClient {
  carregarEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    throw new Error(
      "Preencha NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente ou no .env.local.",
    );
  }
  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Numero = {
  id: string;
  clinic_id: string;
  provider: string;
  server_url: string | null;
  instance_id: string | null;
  display_phone: string | null;
};

type Situacao =
  | "gravado"
  | "gravaria"
  | "falha_ao_gravar"
  | "provedor_sem_telefone"
  | "nao_esta_conectado"
  | "instancia_invalida"
  | "provedor_indisponivel"
  | "segredo_ilegivel";

async function corrigir(
  admin: SupabaseClient,
  numero: Numero,
): Promise<Situacao> {
  const { data: segredo, error: erroDoSegredo } = await admin
    .from("whatsapp_account_secret")
    .select("instance_token")
    .eq("clinic_id", numero.clinic_id)
    .eq("account_id", numero.id)
    .maybeSingle();
  if (erroDoSegredo) {
    return "segredo_ilegivel";
  }

  let status: InstanceStatus;
  try {
    status = await getWhatsAppProvider(numero.provider).getStatus({
      clinicId: numero.clinic_id,
      accountId: numero.id,
      serverUrl: numero.server_url,
      instanceToken:
        (segredo as { instance_token: string | null } | null)?.instance_token ??
        null,
      instanceId: numero.instance_id,
    });
  } catch (erro) {
    return erro instanceof UazapiHttpError &&
      erro.motivo === "instancia_invalida"
      ? "instancia_invalida"
      : "provedor_indisponivel";
  }
  if (status.status !== "conectado") {
    return "nao_esta_conectado";
  }
  const telefone = status.displayPhone ?? null;
  if (telefone === null || chaveDoCelularPareado(telefone) === null) {
    return "provedor_sem_telefone";
  }
  if (!gravar) {
    return "gravaria";
  }
  // SO o telefone, e so se o numero continua ativo e conectado: nada de
  // status, nada de trava.
  const { data: gravados, error } = await admin
    .from("whatsapp_account")
    .update({ display_phone: telefone })
    .eq("clinic_id", numero.clinic_id)
    .eq("id", numero.id)
    .is("removido_em", null)
    .eq("connection_status", "conectado")
    .select("id");
  if (error || !gravados || gravados.length === 0) {
    return "falha_ao_gravar";
  }
  return "gravado";
}

async function main(): Promise<void> {
  const admin = clienteDeServico();
  const { data, error } = await admin
    .from("whatsapp_account")
    .select("id, clinic_id, provider, server_url, instance_id, display_phone")
    .is("removido_em", null)
    .eq("connection_status", "conectado")
    .neq("provider", "fake");
  if (error) {
    throw new Error(`Leitura dos números falhou (código ${error.code}).`);
  }
  const alvos = ((data ?? []) as Numero[]).filter(
    (numero) => chaveDoCelularPareado(numero.display_phone) === null,
  );

  console.log(
    `${gravar ? "GRAVANDO" : "SIMULAÇÃO (use --gravar para gravar)"}: ${alvos.length} número(s) conectado(s) sem telefone em display_phone.`,
  );
  const contagem = new Map<Situacao, number>();
  for (const numero of alvos) {
    const situacao = await corrigir(admin, numero);
    contagem.set(situacao, (contagem.get(situacao) ?? 0) + 1);
    console.log(
      `  número ${numero.id} (clínica ${numero.clinic_id}, ${numero.provider}): ${situacao}`,
    );
  }
  console.log("Resumo:");
  for (const [situacao, quantos] of contagem) {
    console.log(`  ${situacao.padEnd(24)} ${quantos}`);
  }
  const pendentes = alvos.length - (contagem.get("gravado") ?? 0);
  if (gravar && pendentes > 0) {
    console.log(
      `${pendentes} número(s) continuam sem telefone: a trava os trata como desconhecidos e consulta o provedor a cada pareamento novo.`,
    );
    process.exitCode = 1;
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : "Falha inesperada.");
  process.exitCode = 1;
});
