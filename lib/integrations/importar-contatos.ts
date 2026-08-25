import type { SupabaseClient } from "@supabase/supabase-js";

import { dividirEmLotes, type LinhaImportada } from "@/lib/domain/importacao";
import {
  consentimentoVigenteDeLinhas,
  type LinhaConsent,
} from "@/lib/domain/leads-ui";

// Miolo da importacao de planilha (Tela 4, tarefa 4.4). Recebe o cliente
// Supabase de quem chama: a Server Action passa o cliente de SESSAO (a RLS
// aplica) e o teste de integracao passa o service role. Um lote tem no maximo
// 500 linhas ja validadas por validarLinha; quem divide e a tela.
//
// Por que nao um upsert unico: o upsert do PostgREST sobrescreve coluna a
// coluna, e planilha com nome vazio apagaria nome ja preenchido no cadastro.
// O fluxo e set-based em etapas: (a) select dos telefones existentes,
// (b) insert dos novos, (c) update dos existentes so no que veio preenchido
// (nome apenas quando o cadastro esta sem nome).

export type OpcaoDeclaracao =
  | "formulario_site"
  | "anuncio_ctwa"
  | "recepcao"
  | "outra";

export type DeclaracaoDeConsentimento = {
  opcao: OpcaoDeclaracao;
  observacao?: string;
};

export const ROTULO_DA_DECLARACAO: Record<OpcaoDeclaracao, string> = {
  formulario_site: "Formulário do site",
  anuncio_ctwa: "Anúncio com clique para o WhatsApp",
  recepcao: "Cadastro presencial na recepção",
  outra: "Outra origem",
};

/**
 * Evidencia gravada em contact_consent: o rotulo da declaracao escolhida na
 * tela, com a observacao quando houver. E uma declaracao de LOTE, a mesma
 * string para as 500 linhas, entao vale so para quem nunca pediu descadastro:
 * texto generico nao prova que uma pessoa especifica autorizou de novo (regra
 * 3.4). Quem revogou e pulado pela importacao e segue sem autorizacao.
 */
export function evidenciaDaDeclaracao(
  declaracao: DeclaracaoDeConsentimento,
): string {
  const rotulo = ROTULO_DA_DECLARACAO[declaracao.opcao];
  const observacao = declaracao.observacao?.trim();
  return observacao ? `${rotulo}: ${observacao}` : rotulo;
}

export type ResultadoDaImportacao =
  | {
      ok: true;
      /** Contatos que nao existiam e foram criados. */
      importados: number;
      /** Contatos que ja existiam (dados completados quando faltavam). */
      atualizados: number;
      /**
       * Contatos que ja tinham pedido descadastro: os dados entraram, mas a
       * autorizacao NAO voltou e nenhuma regua os alcanca.
       */
      mantidos_sem_autorizacao: number;
      /** Contatos com consentimento ja vigente: nenhuma linha nova empilhada. */
      pulados: number;
    }
  | { ok: false; error: string };

// Filtro .in() vai na URL do PostgREST: pedacos de 100 evitam estourar o
// limite de tamanho de requisicao com 500 telefones ou uuids.
const PEDACO_DE_CONSULTA = 100;

type ContatoExistente = {
  id: string;
  phone_e164: string;
  name: string | null;
  email: string | null;
  insurance_id: string | null;
};

type LinhaConsentDeContato = LinhaConsent & { contact_id: string };

function normalizarNomeDeConvenio(nome: string): string {
  return nome.trim().toLowerCase();
}

