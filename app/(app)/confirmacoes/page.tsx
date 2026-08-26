import { redirect } from "next/navigation";

import { AvisoCelular } from "@/components/shared/aviso-celular";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { diaCivil, somarDias } from "@/lib/domain/horarios";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import {
  fetchConfirmacoesDia,
  fetchFaltasDeHoje,
  fetchReguasDaClinica,
} from "@/lib/queries/confirmacoes";
import { createClient } from "@/lib/supabase/server";

import { ConfirmacoesClient } from "./confirmacoes-client";

// Tela 2, Confirmacoes (tarefa 4.7): a primeira tela que a recepcao abre de
// manha. Carga inicial no servidor, interatividade no cliente.
//
// O dia PADRAO e amanha NO FUSO DA CLINICA (regra 3.6): confirmar consulta e
// sempre olhar o dia seguinte, e "amanha" depende do relogio da clinica, nao
// do servidor.
export default async function ConfirmacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; data?: string }>;
}) {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  // A aba vem da URL e quem a le e o cliente; aqui so o dia importa, porque
  // e ele que decide qual carga inicial buscar.
  const { data } = await searchParams;

  const hoje = diaCivil(active.timezone, new Date());
  const amanha = somarDias(hoje, 1);
  const diaValido = /^\d{4}-\d{2}-\d{2}$/.test(data ?? "");
  const dia = diaValido ? (data as string) : amanha;

  // Regra 3.1: a tela mostra nome e telefone de paciente (dado sensivel); a
  // leitura vai para a trilha, com throttle no helper. Sem await: nao atrasa
  // a renderizacao.
  void auditarLeituraDePaciente(supabase, {
    clinicId: active.clinicId,
    userId: context.userId,
    entity: "confirmacoes",
  });

  const [consultas, faltas, reguas] = await Promise.all([
    fetchConfirmacoesDia(supabase, active.clinicId, dia, active.timezone),
    fetchFaltasDeHoje(supabase, active.clinicId, hoje, active.timezone),
    fetchReguasDaClinica(supabase, active.clinicId),
  ]);

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Confirmações"
        description="Quem já confirmou a consulta e quem ainda precisa de um empurrão"
      />
      <AvisoCelular />
      <ConfirmacoesClient
        clinicId={active.clinicId}
        timezone={active.timezone}
        viewerId={context.userId}
        hoje={hoje}
        amanha={amanha}
        diaInicial={dia}
        consultasIniciais={consultas}
        faltasIniciais={faltas}
        reguasIniciais={reguas}
        podeConfirmar={canEdit(active.role, "confirmacoes_espera")}
        dicaConfirmar={
          permissionHint(active.role, "confirmacoes_espera") ??
          "Seu perfil não pode alterar confirmações"
        }
        podeAgendar={canEdit(active.role, "agenda")}
        dicaAgendar={
          permissionHint(active.role, "agenda") ??
          "Seu perfil só consulta a agenda"
        }
        podeAutomatizar={canEdit(active.role, "automacoes")}
        dicaAutomatizar={
          permissionHint(active.role, "automacoes") ??
          "Somente administradores e gestores alteram as automações"
        }
      />
    </div>
  );
}
