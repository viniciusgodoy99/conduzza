import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AcoesPaciente } from "@/components/pacientes/acoes-paciente";
import { AutorizacaoMensagens } from "@/components/pacientes/autorizacao-mensagens";
import { CabecalhoPaciente } from "@/components/pacientes/cabecalho-paciente";
import { DadosCadastrais } from "@/components/pacientes/dados-cadastrais";
import { IndicadoresPaciente } from "@/components/pacientes/indicadores-paciente";
import { LinhaDoTempo } from "@/components/pacientes/linha-do-tempo";
import { OrigemPaciente } from "@/components/pacientes/origem-paciente";
import { PacotesPaciente } from "@/components/pacientes/pacotes-paciente";
import { Aviso } from "@/components/shared/aviso";
import { AvisoCelular } from "@/components/shared/aviso-celular";
import { Button } from "@/components/ui/button";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { createT } from "@/lib/branding/labels";
import { diaCivil } from "@/lib/domain/horarios";
import {
  agregadosDeConsultas,
  etiquetasDoPaciente,
  indicadoresDe,
  saldoDeSessoes,
} from "@/lib/domain/pacientes-ui";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { formatarCentavos } from "@/lib/utils/moeda";
import { fetchCatalogo } from "@/lib/queries/catalogo";
import { fetchFichaPaciente } from "@/lib/queries/pacientes";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ficha do paciente (Tela 9). Renderizada no SERVIDOR de proposito: a ficha e
// dado de saude, e a leitura precisa deixar rastro de quem abriu a ficha de
// quem (regra 3.1). Os blocos que escrevem sao de cliente e, depois de
// salvar, chamam router.refresh(): quem recarrega o dado continua sendo o
// servidor, com a trilha junto. Sem tempo real aqui.
export default async function FichaPacientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const { id } = await params;
  if (!UUID.test(id)) {
    notFound();
  }

  const supabase = await createClient();

  // A trilha entra no MESMO Promise.all da carga: as duas comecam juntas, e a
  // linha do audit_log existe antes de a ficha sair do servidor.
  const [ficha, catalogo] = await Promise.all([
    fetchFichaPaciente(supabase, active.clinicId, id),
    fetchCatalogo(supabase, active.clinicId),
    auditarLeituraDePaciente(supabase, {
      clinicId: active.clinicId,
      userId: context.userId,
      entity: "ficha_paciente",
      entityId: id,
    }),
  ]);
  // A RLS ja recorta por clinica: sem linha, para esta pessoa a ficha nao
  // existe.
  if (!ficha) {
    notFound();
  }

  const agora = new Date();
  const hojeNaClinica = diaCivil(active.timezone, agora);
  const agregados = agregadosDeConsultas(ficha.consultas, agora);
  // O saldo conta so pacote dentro da validade, no DIA CIVIL da clinica, do
  // mesmo jeito que a RPC da lista conta e que o bloco de pacotes mostra.
  const saldoSessoes = saldoDeSessoes(ficha.pacotes, hojeNaClinica);

  const etiquetas = etiquetasDoPaciente(
    {
      ...agregados,
      saldo_sessoes: saldoSessoes,
      insurance_id: ficha.contato.insurance?.id ?? null,
      profissionais_ids: [],
    },
    agora,
  );

  const nomeDoProcedimento = new Map(
    catalogo.procedimentos.map((procedimento) => [
      procedimento.id,
      procedimento.name,
    ]),
  );
  // So pacote ativo vai a venda (o banco recusa vender desativado). O total
  // cadastrado separa "nenhum pacote cadastrado" de "todos desativados".
  const pacotesDoCatalogo = catalogo.pacotes
    .filter((pacote) => pacote.active)
    .map((pacote) => ({
      id: pacote.id,
      rotulo: `${nomeDoProcedimento.get(pacote.procedure_id) ?? "Pacote"}, ${pacote.sessions} sessões, ${formatarCentavos(pacote.price_cents)}`,
      sessoes: pacote.sessions,
    }));
  // Saldo que alguma consulta ja descontou: a venda nao se cancela (a
  // consulta guarda o saldo que usou), so se ajusta.
  const saldosQueJaDescontaram = [
    ...new Set(
      ficha.consultas
        .map((consulta) => consulta.package_balance_id)
        .filter((saldo): saldo is string => saldo !== null),
    ),
  ];

  const papel = active.role;
  // Profissional so enxerga as consultas da propria agenda (RLS de
  // appointment): a ficha diz isso em vez de apresentar historico parcial
  // como completo (achado 72).
  const soDaSuaAgenda = papel === "profissional";
  const podeEditar = canEdit(papel, "leads_pacientes");
  const dica =
    permissionHint(papel, "leads_pacientes") ??
    "Seu perfil não pode editar leads e pacientes";
  const podeAgendar = canEdit(papel, "agenda");
  const dicaAgendar =
    permissionHint(papel, "agenda") ?? "Seu perfil não pode alterar a agenda";
  const podeEsperar = canEdit(papel, "confirmacoes_espera");
  // A dica so aparece sem permissao, e ai o permissionHint do modulo falaria
  // em "confirmacoes": a acao e de lista de espera, a frase diz isso.
  const dicaEsperar = "Seu perfil não pode alterar a lista de espera";
  const t = createT(active.labels);

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-4 p-6">
      <Button variant="ghost" className="-ml-2.5 w-fit" asChild>
        <Link href="/pacientes">
          <ArrowLeft aria-hidden />
          Voltar para {t("paciente", { plural: true })}
        </Link>
      </Button>

      <CabecalhoPaciente contato={ficha.contato} etiquetas={etiquetas} />
      <AvisoCelular />
      {soDaSuaAgenda ? (
        <Aviso tom="info" role="note">
          Você vê só as consultas da sua agenda. Os números, os sinais e a linha
          do tempo desta ficha contam só elas.
        </Aviso>
      ) : null}
      <IndicadoresPaciente
        indicadores={indicadoresDe(agregados)}
        soDaSuaAgenda={soDaSuaAgenda}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <LinhaDoTempo
          consultas={ficha.consultas}
          timezone={active.timezone}
          contactId={ficha.contato.id}
          podeAgendar={podeAgendar}
          dicaAgendar={dicaAgendar}
          soDaSuaAgenda={soDaSuaAgenda}
        />
        <div className="grid gap-4">
          <DadosCadastrais
            contato={ficha.contato}
            convenios={catalogo.convenios.map((convenio) => ({
              id: convenio.id,
              name: convenio.name,
            }))}
            podeEditar={podeEditar}
            dica={dica}
          />
          <PacotesPaciente
            contactId={ficha.contato.id}
            pacotes={ficha.pacotes}
            pacotesDoCatalogo={pacotesDoCatalogo}
            pacotesCadastrados={catalogo.pacotes.length}
            saldosQueJaDescontaram={saldosQueJaDescontaram}
            hojeNaClinica={hojeNaClinica}
            podeEditar={podeEditar}
            dica={dica}
            podeCancelarVenda={papel === "admin" || papel === "gestor"}
            dicaCancelarVenda="Só administrador e gestor cancelam venda de pacote"
          />
          <AutorizacaoMensagens
            contactId={ficha.contato.id}
            consentimento={ficha.consentimento}
            timezone={active.timezone}
            podeEditar={podeEditar}
            dica={dica}
          />
          <OrigemPaciente contato={ficha.contato} timezone={active.timezone} />
          <AcoesPaciente
            contactId={ficha.contato.id}
            conversationId={ficha.conversationId}
            podeAgendar={podeAgendar}
            dicaAgendar={dicaAgendar}
            podeEsperar={podeEsperar}
            dicaEsperar={dicaEsperar}
            soDaSuaAgenda={soDaSuaAgenda}
          />
        </div>
      </div>
    </div>
  );
}
