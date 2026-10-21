import { Sparkles } from "lucide-react";
import { redirect } from "next/navigation";

import { PainelDoAgente } from "@/components/agente/painel-do-agente";
import { TEXTOS_DO_AGENTE } from "@/components/agente/textos";
import type { DadosDoPainel, VersaoDoAgente } from "@/components/agente/tipos";
import { versaoEmUsoNoWhatsapp } from "@/components/configuracoes/agente-de-ia";
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
// pela mesma lista da aba de Configuracoes (abaDaIaVisivel): nas outras, a
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

/**
 * A versao publicada esta mesmo em uso no WhatsApp (D39)? A mesma regra da
 * aba Agente de IA de Configuracoes (versaoEmUsoNoWhatsapp): so o estado
 * "equipe", sem nenhum motivo de parada e com tudo conferido. Qualquer
 * leitura que falha (inclusive a da liberacao, que a RLS so mostra a
 * administrador e gestor) diz que nao: a tela fica com "Última publicada",
 * nunca afirma o que nao conferiu. A lista de numeros que falha vai como
 * nula, como na aba ("Não deu para conferir agora" la, fora de uso aqui).
 */
async function emUsoNoWhatsapp(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  fuso: string,
): Promise<boolean> {
  // As duas leituras viram promessas antes do Promise.all: um erro sincrono
  // numa delas nao deixa a outra rejeitar sem ninguem ouvir.
  const lerNumeros = async () =>
    supabase
      .from("whatsapp_account")
      .select(
        "id, nome, principal, unit_id, connection_status, display_phone, connected_at, provider, cor",
      )
      .eq("clinic_id", clinicId)
      .is("removido_em", null);
  try {
    const [dados, numeros, config] = await Promise.all([
      fetchLiberacaoDaIa(supabase, clinicId),
      lerNumeros(),
      // A mesma lista da guarda da pagina (cache da requisicao).
      configDaIaDaRequisicao(),
    ]);
    const ativos: NumeroDoWhatsapp[] | null = numeros.error
      ? null
      : (numeros.data ?? []).map((numero) => ({
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
    return versaoEmUsoNoWhatsapp({
      dados,
      numeros: ativos,
      ambienteLigado: iaLiberadaNoAmbiente(config, clinicId),
      agoraMs: Date.now(),
      fuso,
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
  const [lido, versoes, extras, motivo, emUso] = await Promise.all([
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
    // "Em uso no WhatsApp" (D39): a RLS da liberacao so mostra a quem
    // configura; para a recepcao, nem se pergunta.
    podeEditar
      ? emUsoNoWhatsapp(supabase, clinicId, active.timezone)
      : Promise.resolve(false),
  ]);

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

  return cascaDoPainel(<PainelDoAgente dados={dados} abaInicial={aba} />);
}
