import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
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
  // A aba vem da URL e quem a le e o cliente; aqui o dia decide qual carga
  // inicial buscar, e a aba so escolhe a data do eyebrow.
  const { aba, data } = await searchParams;

  const hoje = diaCivil(active.timezone, new Date());
  const amanha = somarDias(hoje, 1);
  const diaValido = /^\d{4}-\d{2}-\d{2}$/.test(data ?? "");
  const dia = diaValido ? (data as string) : amanha;
  // Dia civil da clinica ja calculado no fuso dela (regra 3.6): parseISO de
  // "aaaa-mm-dd" e format no mesmo relogio devolvem a mesma data, qualquer
  // que seja o fuso do servidor.
  const dataDoEyebrow = format(
    parseISO(aba === "faltas" ? hoje : dia),
    "EEEE, d 'de' MMMM",
    { locale: ptBR },
  );

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
    <div className="flex flex-col gap-3.5 p-6">
      <PageHeader
        eyebrow={dataDoEyebrow}
        title="Confirmações"
        description="Quem já confirmou a consulta e quem ainda precisa de um empurrão"
      />
      {/* Tela pensada para computador (brief secao 6): no celular, o aviso. */}
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
        // Registrar autorizacao e a mesma acao da ficha (leads e pacientes).
        podeRegistrarAutorizacao={canEdit(active.role, "leads_pacientes")}
        dicaAutorizacao={
          permissionHint(active.role, "leads_pacientes") ??
          "Seu perfil não pode editar leads e pacientes"
        }
        // O modal de agendamento (Remarcar da falta) leva a Cadastros quando
        // falta jornada ou vinculo: a mesma permissao da Agenda (achado L21).
        podeEditarCadastros={canEdit(active.role, "cadastros")}
        dicaCadastros={
          permissionHint(active.role, "cadastros") ??
          "Somente administradores e gestores alteram os cadastros"
        }
        ehAdministrador={active.role === "admin"}
      />
    </div>
  );
}
