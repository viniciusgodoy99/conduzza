import { redirect } from "next/navigation";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { FILTROS_DA_URL } from "@/lib/domain/filtros-da-conversa";
import { fetchClinicAuthorNames } from "@/lib/queries/profiles";
import {
  existeConversaResolvida,
  fetchConversationById,
  fetchConversations,
} from "@/lib/queries/conversations";
import { fetchEtiquetasDeConversa } from "@/lib/queries/etiquetas-de-conversa";
import { fetchJornada } from "@/lib/queries/jornada";
import { createClient } from "@/lib/supabase/server";

import { InboxClient } from "./inbox-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Next entrega string, lista (parametro repetido) ou nada: vale o primeiro. */
const primeiro = (valor: unknown) =>
  Array.isArray(valor) ? (valor[0] as unknown) : valor;

// Links que abrem o Atendimento ja no ponto certo. Valor fora do formato e
// ignorado (a tela abre normal), nunca vira erro.
const parametrosSchema = z.object({
  // Confirmacoes, ficha do paciente e drawer do lead: abre ESTA conversa.
  conversa: z
    .preprocess(primeiro, z.string().regex(UUID))
    .optional()
    .catch(undefined),
  // Proximas acoes do Inicio: abre com o chip de situacao ja marcado.
  filtro: z
    .preprocess(primeiro, z.enum(FILTROS_DA_URL))
    .optional()
    .catch(undefined),
});

// Tela 1, Atendimento: carga inicial no servidor (sessao do usuario, RLS
// aplica) e interatividade no cliente. O mapa de nomes vem da tabela profile
// por join indexado (antes era admin.listUsers do projeto inteiro, que
// quebrava a partir de ~100 usuarios).
export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const parametros = parametrosSchema.parse(await searchParams);
  const supabase = await createClient();
  // Regra 3.1: o Inbox mostra conversa de paciente (dado de saude); registra
  // a leitura na trilha (throttle no helper), sem atrasar a tela.
  void auditarLeituraDePaciente(supabase, {
    clinicId: active.clinicId,
    userId: context.userId,
    entity: "inbox",
  });
  const [
    conversations,
    numerosAtivos,
    authorNames,
    jornada,
    etiquetas,
    conversaDoLink,
  ] = await Promise.all([
    fetchConversations(supabase, active.clinicId),
    // Se a clinica tem ao menos um numero ATIVO (docs/07): so a contagem,
    // sem trazer linha. Numero removido nao conta.
    supabase
      .from("whatsapp_account")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", active.clinicId)
      .is("removido_em", null),
    fetchClinicAuthorNames(supabase, active.clinicId),
    fetchJornada(supabase, active.clinicId),
    fetchEtiquetasDeConversa(supabase, active.clinicId),
    // Pela SESSAO: a RLS decide se a conversa do link existe para esta
    // pessoa. Resolvida ou fora das 300 ativas tambem abre.
    parametros.conversa
      ? fetchConversationById(supabase, active.clinicId, parametros.conversa)
      : Promise.resolve(null),
  ]);
  // A jornada e configuravel por clinica: os rotulos de etapa que o Inbox
  // mostra vem dela, nao mais de um dicionario fixo.
  const nomesDeEtapa = Object.fromEntries(
    jornada.map((etapa) => [etapa.chave, etapa.nome]),
  );
  // Sem conversa em andamento, a lista precisa saber se ha arquivo para
  // oferecer ("Nenhuma conversa em andamento" com atalho para as resolvidas)
  // ou se a clinica ainda nao conversou com ninguem.
  const temResolvidas =
    conversations.length > 0 ||
    (await existeConversaResolvida(supabase, active.clinicId));

  return (
    <div className="h-full overflow-hidden">
      <InboxClient
        clinicId={active.clinicId}
        viewerId={context.userId}
        viewerRole={active.role}
        timezone={active.timezone}
        agoraInicial={Date.now()}
        nomesDeEtapa={nomesDeEtapa}
        jornada={jornada}
        etiquetas={etiquetas}
        authorNames={authorNames}
        initialConversations={conversations}
        hasWhatsappAccount={(numerosAtivos.count ?? 0) > 0}
        temResolvidas={temResolvidas}
        conversaDoLink={conversaDoLink}
        linkIndisponivel={Boolean(parametros.conversa) && !conversaDoLink}
        filtroInicial={parametros.filtro ?? null}
      />
    </div>
  );
}
