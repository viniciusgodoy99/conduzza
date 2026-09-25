import { redirect } from "next/navigation";

import {
  ACAO_DE_CONVITE,
  nomeNaEquipe,
  temNomeProprio,
  ultimoConvitePorPessoa,
} from "@/components/configuracoes/convite-na-equipe";
import type {
  MembroEquipe,
  ProfissionalDaAgenda,
} from "@/components/configuracoes/lista-equipe";
import { AvisoCelular } from "@/components/shared/aviso-celular";
import { PageHeader } from "@/components/shared/page-header";
import {
  situacaoDaConexao,
  type NumeroDoWhatsapp,
  type UnidadeDaClinica,
} from "@/components/whatsapp/numeros";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/permissions";
import { provedorDoAmbiente } from "@/lib/integrations/whatsapp/provider";
import { motivosDaRecusaVigentes } from "@/lib/integrations/whatsapp/trava-celular";
import { fetchProfileNames } from "@/lib/queries/profiles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { ConfiguracoesClient } from "./configuracoes-client";
import {
  fetchContagemDeEtiquetas,
  fetchEtiquetasDeConversa,
} from "@/lib/queries/etiquetas-de-conversa";
import { fetchJornada } from "@/lib/queries/jornada";
import type { Pendente } from "./equipe-client";

/**
 * Leitura que lanca (as de lib/queries) vira nulo: a falha de uma aba mostra
 * o erro naquela aba, em vez de derrubar a tela de Configuracoes inteira.
 */
async function seguro<T>(promessa: Promise<T>): Promise<T | null> {
  try {
    return await promessa;
  } catch {
    return null;
  }
}

/**
 * Dos candidatos (membros cujo perfil mostra um nome escolhido), quem foi
 * CONVIDADO por e-mail e ainda nao fez nada nesta clinica depois do convite
 * mais recente: nenhuma linha propria na trilha (toda leitura de dado de
 * paciente grava uma). A trilha e legivel por administrador e gestor, os
 * unicos que chegam a esta tela. Leitura que falha esconde todos os
 * candidatos: na duvida, o nome fica guardado.
 */
async function convidadosQueAindaNaoEntraram(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  candidatos: string[],
): Promise<Set<string>> {
  if (candidatos.length === 0) {
    return new Set();
  }
  const { data: convites, error } = await supabase
    .from("audit_log")
    .select("entity_id, created_at")
    .eq("clinic_id", clinicId)
    .eq("action", ACAO_DE_CONVITE)
    .eq("entity", "clinic_member")
    .in("entity_id", candidatos);
  if (error) {
    return new Set(candidatos);
  }
  const ultimoConvite = ultimoConvitePorPessoa(
    (convites ?? []) as { entity_id: string | null; created_at: string }[],
  );
  const semEntrada = await Promise.all(
    [...ultimoConvite].map(async ([userId, desde]) => {
      const { data, error: erroDaTrilha } = await supabase
        .from("audit_log")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("user_id", userId)
        .gt("created_at", desde)
        .limit(1);
      return erroDaTrilha || (data ?? []).length === 0 ? userId : null;
    }),
  );
  return new Set(semEntrada.filter((id): id is string => id !== null));
}