export async function importarContatos(
  supabase: SupabaseClient,
  clinicId: string,
  payload: {
    declaracao: DeclaracaoDeConsentimento;
    lote: readonly LinhaImportada[];
  },
): Promise<ResultadoDaImportacao> {
  // Telefone repetido dentro do lote: a primeira linha vence. Sem isso o
  // insert em massa quebraria na unique (clinic_id, phone_e164).
  const porTelefone = new Map<string, LinhaImportada>();
  for (const linha of payload.lote) {
    if (!porTelefone.has(linha.phone_e164)) {
      porTelefone.set(linha.phone_e164, linha);
    }
  }
  const linhas = [...porTelefone.values()];
  if (linhas.length === 0) {
    return { ok: false, error: "O lote chegou vazio." };
  }

  // (a) Quem ja existe, numa consulta set-based por telefone.
  const existentes = new Map<string, ContatoExistente>();
  for (const pedaco of dividirEmLotes(
    linhas.map((linha) => linha.phone_e164),
    PEDACO_DE_CONSULTA,
  )) {
    const { data, error } = await supabase
      .from("contact")
      .select("id, phone_e164, name, email, insurance_id")
      .eq("clinic_id", clinicId)
      .in("phone_e164", pedaco);
    if (error) {
      return { ok: false, error: "Não foi possível conferir os contatos." };
    }
    for (const contato of (data ?? []) as ContatoExistente[]) {
      existentes.set(contato.phone_e164, contato);
    }
  }

  // Convenio da planilha vira insurance_id SO quando o nome bate com um
  // convenio cadastrado na clinica (comparacao sem caixa). Nome desconhecido
  // e ignorado: a importacao nao inventa cadastro de convenio.
  const convenios = new Map<string, string>();
  if (linhas.some((linha) => linha.insurance_name !== null)) {
    const { data, error } = await supabase
      .from("insurance")
      .select("id, name")
      .eq("clinic_id", clinicId);
    if (error) {
      return { ok: false, error: "Não foi possível conferir os convênios." };
    }
    for (const convenio of (data ?? []) as { id: string; name: string }[]) {
      convenios.set(normalizarNomeDeConvenio(convenio.name), convenio.id);
    }
  }
  const convenioDe = (linha: LinhaImportada): string | null =>
    linha.insurance_name
      ? (convenios.get(normalizarNomeDeConvenio(linha.insurance_name)) ?? null)
      : null;

  // (b) Insert dos novos, num insert so.
  //
  // Decisao registrada sobre origem: a importacao NAO inventa canal. Grava
  // apenas source_campaign (quando a coluna veio) com source_method
  // "importacao". Os checks contact_source_channel_valido e
  // contact_source_method_valido sao independentes e aceitam channel nulo, e
  // o gatilho impedir_reatribuicao_de_origem so arma quando source_channel
  // esta preenchido: uma atribuicao real futura (token de campanha) ainda
  // pode completar a origem deste contato.
  const novas = linhas.filter((linha) => !existentes.has(linha.phone_e164));
  const idsDoLote: string[] = [];
  if (novas.length > 0) {
    const { data, error } = await supabase
      .from("contact")
      .insert(
        novas.map((linha) => ({
          clinic_id: clinicId,
          phone_e164: linha.phone_e164,
          name: linha.name,
          email: linha.email,
          insurance_id: convenioDe(linha),
          kind: "lead",
          ...(linha.source_campaign
            ? {
                source_campaign: linha.source_campaign,
                source_method: "importacao",
              }
            : {}),
        })),
      )
      .select("id");
    if (error || !data) {
      if (error?.code === "23505") {
        return {
          ok: false,
          error:
            "Outra importação gravou alguns destes contatos ao mesmo tempo. Tente o lote de novo.",
        };
      }
      return { ok: false, error: "Não foi possível gravar os contatos novos." };
    }
    for (const criado of data as { id: string }[]) {
      idsDoLote.push(criado.id);
    }
  }

  // (c) Update dos existentes: nome so quando o cadastro esta sem nome,
  // e-mail e convenio so quando a planilha trouxe valor. Nada de source_*
  // aqui: origem ja capturada e imutavel (gatilho no banco).
  let atualizados = 0;
  for (const linha of linhas) {
    const atual = existentes.get(linha.phone_e164);
    if (!atual) {
      continue;
    }
    idsDoLote.push(atual.id);
    atualizados += 1;
    const campos: Record<string, string> = {};
    if (atual.name === null && linha.name !== null) {
      campos.name = linha.name;
    }
    if (linha.email !== null && linha.email !== atual.email) {
      campos.email = linha.email;
    }
    const convenioId = convenioDe(linha);
    if (convenioId !== null && convenioId !== atual.insurance_id) {
      campos.insurance_id = convenioId;
    }
    if (Object.keys(campos).length === 0) {
      continue;
    }
    const { error } = await supabase
      .from("contact")
      .update(campos)
      .eq("clinic_id", clinicId)
      .eq("id", atual.id);
    if (error) {
      return {
        ok: false,
        error: "Não foi possível atualizar os contatos que já existiam.",
      };
    }
  }

  // Consentimento: a regra vigente e a da linha MAIS RECENTE por granted_at
  // (consentimentoVigenteDeLinhas, mesma regra da RPC consentimento_vigente).
  // Tres caminhos, nesta ordem:
  //
  // 1. Vigente ativo: pulado, nao empilha linha nova.
  // 2. Ja pediu descadastro (linha whatsapp com revoked_at): tambem pulado. Os
  //    dados entram na base, mas a autorizacao NAO volta e nenhuma regua o
  //    alcanca. Regra 3.4: a revogacao vale ate a pessoa autorizar de novo, e
  //    a declaracao generica do lote nao e autorizacao de ninguem em
  //    particular. Para voltar a enviar, alguem registra na ficha como AQUELA
  //    pessoa autorizou de novo (concederConsentimentoAction, com evidencia
  //    especifica). O gatilho exigir_evidencia_de_reconsentimento so cobra
  //    texto nao vazio: seguir por ele com a string do lote passaria pelo
  //    banco e devolveria o descadastrado para o disparo.
  // 3. Sem linha nenhuma: ganha uma linha source "importacao_planilha" com a
  //    evidencia da declaracao.
  const linhasDeConsent = new Map<string, LinhaConsent[]>();
  for (const pedaco of dividirEmLotes(idsDoLote, PEDACO_DE_CONSULTA)) {
    const { data, error } = await supabase
      .from("contact_consent")
      .select("contact_id, channel, granted_at, revoked_at")
      .eq("clinic_id", clinicId)
      .in("contact_id", pedaco);
    if (error) {
      return { ok: false, error: "Não foi possível conferir as autorizações." };
    }
    for (const linha of (data ?? []) as LinhaConsentDeContato[]) {
      const doContato = linhasDeConsent.get(linha.contact_id) ?? [];
      doContato.push(linha);
      linhasDeConsent.set(linha.contact_id, doContato);
    }
  }

  const evidencia = evidenciaDaDeclaracao(payload.declaracao);
  let pulados = 0;
  let mantidosSemAutorizacao = 0;
  const consentimentosNovos: {
    clinic_id: string;
    contact_id: string;
    channel: string;
    source: string;
    evidence: string;
  }[] = [];
  for (const contactId of idsDoLote) {
    const doContato = linhasDeConsent.get(contactId) ?? [];
    if (consentimentoVigenteDeLinhas(doContato)) {
      pulados += 1;
      continue;
    }
    if (
      doContato.some(
        (linha) => linha.channel === "whatsapp" && linha.revoked_at !== null,
      )
    ) {
      mantidosSemAutorizacao += 1;
      continue;
    }
    consentimentosNovos.push({
      clinic_id: clinicId,
      contact_id: contactId,
      channel: "whatsapp",
      source: "importacao_planilha",
      evidence: evidencia,
    });
  }
  if (consentimentosNovos.length > 0) {
    const { error } = await supabase
      .from("contact_consent")
      .insert(consentimentosNovos);
    if (error) {
      return {
        ok: false,
        error: "Não foi possível registrar as autorizações.",
      };
    }
  }

  return {
    ok: true,
    importados: novas.length,
    atualizados,
    mantidos_sem_autorizacao: mantidosSemAutorizacao,
    pulados,
  };
}
