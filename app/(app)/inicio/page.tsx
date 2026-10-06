import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChartColumn, TrendingUp } from "lucide-react";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";

import {
  Checklist,
  type PassoDoChecklist,
} from "@/components/inicio/checklist";
import { CartaoProximasAcoes, Painel } from "@/components/inicio/painel";
import {
  primeiroNome,
  resumoDoDia,
  saudacaoDoMomento,
  type TrechoDoResumo,
} from "@/components/inicio/saudacao";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { diaCivil, minutosLocais, somarDias } from "@/lib/domain/horarios";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { log } from "@/lib/log";
import {
  fetchFunilDaJornada,
  fetchResumoDoDia,
  type Leitura,
} from "@/lib/queries/inicio";
import {
  fetchAgendaDoPeriodo,
  fetchProximasAcoes,
  type ProximasAcoes,
} from "@/lib/queries/relatorios";
import { createClient } from "@/lib/supabase/server";

import { VisaoDoProfissional } from "../relatorios/visao-do-profissional";

// Inicio (Tela 5, tarefa 5.1): o resumo do dia da clinica. O checklist de
// primeiros passos continua aparecendo ACIMA do painel enquanto houver
// pendencia (ele era a tela inteira antes do painel existir) e some quando
// tudo esta pronto. Desde a Fase 3 (02/10) o painel mostra o DIA: os
// cartoes e as barras de 7 dias vem de resumo_do_dia e o funil de
// funil_da_jornada (lib/queries/inicio.ts); o periodo de 30 dias e o resto
// dos agregados moram em Resultados. So agregados, nenhum nome de paciente,
// entao nao ha leitura a auditar (regra 3.1).
//
// Cabecalho (decisao do dono C26, docs/06 secao 5.2): a data no fuso da
// clinica como eyebrow, a saudacao pelo horario local da clinica com o
// primeiro nome (sem nome, "Início") e uma frase montada SO com as contagens
// de Proximas acoes, que ja foram buscadas.

const CONTEINER =
  "mx-auto grid w-full max-w-content grid-cols-[minmax(0,1fr)] content-start gap-4 p-4 md:p-6";

function Resumo({ trechos }: { trechos: TrechoDoResumo[] }) {
  return trechos.map((trecho, indice) =>
    trecho.tipo === "numero" ? (
      <span key={indice} className="cz-num">
        {trecho.valor}
      </span>
    ) : (
      <span key={indice}>{trecho.valor}</span>
    ),
  );
}

function cabecalhoDoDia({
  timezone,
  agora,
  nomeDaSessao,
  emailDaSessao,
  proximasAcoes,
}: {
  timezone: string;
  /** O mesmo instante dos numeros do dia, para data e cartoes baterem. */
  agora: Date;
  nomeDaSessao: string;
  emailDaSessao: string;
  proximasAcoes: ProximasAcoes;
}) {
  // Regra 3.6: data e hora sempre no fuso da clinica, nunca no do servidor.
  const nome = primeiroNome(nomeDaSessao, emailDaSessao);
  return {
    eyebrow: format(new TZDate(agora, timezone), "EEEE, d 'de' MMMM", {
      locale: ptBR,
    }),
    titulo: nome
      ? `${saudacaoDoMomento(minutosLocais(timezone, agora))}, ${nome}`
      : "Início",
    descricao: (
      <Resumo
        trechos={resumoDoDia({
          confirmacoesAmanha: proximasAcoes.confirmacoesPendentesAmanha,
          aguardandoVoce: proximasAcoes.aguardandoHumano,
        })}
      />
    ),
  };
}

/**
 * Le um bloco do painel sem derrubar a tela: a falha vira o estado de erro
 * daquele bloco (nunca zero) e um registro no log do servidor, so com o id
 * da clinica e o nome do bloco (nenhum dado de paciente, regra 3.1).
 */
async function lerBloco<T>(
  bloco: string,
  clinicId: string,
  leitura: Promise<T>,
): Promise<Leitura<T>> {
  try {
    return { ok: true, dados: await leitura };
  } catch (erro) {
    // Sinal interno do Next (renderizacao dinamica, redirect) nao e falha
    // do bloco: tem de seguir adiante.
    unstable_rethrow(erro);
    log.error("inicio_bloco_falhou", { clinic_id: clinicId, kind: bloco });
    return { ok: false };
  }
}