// Tela 12, Configuracoes: equipe e permissoes (liberacao de pedidos, papeis,
// vinculo do profissional com a agenda, convite, codigo da clinica e a tabela
// do que cada papel faz), dados da clinica (nome e fuso), os numeros de
// WhatsApp (um cartao por numero; docs/07, Telas), jornada, etiquetas e
// anuncios da Meta. Administrador e gestor editam (nome e fuso so o
// administrador); os demais papeis nem chegam aqui (o layout redireciona pela
// matriz do brief).
export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  const [
    memberResult,
    profissionaisResult,
    clinicResult,
    codigoResult,
    whatsappResult,
    jornada,
    etiquetas,
    contagemDeEtiquetas,
    contaMetaResult,
    unidadesResult,
    politicaDoEnvioResult,
    limiteDeNumerosResult,
  ] = await Promise.all([
    supabase
      .from("clinic_member")
      .select("user_id, role, status, professional_id, created_at")
      .eq("clinic_id", active.clinicId)
      .order("created_at", { ascending: true }),
    // Cadastros de profissional que um usuario de papel Profissional pode
    // ser (seletor "Profissional da agenda").
    supabase
      .from("professional")
      .select("id, name, active")
      .eq("clinic_id", active.clinicId)
      .order("name", { ascending: true }),
    supabase
      .from("clinic")
      .select("name, timezone, allow_code_signup")
      .eq("id", active.clinicId)
      .maybeSingle(),
    // O codigo mora em tabela propria, legivel por administrador e gestor.
    supabase
      .from("clinic_access_code")
      .select("code")
      .eq("clinic_id", active.clinicId)
      .maybeSingle(),
    // Os numeros ATIVOS da clinica, um cartao por numero (docs/07, Telas),
    // o principal primeiro.
    supabase
      .from("whatsapp_account")
      .select(
        "id, nome, principal, unit_id, connection_status, display_phone, connected_at, provider",
      )
      .eq("clinic_id", active.clinicId)
      .is("removido_em", null)
      .order("principal", { ascending: false })
      .order("created_at", { ascending: true }),
    // A jornada da clinica (etapas + conversao): a RLS recorta por clinica.
    seguro(fetchJornada(supabase, active.clinicId)),
    seguro(fetchEtiquetasDeConversa(supabase, active.clinicId)),
    seguro(fetchContagemDeEtiquetas(supabase, active.clinicId)),
    // Conta de anuncios da Meta: a policy so mostra para admin e gestor.
    supabase
      .from("meta_ads_account")
      .select(
        "pixel_id, ad_account_id, whatsapp_business_account_id, test_event_code, envio_ativado, modo_user_data, send_unmatched",
      )
      .eq("clinic_id", active.clinicId)
      .maybeSingle(),
    // Aba de WhatsApp: unidades para o numero, a politica das mensagens
    // automaticas (etiqueta do numero fixo) e o limite do plano. Leituras
    // separadas, para a falha de uma nao derrubar a aba.
    supabase
      .from("unit")
      .select("id, name, active")
      .eq("clinic_id", active.clinicId)
      .order("name", { ascending: true }),
    supabase
      .from("whatsapp_envio_automatico")
      .select("modo, conta_fixa_id")
      .eq("clinic_id", active.clinicId)
      .maybeSingle(),
    supabase
      .from("clinic")
      .select("limite_de_numeros")
      .eq("id", active.clinicId)
      .maybeSingle(),
  ]);

  type MemberRow = {
    user_id: string;
    role: Role;
    status: "ativo" | "pendente" | "inativo";
    professional_id: string | null;
  };
  const rows = (memberResult.data ?? []) as MemberRow[];

  // Nome vem da tabela profile (uma consulta indexada). E-mail so existe no
  // GoTrue: a RPC emails_da_equipe (restrita ao service role) devolve os da
  // clinica numa consulta so, no lugar de uma chamada HTTP a API admin POR
  // membro (equipe de 15 pessoas eram 15 requests antes de renderizar).
  const admin = createAdminClient();
  const memberIds = rows.map((row) => row.user_id);
  // Por que o numero caiu, quando a trava recusou o celular (achado M[0] da
  // revisao das Fases 3 e 4): antes so o dialogo dizia, e recarregar a
  // pagina deixava so "Desconectado". O texto e do publico do dialogo de
  // conexao (administrador e gestor), lido por service role com a clinica
  // DA SESSAO, e so para os numeros desta clinica que estao desconectados.
  const desconectadosParaOMotivo = canEdit(active.role, "configuracoes")
    ? (whatsappResult.data ?? [])
        .filter(
          (numero) =>
            situacaoDaConexao(numero.connection_status) === "desconectado",
        )
        .map((numero) => numero.id)
    : [];
  const [nameById, emailsResult, tokenMetaResult, motivos] = await Promise.all([
    fetchProfileNames(supabase, memberIds),
    admin.rpc("emails_da_equipe", { p_clinic_id: active.clinicId }),
    // A tabela-secret nao tem policy: SO o booleano "existe token" sai daqui,
    // nunca o valor.
    admin
      .from("meta_ads_account_secret")
      .select("clinic_id")
      .eq("clinic_id", active.clinicId)
      .not("capi_access_token", "is", null)
      .maybeSingle(),
    motivosDaRecusaVigentes(admin, active.clinicId, desconectadosParaOMotivo),
  ]);
  const emailById = new Map(
    ((emailsResult.data ?? []) as { user_id: string; email: string }[]).map(
      (linha) => [linha.user_id, linha.email] as const,
    ),
  );
  // Achados L17/L20: convidar o e-mail de quem ja tem conta cria o vinculo
  // na hora, e a policy de profile libera o nome a colegas de clinica. Ate a
  // pessoa usar esta clinica, a lista mostra o nome que uma conta nova teria,
  // para a equipe nao descobrir por aqui que o e-mail tinha cadastro nem o
  // nome que a pessoa usa. Pendente (pedido pelo codigo) fica de fora: o nome
  // ali foi a propria pessoa que mandou.
  const nomesEscondidos = await convidadosQueAindaNaoEntraram(
    supabase,
    active.clinicId,
    rows
      .filter(
        (row) =>
          row.status !== "pendente" &&
          row.user_id !== context.userId &&
          temNomeProprio(nameById[row.user_id], emailById.get(row.user_id)),
      )
      .map((row) => row.user_id),
  );
  const userById = new Map(
    memberIds.map((id) => [
      id,
      {
        name: nomeNaEquipe({
          nome: nameById[id],
          email: emailById.get(id),
          esconder: nomesEscondidos.has(id),
        }),
        email: emailById.get(id) ?? "",
      },
    ]),
  );

  // Quem esta na equipe (com acesso ou sem) entra numa lista so; quem perdeu
  // o acesso vai para o fim, com fundo afundado e o chip "Sem acesso". O sort
  // e estavel, entao dentro de cada grupo a ordem de entrada na clinica se
  // mantem.
  const membros: MembroEquipe[] = rows
    .filter((row) => row.status !== "pendente")
    .map((row) => ({
      userId: row.user_id,
      nome: userById.get(row.user_id)?.name ?? "Usuário",
      email: userById.get(row.user_id)?.email ?? "",
      papel: row.role,
      ativo: row.status === "ativo",
      professionalId: row.professional_id ?? null,
    }))
    .sort((a, b) => Number(b.ativo) - Number(a.ativo));

  const pendentes: Pendente[] = rows
    .filter((row) => row.status === "pendente")
    .map((row) => ({
      userId: row.user_id,
      nome: userById.get(row.user_id)?.name ?? "Usuário",
      email: userById.get(row.user_id)?.email ?? "",
    }));

  // Nulo = a leitura falhou (a tela diz isso, em vez de "nenhum cadastrado").
  const profissionais: ProfissionalDaAgenda[] | null = profissionaisResult.error
    ? null
    : (
        (profissionaisResult.data ?? []) as {
          id: string;
          name: string;
          active: boolean;
        }[]
      ).map((profissional) => ({
        id: profissional.id,
        nome: profissional.name,
        ativo: profissional.active,
      }));

  const podeGerenciar = canEdit(active.role, "configuracoes");
  const ehAdmin = active.role === "admin";
  const dica = permissionHint(active.role, "configuracoes");

  // Aba de WhatsApp: um cartao por numero ativo. Leitura dos numeros que
  // falhou vira o erro da aba (nunca uma lista vazia, que diria "nenhum
  // numero"); as leituras de apoio que falham so tiram o que dependia delas.
  const numerosDoWhatsapp: NumeroDoWhatsapp[] = (whatsappResult.data ?? []).map(
    (numero) => ({
      id: numero.id,
      nome: numero.nome,
      principal: numero.principal,
      unitId: numero.unit_id,
      displayPhone: numero.display_phone,
      status: situacaoDaConexao(numero.connection_status),
      connectedAt: numero.connected_at,
      provider: numero.provider,
      motivoDaDesconexao: motivos[numero.id] ?? null,
    }),
  );
  const unidadesDaClinica: UnidadeDaClinica[] | null = unidadesResult.error
    ? null
    : (unidadesResult.data ?? []).map((unidade) => ({
        id: unidade.id,
        nome: unidade.name,
        ativa: unidade.active,
      }));
  const politicaDoEnvio = politicaDoEnvioResult.data;
  const contaFixaId =
    politicaDoEnvio?.modo === "fixo" ? politicaDoEnvio.conta_fixa_id : null;

  const clinica = clinicResult.data as {
    name: string;
    timezone: string;
    allow_code_signup: boolean;
  } | null;

  const { aba } = await searchParams;

  return (
    <div className="mx-auto grid w-full max-w-content content-start gap-4 p-6">
      <PageHeader
        eyebrow="Administração"
        title="Configurações"
        description={`Equipe, dados da clínica, WhatsApp e o que a equipe usa todo dia em ${active.clinicName}.`}
      />
      <AvisoCelular />
      <ConfiguracoesClient
        abaInicial={aba}
        equipe={
          memberResult.error ? null : { membros, pendentes, profissionais }
        }
        meuUserId={context.userId}
        podeGerenciar={podeGerenciar}
        ehAdmin={ehAdmin}
        dica={dica ?? "Seu perfil não altera as configurações"}
        clinica={
          clinicResult.error || !clinica
            ? null
            : { nome: clinica.name, timezone: clinica.timezone }
        }
        codigo={codigoResult.error ? null : (codigoResult.data?.code ?? null)}
        codigoAtivo={clinica?.allow_code_signup ?? false}
        whatsapp={
          whatsappResult.error
            ? null
            : {
                numeros: numerosDoWhatsapp,
                unidades: unidadesDaClinica,
                contaFixaId,
                limite: limiteDeNumerosResult.data?.limite_de_numeros ?? null,
                // O provedor com que um numero NOVO nasce, pela mesma regra
                // que cria a conta (achado 30): fora de producao, sem
                // configuracao, e o fake; em producao sem provedor real vem
                // nulo e a aba avisa que o canal nao esta configurado.
                providerDoAmbiente: provedorDoAmbiente(),
                timezone: active.timezone,
              }
        }
        jornada={jornada}
        etiquetas={
          etiquetas && contagemDeEtiquetas
            ? { lista: etiquetas, contagem: contagemDeEtiquetas }
            : null
        }
        meta={
          contaMetaResult.error || tokenMetaResult.error
            ? null
            : {
                conta: contaMetaResult.data ?? null,
                temToken: tokenMetaResult.data !== null,
              }
        }
      />
    </div>
  );
}
