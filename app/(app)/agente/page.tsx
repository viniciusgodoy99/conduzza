import { Sparkles } from "lucide-react";
import { redirect } from "next/navigation";

import { PainelDoAgente } from "@/components/agente/painel-do-agente";
import { TEXTOS_DO_AGENTE } from "@/components/agente/textos";
import type { DadosDoPainel, VersaoDoAgente } from "@/components/agente/tipos";
import { versaoEmUsoNoWhatsapp } from "@/components/agente/whatsapp/agente-de-ia";
import {
  AbaWhatsapp,
  AbaWhatsappDaRecepcao,
  type DadosDaAbaWhatsapp,
} from "@/components/agente/whatsapp/agente-de-ia-tab";
import { AvisoCelular } from "@/components/shared/aviso-celular";
import {
  situacaoDaConexao,
  type NumeroDoWhatsapp,
} from "@/components/whatsapp/numeros";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { carregarExtrasDoPainel } from "@/lib/agente/painel";
import {
  motivoParaNaoSimular,
  TEXTOS_DO_SIMULADOR,
} from "@/lib/agente/simulador";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { comMudancaDasInstrucoes } from "@/lib/domain/agente/config";
import { corDoNumero } from "@/lib/domain/cor-do-numero";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import {
  fetchConfigDoAgente,
  fetchVersoesDoAgente,
} from "@/lib/queries/agente";
import { iaLiberadaNoAmbiente } from "@/lib/ia/liberacao";
import {
  abaDaIaVisivel,
  configDaIaDaRequisicao,
  fetchLiberacaoDaIa,
} from "@/lib/queries/ia-liberacao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Agente de IA (Tela 6). So existe nas clinicas com o agente habilitado
// (desde a onda 1, a lista do banco que o super admin muda pelo Painel
// geral; antes, teste123 e Conduzza Teste fixas), decidido AQUI no servidor
// pela mesma lista das acoes da aba WhatsApp (abaDaIaVisivel): nas outras, a
// tela continua o vazio honesto de antes (achado 111) e nada do agente e
// lido nem vai para o cliente. A guarda de papel mora no layout
// (profissional e leitura vao para o Inicio).
//
// Dentro da fase, a pagina le pela SESSAO (RLS) a configuracao em edicao, a
// ultima publicada, a base viva e as versoes (lib/queries/agente). So para o
// super admin, as instrucoes (pela RPC dele). Pelo cliente de servico
// (lib/agente/painel, cada parte com o proprio erro): se o rascunho muda as
// instrucoes e quais versoes as mudaram, sem o texto, para TODOS os papeis
// (a linha "Instruções da equipe Conduzza"; achados 16, 25, 28, 35 e 38), e
// a Previa do prompt so para o super admin. Para quem configura
// (administrador, gestor e super admin), o motivo de o simulador nao
// responder (ambiente, interruptor, liberacao, teto), conferido de novo pela
// acao a cada rodada. Leitura que falha vira o erro da tela (ou da parte),
// nunca um painel vazio que parece verdade.
//
// A casca do painel ocupa a altura do main (o rodape de publicacao fica no
// pe nas abas curtas) e reserva no main a altura do rodape fixo na rolagem
// do foco (scroll-padding-bottom so enquanto o painel esta na tela): o
// controle focado pelo teclado nunca fica escondido atras dele (WCAG 2.4.11,
// achado 32).
//
// Onda 2, item 8 (decisao do dono de 20/10/2026): a aba WhatsApp (o modo, os
// numeros, os telefones da equipe, a pausa e o limite de gasto) mora aqui,
// e nao mais em Configuracoes. Para administrador, gestor e super admin, a
// pagina le pela SESSAO a liberacao, os numeros ativos e os telefones
// forcados (a RLS so entrega a quem configura), monta a aba no servidor e
// decide com as MESMAS leituras o "Em uso no WhatsApp" do rodape (D39). A
// recepcao recebe so a linha de quem cuida, sem leitura nenhuma.

// O simulador roda o turno do agente dentro da Server Action desta rota
// (lib/agente/laco.ts: ate 45 s de turno, mais o filtro), e a action herda
// o limite da pagina.
export const maxDuration = 60;

async function seguro<T>(promessa: Promise<T>): Promise<T | null> {
  try {
    return await promessa;
  } catch {
    return null;
  }
}

