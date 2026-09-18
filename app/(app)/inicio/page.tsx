import { MessagesSquare, Plug, UserPlus } from "lucide-react";
import { redirect } from "next/navigation";

import {
  Checklist,
  type PassoDoChecklist,
} from "@/components/inicio/checklist";
import { CartaoProximasAcoes, Painel } from "@/components/inicio/painel";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { diaCivil, somarDias } from "@/lib/domain/horarios";
import { canEdit } from "@/lib/domain/permissions";
import {
  fetchAgendaDoPeriodo,
  fetchAtendimentoDoPeriodo,
  fetchFunilDoPeriodo,
  fetchProximasAcoes,
} from "@/lib/queries/relatorios";
import { createClient } from "@/lib/supabase/server";

import { VisaoDoProfissional } from "../relatorios/visao-do-profissional";

// Inicio (Tela 5, tarefa 5.1): o resumo do dia da clinica. O checklist de
// primeiros passos continua aparecendo ACIMA do painel enquanto houver
// pendencia (ele era a tela inteira antes do painel existir) e some quando
// tudo esta pronto. Os numeros vem das MESMAS RPCs da tela de Resultados:
// dois numeros com o mesmo nome contam igual nas duas telas. So agregados,
// nenhum nome de paciente, entao nao ha leitura a auditar (regra 3.1).

export default async function InicioPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/login");
  }

  const supabase = await createClient();
  const diaAte = diaCivil(active.timezone, new Date());
  const diaDe = somarDias(diaAte, -29);

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

    return (
      <div className="grid gap-6 p-6">
        <PageHeader
          title="Início"
          description={`O seu dia em ${active.clinicName}`}
        />
        <div className="grid gap-4">
          <CartaoProximasAcoes
            proximasAcoes={proximasAcoes}
            rotulo="Suas próximas ações"
          />
          {agendaPropria ? (
            <VisaoDoProfissional agenda={agendaPropria} />
          ) : (
            <p className="max-w-prose text-sm text-text-secondary">
              Seu usuário ainda não está ligado a um profissional da agenda.
              Peça para a administração vincular, e os seus resultados
              aparecem aqui.
            </p>
          )}
        </div>
      </div>
    );
  }

  const [conta, conversas, equipe, funil, agenda, atendimento, proximasAcoes] =
    await Promise.all([
      supabase
        .from("whatsapp_account")
        .select("connection_status")
        .eq("clinic_id", active.clinicId)
        .maybeSingle(),
      supabase
        .from("conversation")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", active.clinicId),
      supabase
        .from("clinic_member")
        .select("user_id", { count: "exact", head: true })
        .eq("clinic_id", active.clinicId)
        .eq("status", "ativo"),
      fetchFunilDoPeriodo(supabase, active.clinicId, active.timezone, diaDe, diaAte),
      fetchAgendaDoPeriodo(supabase, active.clinicId, active.timezone, diaDe, diaAte),
      fetchAtendimentoDoPeriodo(supabase, active.clinicId, active.timezone, diaDe, diaAte),
      fetchProximasAcoes(supabase, active.clinicId, active.timezone),
    ]);

  const conectado = conta.data?.connection_status === "conectado";
  const totalConversas = conversas.count ?? 0;
  const totalEquipe = equipe.count ?? 0;
  // Conexao do WhatsApp e equipe sao acoes de quem edita Configuracoes
  // (administrador e gestor), nao so do administrador.
  const podeConfigurar = canEdit(active.role, "configuracoes");

  const passos: PassoDoChecklist[] = [
    {
      concluido: conectado,
      titulo: "Conectar o WhatsApp da clínica",
      descricao: conectado
        ? "O número está conectado e recebendo mensagens."
        : "Sem isso, nenhuma mensagem de paciente chega até aqui.",
      acao:
        podeConfigurar && !conectado
          ? { rotulo: "Conectar agora", href: "/configuracoes?aba=whatsapp" }
          : undefined,
      icone: Plug,
    },
    {
      concluido: totalEquipe > 1,
      titulo: "Chamar a equipe",
      descricao:
        totalEquipe > 1
          ? `${totalEquipe} pessoas com acesso à clínica.`
          : "Convide a recepção por e-mail ou passe o código da clínica.",
      acao: podeConfigurar
        ? { rotulo: "Gerenciar equipe", href: "/configuracoes" }
        : undefined,
      icone: UserPlus,
    },
    {
      concluido: totalConversas > 0,
      titulo: "Receber o primeiro atendimento",
      descricao:
        totalConversas > 0
          ? `${totalConversas} conversa${totalConversas > 1 ? "s" : ""} no atendimento.`
          : "Quando um paciente escrever, a conversa aparece no Atendimento na hora.",
      acao: { rotulo: "Abrir Atendimento", href: "/atendimento" },
      icone: MessagesSquare,
    },
  ];

  const tudoPronto = passos.every((passo) => passo.concluido);

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Início"
        description={
          tudoPronto
            ? `O dia a dia de ${active.clinicName}`
            : `Vamos deixar ${active.clinicName} pronta para atender`
        }
      />
      {tudoPronto ? null : <Checklist passos={passos} />}
      <Painel
        funil={funil}
        agenda={agenda}
        atendimento={atendimento}
        proximasAcoes={proximasAcoes}
      />
    </div>
  );
}
