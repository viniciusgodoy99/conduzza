import { DoorClosed, Hourglass, OctagonAlert } from "lucide-react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { QueryProvider } from "@/components/providers/query-provider";
import { AppShell } from "@/components/shell/app-shell";
import { BotaoRecarregar } from "@/components/shell/botao-recarregar";
import {
  contarConfirmacoesDeAmanha,
  contarConversasAguardando,
} from "@/components/shell/contadores-do-menu";
import { CriarClinica } from "@/components/shell/criar-clinica";
import { EstadoDeTela, TelaSemShell } from "@/components/shell/estado-de-tela";
import { MotorStatus } from "@/components/shell/motor-status";
import { SairDaConta } from "@/components/shell/sair-da-conta";
import { WhatsappStatus } from "@/components/shell/whatsapp-status";
import { ROLE_LABELS, getSessionContext } from "@/lib/auth/active-clinic";
import {
  COLUNAS_DA_FAIXA,
  numerosParaContar,
  type NumeroDaFaixa,
} from "@/lib/domain/conexao-dos-numeros";
import type { SaudeDoMotor } from "@/lib/domain/motor";
import { COOKIE_DO_RAIL, preferenciaDoRail } from "@/lib/navigation";
import { contarMensagensEsperando } from "@/lib/queries/mensagens-esperando";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Layout da area logada: exige sessao e clinica ativa validada em
// clinic_member (tarefa 0.5). O isolamento de dados e da RLS; aqui so se
// decide o que renderizar e para onde mandar quem nao pode ver.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }

  const pendentes = context.memberships.filter(
    (membership) => membership.status === "pendente",
  );

  const ativos = context.memberships.filter(
    (membership) => membership.status === "ativo",
  );

  if (!context.active) {
    // Leitura do vinculo que FALHOU nao e "sem clinica": e erro, com saida.
    // Vem antes de tudo porque, com a falha, memberships chega vazio e os
    // ramos abaixo afirmariam algo falso (achado 115 da revisao).
    if (context.vinculoIndisponivel) {
      return (
        <TelaSemShell>
          <EstadoDeTela
            emCartao
            icone={OctagonAlert}
            tom="alerta"
            titulo="Seu acesso não carregou"
            descricao={
              <p>
                Houve uma falha ao consultar as clínicas desta conta. Nada foi
                alterado: tente de novo em instantes.
              </p>
            }
          >
            <BotaoRecarregar rotulo="Tentar de novo" />
            <SairDaConta
              email={context.userEmail}
              className="mt-2 w-full border-t border-border pt-4"
            />
          </EstadoDeTela>
        </TelaSemShell>
      );
    }

    // Dono do produto sem clinica ativa: precisa poder CRIAR uma, senao entra
    // no sistema e nao consegue fazer nada. A tela completa de administracao
    // e a Tela 14 (tarefa 5.5).
    if (context.isProductAdmin && ativos.length === 0) {
      return (
        <TelaSemShell>
          <CriarClinica primeira email={context.userEmail} />
        </TelaSemShell>
      );
    }

    // Tem clinica ativa (mais de uma) e talvez um pedido pendente em outra:
    // a escolha entre as ativas vem ANTES da tela de espera, senao a pessoa
    // perde o acesso as clinicas onde ja trabalha.
    if (ativos.length > 1) {
      redirect("/selecionar-clinica");
    }

    // Entrou por codigo e aguarda aprovacao: entra no sistema, mas sem
    // enxergar dado de paciente. Nada de sessao orfa nem laco de logout: o
    // Sair fica na propria tela (o /login devolveria a pessoa para ca).
    if (pendentes.length > 0) {
      const clinica = pendentes[0]?.clinicName ?? "sua clínica";
      return (
        <TelaSemShell>
          <EstadoDeTela
            emCartao
            icone={Hourglass}
            tom="aviso"
            titulo="Aguardando liberação de acesso"
            descricao={
              <>
                <p>
                  Seu pedido de entrada em{" "}
                  <strong className="font-semibold text-foreground">
                    {clinica}
                  </strong>{" "}
                  foi registrado. Um administrador precisa liberar seu acesso, e
                  é por isso que você ainda não vê as conversas dos pacientes.
                </p>
                <p>
                  Quando o administrador liberar seu acesso, atualize a página.
                </p>
              </>
            }
          >
            <BotaoRecarregar rotulo="Atualizar" />
            <SairDaConta
              email={context.userEmail}
              className="mt-2 w-full border-t border-border pt-4"
            />
          </EstadoDeTela>
        </TelaSemShell>
      );
    }

    // Sem vinculo ativo nem pendente: nunca entrou, teve o pedido recusado
    // ou teve o acesso retirado. O texto serve aos tres casos.
    return (
      <TelaSemShell>
        <EstadoDeTela
          emCartao
          icone={DoorClosed}
          titulo="Sem clínica vinculada"
          descricao={
            <p>
              Esta conta não tem acesso a nenhuma clínica agora. Se você
              trabalhava em uma clínica, o acesso pode ter sido retirado. Fale
              com o administrador dela ou saia para entrar com outra conta.
            </p>
          }
        >
          <SairDaConta
            email={context.userEmail}
            className="mt-2 w-full border-t border-border pt-4"
          />
        </EstadoDeTela>
      </TelaSemShell>
    );
  }

  const active = context.active;

  // TUDO que o shell precisa do banco, numa rodada so. Em serie eram quatro
  // idas ao Postgres remoto em CADA renderizacao de pagina, e isso aparece:
  // a suite de navegador ficou minutos mais lenta e os testes de tempo real
  // comecaram a estourar o limite de 2 segundos. O shell e o caminho mais
  // quente do sistema; latencia aqui e paga por toda tela.
  const supabase = await createClient();
  const cookieStore = await cookies();

  const [
    { data: numerosDoWhatsapp },
    { data: saude },
    aguardandoHumano,
    confirmacoesPendentes,
  ] = await Promise.all([
    // Faixa de WhatsApp desconectado (estado 5 da secao 8 do brief): a LISTA
    // de numeros ativos da clinica (docs/07, Fase 2). Quem decide se a faixa
    // aparece, e com que texto, e o WhatsappStatus (decisao D6). Erro de
    // leitura vira lista vazia, como antes (nenhuma faixa, nunca tela
    // quebrada): o polling do componente corrige em seguida.
    supabase
      .from("whatsapp_account")
      .select(COLUNAS_DA_FAIXA)
      .eq("clinic_id", active.clinicId)
      .is("removido_em", null)
      .order("principal", { ascending: false })
      .order("created_at", { ascending: true }),
    // Prova de vida do motor: os DOIS papeis (fila e planner) mais a
    // contagem de tarefas atrasadas, numa chamada so. Ler worker_heartbeat
    // cru pegaria "a batida mais recente de qualquer executor", e o planner
    // vivo esconderia a fila morta.
    supabase.rpc("saude_do_motor"),
    // Contadores do menu (Atendimento e Confirmacoes): o primeiro numero sai
    // daqui e o vigia do AppShell o mantem vivo com as MESMAS consultas
    // (components/shell/contadores-do-menu.ts, onde o criterio esta
    // explicado).
    contarConversasAguardando(supabase, active.clinicId),
    contarConfirmacoesDeAmanha(
      supabase,
      active.clinicId,
      active.timezone,
      new Date(),
    ),
  ]);

  // A decisao motor x WhatsApp (e a precedencia entre as duas faixas) vive no
  // MotorStatus, no cliente: este layout e preservado em navegacao suave,
  // entao a versao do servidor so mudaria em carga dura ou revalidate, e um
  // motor que morre com a aba aberta ficava invisivel ate alguem dar F5. A
  // batida buscada aqui garante o primeiro paint certo; o polling do
  // componente mantem a faixa honesta depois.
  const saudeInicial = (saude ?? null) as SaudeDoMotor | null;

  // Com mais de um numero e algum fora do ar (docs/07, Fase 4), a faixa diz
  // quantas mensagens automaticas esperam por ele. A contagem da primeira
  // pintura sai daqui, e SO nesse caso: a clinica conectada (o normal) nao
  // paga ida nenhuma a mais. A fila so e legivel pelo administrador na RLS,
  // por isso o service role, preso a clinica ativa. Falha vira faixa sem a
  // contagem, nunca tela quebrada; o componente pede de novo.
  const numerosDaFaixa = (numerosDoWhatsapp ?? []) as NumeroDaFaixa[];
  const paraContar = numerosParaContar(numerosDaFaixa);
  const esperandoIniciais =
    paraContar.length > 0
      ? await Promise.resolve()
          .then(() =>
            contarMensagensEsperando(
              createAdminClient(),
              active.clinicId,
              paraContar,
            ),
          )
          .catch(() => undefined)
      : undefined;

  const banner = (
    <MotorStatus
      saudeInicial={saudeInicial}
      timezone={active.timezone}
      fallback={
        <WhatsappStatus
          clinicId={active.clinicId}
          numerosIniciais={numerosDaFaixa}
          esperandoIniciais={esperandoIniciais}
        />
      }
    />
  );

  return (
    <AppShell
      viewer={{
        name: context.userName,
        role: active.role,
        roleLabel: ROLE_LABELS[active.role],
        clinicName: active.clinicName,
        productName: active.productName,
      }}
      clinicId={active.clinicId}
      timezone={active.timezone}
      canSwitchClinic={
        context.memberships.filter((m) => m.status === "ativo").length > 1
      }
      labels={active.labels}
      banner={banner}
      preferenciaDoRail={preferenciaDoRail(
        cookieStore.get(COOKIE_DO_RAIL)?.value,
      )}
      counts={{
        conversas: aguardandoHumano ?? 0,
        confirmacoes: confirmacoesPendentes ?? 0,
      }}
    >
      <QueryProvider>{children}</QueryProvider>
    </AppShell>
  );
}
