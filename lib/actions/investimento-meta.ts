"use server";

import { revalidatePath } from "next/cache";

import {
  TEXTOS_DA_LEITURA,
  textoDoPedidoCedoDemais,
} from "@/components/configuracoes/investimento-meta";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit } from "@/lib/domain/permissions";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// "Atualizar agora" do investimento da Meta (Fase 4, critica 4.4 e C9). Mora
// em lib/actions porque a acao e do investimento, nao da tela; hoje so o
// cartao de Configuracoes chama (Resultados mostra "Atualizado em").
//
// Quem decide e a funcao do banco enfileirar_sincronizacao_de_gasto_meta
// (migration 20261003100000), chamada pelo cliente de servico DEPOIS da
// guarda de papel (EXECUTE so da service_role): ela serializa os cliques,
// segura 10 minutos entre pedidos manuais, recusa a leitura pausada e a
// clinica de teste e deduplica com o job vivo. Daqui nao sai nenhum insert
// direto na fila.

export type ResultadoDaAtualizacaoDoInvestimento =
  | { ok: true; codigo: "enfileirado" | "ja_na_fila" }
  | { ok: false; error: string };

export async function atualizarInvestimentoMetaAction(): Promise<ResultadoDaAtualizacaoDoInvestimento> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: TEXTOS_DA_LEITURA.sessaoExpirada };
  }
  if (!canEdit(context.active.role, "configuracoes")) {
    return { ok: false, error: TEXTOS_DA_LEITURA.semPermissao };
  }
  const clinicId = context.active.clinicId;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "enfileirar_sincronizacao_de_gasto_meta",
    { p_clinic_id: clinicId, p_origem: "manual" },
  );
  if (error) {
    log.warn("investimento_meta_pedido_falhou", {
      clinic_id: clinicId,
      error_code: error.code,
    });
    return { ok: false, error: TEXTOS_DA_LEITURA.atualizacaoNaoPedida };
  }
  const resposta = (data ?? {}) as { codigo?: unknown; liberado_em?: unknown };

  switch (resposta.codigo) {
    case "enfileirado":
    case "ja_na_fila": {
      const supabase = await createClient();
      await supabase.from("audit_log").insert({
        clinic_id: clinicId,
        user_id: context.userId,
        action: "pediu_atualizacao_do_investimento_meta",
        entity: "meta_gasto_leitura",
        entity_id: clinicId,
      });
      revalidatePath("/configuracoes");
      revalidatePath("/relatorios");
      return { ok: true, codigo: resposta.codigo };
    }
    case "aguarde":
      return {
        ok: false,
        error: textoDoPedidoCedoDemais(resposta.liberado_em, Date.now()),
      };
    case "sem_configuracao":
      return { ok: false, error: TEXTOS_DA_LEITURA.semConfiguracao };
    case "pausada":
      return { ok: false, error: TEXTOS_DA_LEITURA.pausada };
    case "clinica_de_teste":
      return { ok: false, error: TEXTOS_DA_LEITURA.clinicaDeTeste };
    default:
      log.warn("investimento_meta_pedido_falhou", {
        clinic_id: clinicId,
        error_code: "codigo_desconhecido",
      });
      return { ok: false, error: TEXTOS_DA_LEITURA.atualizacaoNaoPedida };
  }
}
