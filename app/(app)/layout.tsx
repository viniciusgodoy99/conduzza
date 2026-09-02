import { Hourglass } from "lucide-react";
import { redirect } from "next/navigation";

import { QueryProvider } from "@/components/providers/query-provider";
import { AppShell } from "@/components/shell/app-shell";
import { CriarClinica } from "@/components/shell/criar-clinica";
import { MotorStatus } from "@/components/shell/motor-status";
import { WhatsappBanner } from "@/components/shell/whatsapp-banner";
import { ROLE_LABELS, getSessionContext } from "@/lib/auth/active-clinic";
import { diaCivil, limitesDoDia, somarDias } from "@/lib/domain/horarios";
import type { SaudeDoMotor } from "@/lib/domain/motor";
import { STATUS_PENDENTES } from "@/lib/queries/confirmacoes";
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
    // Dono do produto sem clinica ativa: precisa poder CRIAR uma, senao entra
    // no sistema e nao consegue fazer nada. A tela completa de administracao
    // e a Tela 14 (tarefa 5.5).
    if (context.isProductAdmin && ativos.length === 0) {
      return (
        <main className="grid min-h-dvh place-items-center p-8">
          <CriarClinica primeira />
        </main>
      );
    }

    // Tem clinica ativa (mais de uma) e talvez um pedido pendente em outra:
    // a escolha entre as ativas vem ANTES da tela de espera, senao a pessoa
    // perde o acesso as clinicas onde ja trabalha.
    if (ativos.length > 1) {
      redirect("/selecionar-clinica");
    }

    // Entrou por codigo e aguarda aprovacao: entra no sistema, mas sem
    // enxergar dado de paciente. Nada de sessao orfa nem laco de logout.
    if (pendentes.length > 0) {
      const clinica = pendentes[0]?.clinicName ?? "sua clínica";
      return (
        <main className="grid min-h-dvh place-items-center p-8">
          <div className="grid max-w-md justify-items-center gap-3 rounded-lg border bg-card p-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Hourglass
                strokeWidth={1.5}
                className="size-6 [color:var(--warning)]"
              />
            </span>
            <h1 className="text-[15px] font-semibold">
              Aguardando liberação de acesso
            </h1>
            <p className="text-sm text-text-secondary">
              Seu pedido de entrada em <strong>{clinica}</strong> foi
              registrado. Um administrador precisa liberar seu acesso, e é por
              isso que você ainda não vê as conversas dos pacientes.
            </p>
          </div>
        </main>
      );
    }

    return (
      <main className="grid min-h-dvh place-items-center p-8">
        <div className="grid max-w-md gap-2 rounded-lg border bg-card p-6 text-center">
          <h1 className="text-[15px] font-semibold">Sem clínica vinculada</h1>
          <p className="text-sm text-text-secondary">
            Seu usuário ainda não pertence a nenhuma clínica. Peça o convite ao
            administrador.
          </p>
        </div>
      </main>
    );
  }

  const active = context.active;

  // TUDO que o shell precisa do banco, numa rodada so. Em serie eram quatro
  // idas ao Postgres remoto em CADA renderizacao de pagina, e isso aparece:
  // a suite de navegador ficou minutos mais lenta e os testes de tempo real
  // comecaram a estourar o limite de 2 segundos. O shell e o caminho mais
  // quente do sistema; latencia aqui e paga por toda tela.
  const supabase = await createClient();
  const amanha = somarDias(diaCivil(active.timezone, new Date()), 1);
  const janelaDeAmanha = limitesDoDia(active.timezone, amanha);

  const [
    { data: whatsappAccount },
    { data: saude },
    { count: aguardandoHumano },
    { count: confirmacoesPendentes },
  ] = await Promise.all([
    // Faixa de WhatsApp desconectado (estado 5 da secao 8 do brief): so quando
    // a clinica tem conta e ela nao esta conectada.
    supabase
      .from("whatsapp_account")
      .select("connection_status")
      .eq("clinic_id", active.clinicId)
      .maybeSingle(),
    // Prova de vida do motor: os DOIS papeis (fila e planner) mais a
    // contagem de tarefas atrasadas, numa chamada so. Ler worker_heartbeat
    // cru pegaria "a batida mais recente de qualquer executor", e o planner
    // vivo esconderia a fila morta.
    supabase.rpc("saude_do_motor"),
    // awaiting_reply, nao status e nao unread_count. Status sozinho contaria
    // as conversas que a REGUA abriu para enviar confirmacao (40 disparos =
    // badge 40, com a mensagem de paciente de verdade enterrada). E
    // unread_count zera quando alguem so ABRE a conversa para ler, o que
    // faria o lembrete sumir sem ninguem ter respondido.
    supabase
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", active.clinicId)
      .eq("status", "aguardando_humano")
      .eq("awaiting_reply", true),
    // Confirmacoes pendentes de amanha, no fuso da CLINICA: o mesmo recorte
    // que a Tela 2 abre por padrao.
    supabase
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", active.clinicId)
      .in("status", STATUS_PENDENTES)
      .gte("starts_at", janelaDeAmanha.inicio.toISOString())
      .lt("starts_at", janelaDeAmanha.fim.toISOString()),
  ]);

  // A decisao motor x WhatsApp (e a precedencia entre as duas faixas) vive no
  // MotorStatus, no cliente: este layout e preservado em navegacao suave,
  // entao a versao do servidor so mudaria em carga dura ou revalidate, e um
  // motor que morre com a aba aberta ficava invisivel ate alguem dar F5. A
  // batida buscada aqui garante o primeiro paint certo; o polling do
  // componente mantem a faixa honesta depois.
  const saudeInicial = (saude ?? null) as SaudeDoMotor | null;

  const banner = (
    <MotorStatus
      saudeInicial={saudeInicial}
      timezone={active.timezone}
      fallback={
        whatsappAccount && whatsappAccount.connection_status !== "conectado" ? (
          <WhatsappBanner />
        ) : null
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
      canSwitchClinic={
        context.memberships.filter((m) => m.status === "ativo").length > 1
      }
      labels={active.labels}
      banner={banner}
      counts={{
        conversas: aguardandoHumano ?? 0,
        confirmacoes: confirmacoesPendentes ?? 0,
      }}
    >
      <QueryProvider>{children}</QueryProvider>
    </AppShell>
  );
}