export default async function InicioPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/login");
  }

  const supabase = await createClient();
  // O instante da requisicao; todo dia civil sai dele no fuso da clinica.
  const agora = new Date();

  // Matriz de papeis: profissional ve "so os proprios". O painel dele sao os
  // proprios atendimentos + as pendencias que a RLS ja recorta para ele.
  if (active.role === "profissional") {
    const { data: membro, error: erroDeVinculo } = await supabase
      .from("clinic_member")
      .select("professional_id")
      .eq("clinic_id", active.clinicId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (erroDeVinculo) {
      // Leitura que DECIDE a visao: erro vira erro, nunca o estado falso
      // "seu perfil nao esta ligado a agenda" (achado da revisao de 18/09).
      throw new Error(erroDeVinculo.message);
    }
    const professionalId = (membro?.professional_id ?? null) as string | null;
    // A visao do profissional continua nos ultimos 30 dias civis.
    const diaAte = diaCivil(active.timezone, agora);
    const diaDe = somarDias(diaAte, -29);

    const [proximasAcoes, agendaPropria] = await Promise.all([
      fetchProximasAcoes(supabase, active.clinicId, active.timezone),
      professionalId
        ? fetchAgendaDoPeriodo(
            supabase,
            active.clinicId,
            active.timezone,
            diaDe,
            diaAte,
            { professionalId },
          )
        : Promise.resolve(null),
    ]);

    const cabecalho = cabecalhoDoDia({
      timezone: active.timezone,
      agora,
      nomeDaSessao: context.userName,
      emailDaSessao: context.userEmail,
      proximasAcoes,
    });

    return (
      <div className={CONTEINER}>
        <PageHeader
          eyebrow={cabecalho.eyebrow}
          title={cabecalho.titulo}
          description={cabecalho.descricao}
        />
        <CartaoProximasAcoes
          proximasAcoes={proximasAcoes}
          rotulo="Suas próximas ações"
        />
        {agendaPropria ? (
          <VisaoDoProfissional agenda={agendaPropria} />
        ) : (
          <Card>
            <EmptyState
              icon={TrendingUp}
              title="Seu usuário ainda não está ligado a um profissional da agenda"
              description="Peça para a administração vincular, e os seus resultados aparecem aqui."
            />
          </Card>
        )}
      </div>
    );
  }

  // Conexao do WhatsApp e equipe sao acoes de quem edita Configuracoes
  // (administrador e gestor), nao so do administrador.
  const podeConfigurar = canEdit(active.role, "configuracoes");

  const [numeros, conversas, equipe, pedidos, resumo, funil, proximasAcoes] =
    await Promise.all([
      // Os numeros ATIVOS da clinica (docs/07): o passo fica feito com pelo
      // menos um conectado. So o status, nenhum dado de paciente.
      supabase
        .from("whatsapp_account")
        .select("connection_status")
        .eq("clinic_id", active.clinicId)
        .is("removido_em", null),
      supabase
        .from("conversation")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", active.clinicId),
      supabase
        .from("clinic_member")
        .select("user_id", { count: "exact", head: true })
        .eq("clinic_id", active.clinicId)
        .eq("status", "ativo"),
      // Pedidos de entrada pelo codigo aguardando liberacao (achados 108 e
      // 125): so quem libera recebe o numero. So a contagem, nenhum nome.
      podeConfigurar
        ? supabase
            .from("clinic_member")
            .select("user_id", { count: "exact", head: true })
            .eq("clinic_id", active.clinicId)
            .eq("status", "pendente")
        : Promise.resolve(null),
      // Os dois blocos de numeros nao derrubam a tela (lerBloco); Proximas
      // acoes continua derrubando, porque monta a frase do cabecalho.
      lerBloco(
        "resumo_do_dia",
        active.clinicId,
        fetchResumoDoDia(supabase, active.clinicId, active.timezone, agora),
      ),
      lerBloco(
        "funil_da_jornada",
        active.clinicId,
        fetchFunilDaJornada(supabase, active.clinicId),
      ),
      fetchProximasAcoes(supabase, active.clinicId, active.timezone),
    ]);

  // Leitura que decide o checklist: erro vira a tela de erro, nunca um
  // passo "Pendente" falso nem um pedido de acesso escondido.
  for (const resposta of [numeros, conversas, equipe, pedidos]) {
    if (resposta?.error) {
      throw new Error(resposta.error.message);
    }
  }

  const statusDosNumeros = (
    (numeros.data ?? []) as { connection_status: string }[]
  ).map((numero) => numero.connection_status);
  const numerosConectados = statusDosNumeros.filter(
    (status) => status === "conectado",
  ).length;
  const conectado = numerosConectados > 0;
  const totalConversas = conversas.count ?? 0;
  const totalEquipe = equipe.count ?? 0;
  const pedidosDeAcesso = pedidos?.count ?? 0;
  const bloqueio = permissionHint(active.role, "configuracoes");

  const passos: PassoDoChecklist[] = [
    {
      chave: "whatsapp",
      concluido: conectado,
      titulo: "Conectar o WhatsApp da clínica",
      // Com um numero, o texto de sempre. Com varios, quantos estao
      // conectados: a faixa do topo ja nomeia o que caiu.
      descricao: !conectado ? (
        "Sem isso, nenhuma mensagem de paciente chega até aqui."
      ) : statusDosNumeros.length <= 1 ? (
        "O número está conectado e recebendo mensagens."
      ) : (
        <>
          <span className="cz-num">{numerosConectados}</span> de{" "}
          <span className="cz-num">{statusDosNumeros.length}</span> números
          conectados e recebendo mensagens.
        </>
      ),
      acao: conectado
        ? undefined
        : {
            rotulo: "Conectar agora",
            href: "/configuracoes?aba=whatsapp",
            bloqueio,
          },
    },
    {
      chave: "equipe",
      concluido: totalEquipe > 1,
      titulo: "Chamar a equipe",
      descricao:
        totalEquipe > 1 ? (
          <>
            <span className="cz-num">{totalEquipe}</span> pessoas com acesso à
            clínica.
          </>
        ) : pedidosDeAcesso > 0 ? (
          <>
            <span className="cz-num">{pedidosDeAcesso}</span>{" "}
            {pedidosDeAcesso === 1 ? "pessoa aguardando" : "pessoas aguardando"}{" "}
            liberação de acesso.
          </>
        ) : (
          "Convide a recepção por e-mail ou passe o código da clínica."
        ),
      acao: {
        rotulo: "Gerenciar equipe",
        href: "/configuracoes?aba=equipe",
        bloqueio,
      },
      // Clinica de uma pessoa so (achado 112): o passo pode ser dispensado,
      // menos com alguem pedindo entrada, que ai a equipe existe.
      dispensavel: pedidosDeAcesso === 0,
    },
    {
      chave: "atendimento",
      concluido: totalConversas > 0,
      titulo: "Receber o primeiro atendimento",
      descricao:
        totalConversas > 0 ? (
          <>
            <span className="cz-num">{totalConversas}</span> conversa
            {totalConversas > 1 ? "s" : ""} no atendimento.
          </>
        ) : (
          "Quando um paciente escrever, a conversa aparece no Atendimento na hora."
        ),
      acao: { rotulo: "Abrir Atendimento", href: "/atendimento" },
    },
  ];

  const tudoPronto = passos.every((passo) => passo.concluido);
  const cabecalho = cabecalhoDoDia({
    timezone: active.timezone,
    agora,
    nomeDaSessao: context.userName,
    emailDaSessao: context.userEmail,
    proximasAcoes,
  });

  return (
    <div className={CONTEINER}>
      <PageHeader
        eyebrow={cabecalho.eyebrow}
        title={cabecalho.titulo}
        description={cabecalho.descricao}
      >
        <Button asChild variant="outline">
          <Link href="/relatorios">
            <ChartColumn aria-hidden />
            Ver em Resultados
          </Link>
        </Button>
      </PageHeader>
      {tudoPronto ? null : (
        <Checklist passos={passos} clinicId={active.clinicId} />
      )}
      <Painel
        timezone={active.timezone}
        resumo={resumo}
        funil={funil}
        proximasAcoes={proximasAcoes}
        pedidosDeAcesso={pedidosDeAcesso}
      />
    </div>
  );
}
