import { MessagesSquare, Plug, UserPlus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { createClient } from "@/lib/supabase/server";

// Inicio. O painel completo (Tela 5, com indicadores) e a tarefa 5.1. Ate la,
// esta tela cumpre um papel essencial que faltava: dizer a uma clinica recem
// criada o que fazer primeiro. Sem isto, quem acabava de se cadastrar via
// "Em construcao" e nao tinha por onde comecar.

type Passo = {
  concluido: boolean;
  titulo: string;
  descricao: string;
  acao?: { rotulo: string; href: string };
  icone: typeof Plug;
};

export default async function InicioPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/login");
  }

  const supabase = await createClient();
  const [conta, conversas, equipe] = await Promise.all([
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
  ]);

  const conectado = conta.data?.connection_status === "conectado";
  const totalConversas = conversas.count ?? 0;
  const totalEquipe = equipe.count ?? 0;
  const ehAdmin = active.role === "admin";

  const passos: Passo[] = [
    {
      concluido: conectado,
      titulo: "Conectar o WhatsApp da clínica",
      descricao: conectado
        ? "O número está conectado e recebendo mensagens."
        : "Sem isso, nenhuma mensagem de paciente chega até aqui.",
      acao:
        ehAdmin && !conectado
          ? { rotulo: "Conectar agora", href: "/whatsapp" }
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
      acao: ehAdmin
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

  const pendentes = passos.filter((passo) => !passo.concluido);
  const tudoPronto = pendentes.length === 0;

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

      <div className="grid gap-3">
        {passos.map((passo) => {
          const Icone = passo.icone;
          return (
            <div
              key={passo.titulo}
              className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4"
            >
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-full"
                style={
                  passo.concluido
                    ? {
                        backgroundColor: "var(--success-bg)",
                        color: "var(--success-text)",
                      }
                    : {
                        backgroundColor: "var(--warning-bg)",
                        color: "var(--warning-text)",
                      }
                }
              >
                <Icone strokeWidth={1.5} className="size-5" />
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {passo.titulo}
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={
                      passo.concluido
                        ? {
                            backgroundColor: "var(--success-bg)",
                            color: "var(--success-text)",
                          }
                        : {
                            backgroundColor: "var(--warning-bg)",
                            color: "var(--warning-text)",
                          }
                    }
                  >
                    {passo.concluido ? "Feito" : "Pendente"}
                  </span>
                </span>
                <span className="text-[12.5px] text-text-secondary">
                  {passo.descricao}
                </span>
              </div>
              {passo.acao ? (
                <Button
                  asChild
                  variant={passo.concluido ? "outline" : "default"}
                  size="sm"
                >
                  <Link href={passo.acao.href}>{passo.acao.rotulo}</Link>
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-sm text-text-tertiary">
        Os indicadores da clínica (consultas recuperadas, desempenho da IA,
        origem dos pacientes) chegam na fase do painel.
      </p>
    </div>
  );
}