function Vazio() {
  return (
    <Card>
      <EmptyState
        icon={Sparkles}
        title="A recepcionista de IA ainda não está ligada nesta clínica"
        description="Por enquanto a equipe responde pelo Atendimento."
        action={{
          label: "Abrir Atendimento",
          href: "/atendimento",
          variant: "outline",
        }}
      />
    </Card>
  );
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Leitura que lanca, ou volta erro, vira nulo (a parte mostra o erro dela). */
async function ouNulo<T>(tarefa: () => Promise<T>): Promise<T | null> {
  try {
    return await tarefa();
  } catch {
    return null;
  }
}

/**
 * Os numeros ATIVOS da clinica, o principal primeiro (a ordem da aba
 * WhatsApp de Configuracoes). Nulo: a leitura falhou (a aba diz que nao deu
 * para conferir a conexao, nunca "nenhum numero").
 */
async function lerNumeros(
  supabase: Supabase,
  clinicId: string,
): Promise<NumeroDoWhatsapp[] | null> {
  const { data, error } = await supabase
    .from("whatsapp_account")
    .select(
      "id, nome, principal, unit_id, connection_status, display_phone, connected_at, provider, cor",
    )
    .eq("clinic_id", clinicId)
    .is("removido_em", null)
    .order("principal", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) {
    return null;
  }
  return (
    (data ?? []) as {
      id: string;
      nome: string;
      principal: boolean;
      unit_id: string | null;
      connection_status: string | null;
      display_phone: string | null;
      connected_at: string | null;
      provider: string | null;
      cor: string | null;
    }[]
  ).map((numero) => ({
    id: numero.id,
    nome: numero.nome,
    principal: numero.principal,
    unitId: numero.unit_id,
    displayPhone: numero.display_phone,
    status: situacaoDaConexao(numero.connection_status),
    connectedAt: numero.connected_at,
    provider: numero.provider,
    cor: corDoNumero(numero.cor),
  }));
}

/**
 * Os ids dos telefones da equipe usados mesmo sendo de paciente (o forcado;
 * a coluna e legivel por quem le a lista). So para o dialogo de excluir
 * avisar que voltar pede a confirmacao de novo. Nulo: a leitura falhou.
 */
async function lerTelefonesForcados(
  supabase: Supabase,
  clinicId: string,
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("ia_contato_liberado")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("forcado", true);
  if (error) {
    return null;
  }
  return ((data ?? []) as { id: string }[]).map((linha) => linha.id);
}

/**
 * A aba WhatsApp para quem le a liberacao (administrador, gestor e super
 * admin): a liberacao (obrigatoria: sem ela, o erro da aba), os numeros e os
 * forcados (cada um com o proprio erro) e o ambiente (T1 e T2). Nunca lanca.
 */
async function lerAbaWhatsapp(
  supabase: Supabase,
  clinicId: string,
  fuso: string,
  podeEditar: boolean,
  superAdmin: boolean,
): Promise<DadosDaAbaWhatsapp> {
  const [dados, numeros, forcados, config] = await Promise.all([
    ouNulo(() => fetchLiberacaoDaIa(supabase, clinicId)),
    ouNulo(() => lerNumeros(supabase, clinicId)),
    ouNulo(() => lerTelefonesForcados(supabase, clinicId)),
    // A mesma lista da guarda da pagina (cache da requisicao).
    configDaIaDaRequisicao(),
  ]);
  return {
    dados,
    numeros,
    ambienteLigado: iaLiberadaNoAmbiente(config, clinicId),
    podeEditar,
    superAdmin,
    agoraMs: Date.now(),
    fuso,
    telefonesForcados: forcados,
  };
}

/**
 * A versao publicada esta mesmo em uso no WhatsApp (D39)? A mesma regra da
 * aba WhatsApp (versaoEmUsoNoWhatsapp), com as MESMAS leituras: so o estado
 * verde (equipe ou producao), sem nenhum motivo de parada e com tudo
 * conferido. Qualquer leitura que falha diz que nao: a tela fica com
 * "Última publicada", nunca afirma o que nao conferiu.
 */
function emUsoNoWhatsapp(aba: DadosDaAbaWhatsapp): boolean {
  if (aba.dados === null) {
    return false;
  }
  try {
    return versaoEmUsoNoWhatsapp({
      dados: aba.dados,
      numeros: aba.numeros,
      ambienteLigado: aba.ambienteLigado,
      agoraMs: aba.agoraMs,
      fuso: aba.fuso,
    });
  } catch {
    return false;
  }
}

/** Nulo: pode tentar (a acao confere de novo a cada rodada). */
async function motivoDoSimulador(clinicId: string): Promise<string | null> {
  try {
    return await motivoParaNaoSimular(createAdminClient(), clinicId);
  } catch {
    return TEXTOS_DO_SIMULADOR.naoConferiu;
  }
}

export default async function AgentePage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const cabecalho = (
    <>
      <AvisoCelular />
      <PageHeader
        eyebrow={TEXTOS_DO_AGENTE.eyebrow}
        title={TEXTOS_DO_AGENTE.titulo}
        description={TEXTOS_DO_AGENTE.descricao}
      />
    </>
  );
  const casca = (conteudo: React.ReactNode) => (
    <div className="mx-auto grid w-full max-w-content grid-cols-[minmax(0,1fr)] content-start gap-4 p-6">
      {cabecalho}
      {conteudo}
    </div>
  );
  const cascaDoPainel = (conteudo: React.ReactNode) => (
    <div className="mx-auto flex min-h-full w-full max-w-content min-w-0 flex-col gap-4 p-6 [main:has(&)]:scroll-pb-32">
      {cabecalho}
      {conteudo}
    </div>
  );

  if (!(await abaDaIaVisivel(active.clinicId))) {
    return casca(<Vazio />);
  }

  const { aba } = await searchParams;
  const clinicId = active.clinicId;
  const superAdmin = context.isProductAdmin;
  // Administrador e gestor (a matriz: "tudo") e o super admin configuram;
  // a recepcao ("ver") ve tudo desabilitado. A RLS e as acoes conferem de
  // novo (papel e escrita).
  const podeEditar = superAdmin || canEdit(active.role, "agente");

  const supabase = await createClient();
  const [lido, versoes, extras, motivo, abaWhatsapp] = await Promise.all([
    seguro(
      fetchConfigDoAgente(supabase, clinicId, { lerInstrucoes: superAdmin }),
    ),
    seguro(fetchVersoesDoAgente(supabase, clinicId)),
    // Nunca lanca: o que falhou volta null (sem a linha das instrucoes,
    // sem a previa).
    carregarExtrasDoPainel({
      clinicId,
      timezone: active.timezone,
      superAdmin,
      agoraMs: Date.now(),
    }),
    // A recepcao nao usa o simulador: nem se confere.
    podeEditar ? motivoDoSimulador(clinicId) : Promise.resolve(null),
    // A aba WhatsApp e o "Em uso no WhatsApp" (D39): a RLS da liberacao so
    // mostra a quem configura; para a recepcao, nem se pergunta. Na aba, so
    // o administrador da clinica e o super admin mudam (o gestor ve).
    podeEditar
      ? lerAbaWhatsapp(
          supabase,
          clinicId,
          active.timezone,
          superAdmin || active.role === "admin",
          superAdmin,
        )
      : Promise.resolve(null),
  ]);
  const emUso = abaWhatsapp ? emUsoNoWhatsapp(abaWhatsapp) : false;

  if (lido === null) {
    return casca(
      <Card>
        <EmptyState
          tom="erro"
          title={TEXTOS_DO_AGENTE.erroAoCarregar}
          description={TEXTOS_DO_AGENTE.erroAoCarregarDescricao}
        />
      </Card>,
    );
  }

  // As versoes que mudaram as instrucoes (o servidor compara; null = nao
  // conferido, e a linha nao aparece).
  const mudaramAsInstrucoes = (versao: number): boolean | null =>
    extras.versoesComInstrucoesMudadas === null
      ? null
      : extras.versoesComInstrucoesMudadas.includes(versao);

  const dados: DadosDoPainel = {
    clinicId,
    timezone: active.timezone,
    config: lido.config,
    temRascunho: lido.temRascunho,
    // Sem as instrucoes: a linha delas vem de instrucoesMudaram.
    publicada: lido.publicada,
    base: lido.config.base,
    versoes:
      versoes === null
        ? null
        : versoes.map((versao): VersaoDoAgente => ({
            versao: versao.versao,
            publicadaEm: versao.publicadaEm,
            autor: versao.autor,
            mudancas: comMudancaDasInstrucoes(
              versao.mudancas,
              mudaramAsInstrucoes(versao.versao),
            ),
            emUso: versao.emUso,
          })),
    instrucoesMudaram: extras.instrucoesMudaram,
    podeEditar,
    dicaSemPermissao: podeEditar
      ? null
      : (permissionHint(active.role, "agente") ??
        TEXTOS_DO_AGENTE.semPermissao),
    superAdmin,
    previaDoPrompt: superAdmin ? extras.previa : null,
    motivoDoSimulador: motivo,
    emUsoNoWhatsapp: emUso,
  };

  return cascaDoPainel(
    <PainelDoAgente
      dados={dados}
      abaInicial={aba}
      abaWhatsapp={
        abaWhatsapp ? (
          <AbaWhatsapp {...abaWhatsapp} />
        ) : (
          <AbaWhatsappDaRecepcao />
        )
      }
    />,
  );
}
