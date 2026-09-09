import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CircleAlert,
  CircleOff,
  ClipboardList,
  Megaphone,
  Send,
  SendHorizonal,
  Timer,
  TrendingUp,
} from "lucide-react";
import { redirect } from "next/navigation";

import { rotuloDoCanal } from "@/components/leads/rotulos";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { createT } from "@/lib/branding/labels";
import { fetchConversoesDevolvidas } from "@/lib/queries/conversoes-meta";
import { STATUS_TONE_VARS } from "@/lib/design/status";
import { fetchResultados } from "@/lib/queries/resultados";
import { createClient } from "@/lib/supabase/server";
import { formatarCentavos } from "@/lib/utils/moeda";

// Tela 5/11, Resultados (Modulo 10): de qual canal vem o paciente que
// comparece. v1 desenha o que ja da para calcular com o dado existente (funil
// e origem por canal). O detalhamento por campanha e o retorno para a Meta
// (CAPI) chegam com a integracao de atribuicao (docs/06). Server Component
// puro: sem estado, sem filtro de periodo ainda. So contagens agregadas,
// nenhum nome ou telefone de paciente, entao nao ha leitura a auditar.

function pct(parte: number, todo: number): string {
  if (todo <= 0) {
    return "0%";
  }
  return `${Math.round((parte / todo) * 100)}%`;
}

export default async function ResultadosPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const t = createT(active.labels);

  // Matriz de papeis (brief secao 5): profissional ve "so os proprios". Como a
  // v1 agrega a clinica inteira, o profissional recebe um aviso em vez do
  // numero da clinica toda. A visao por profissional entra depois.
  if (active.role === "profissional") {
    return (
      <div className="grid gap-6 p-6">
        <PageHeader
          title="Resultados"
          description={`De qual canal vem o ${t("paciente")} que comparece.`}
        />
        <EmptyState
          icon={TrendingUp}
          title="Em breve, por profissional"
          description="Os resultados que você vê aqui vão ser os das suas conversas. A visão por profissional chega junto com o detalhamento por campanha."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const [dados, conversoes] = await Promise.all([
    fetchResultados(supabase, active.clinicId),
    fetchConversoesDevolvidas(supabase, active.clinicId),
  ]);

  // As 3 camadas da regra de status (forma distinta, rotulo, cor), nunca so
  // cor. Registrada = anotada aqui dentro; enviada = ja chegou na Meta.
  const statusDeConversao = [
    {
      rotulo: "Registradas",
      valor: conversoes.porStatus.registrado,
      Icone: ClipboardList,
      cor: STATUS_TONE_VARS.neutral.text,
    },
    {
      rotulo: "Na fila",
      valor: conversoes.porStatus.enfileirado,
      Icone: Timer,
      cor: STATUS_TONE_VARS.info.text,
    },
    {
      rotulo: "Enviadas",
      valor: conversoes.porStatus.enviado,
      Icone: SendHorizonal,
      cor: STATUS_TONE_VARS.success.text,
    },
    {
      rotulo: "Com falha",
      valor: conversoes.porStatus.falhou,
      Icone: CircleAlert,
      cor: STATUS_TONE_VARS.alert.text,
    },
    {
      rotulo: "Descartadas",
      valor: conversoes.porStatus.descartado,
      Icone: CircleOff,
      cor: STATUS_TONE_VARS.neutral.text,
    },
  ];

  const indicadores = [
    { rotulo: "Leads", valor: String(dados.totalLeads) },
    { rotulo: "Agendamentos", valor: String(dados.agendamentos) },
    { rotulo: "Comparecimentos", valor: String(dados.comparecimentos) },
    {
      rotulo: "Taxa de lead para comparecimento",
      valor: pct(dados.comparecimentos, dados.totalLeads),
    },
  ];

  const funil = [
    { rotulo: "Leads", valor: dados.totalLeads, taxa: null as string | null },
    {
      rotulo: "Agendamentos",
      valor: dados.agendamentos,
      taxa: pct(dados.agendamentos, dados.totalLeads),
    },
    {
      rotulo: "Comparecimentos",
      valor: dados.comparecimentos,
      taxa: pct(dados.comparecimentos, dados.agendamentos),
    },
  ];

  const maiorCanal = dados.porCanal.reduce(
    (max, canal) => Math.max(max, canal.total),
    0,
  );

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Resultados"
        description={`De qual canal vem o ${t("paciente")} que comparece.`}
      />

      {dados.totalLeads === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="Sem dados ainda"
          description="Os resultados aparecem quando os primeiros contatos entrarem pelo WhatsApp."
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {indicadores.map((indicador) => (
              <div
                key={indicador.rotulo}
                className="grid gap-1 rounded-lg border bg-card p-4"
              >
                <span className="text-sm text-text-secondary">
                  {indicador.rotulo}
                </span>
                <span className="text-2xl font-semibold tabular-nums">
                  {indicador.valor}
                </span>
              </div>
            ))}
          </section>

          <section className="grid gap-3 rounded-lg border bg-card p-4">
            <h2 className="text-[15px] font-semibold">Funil</h2>
            <div className="grid gap-3">
              {funil.map((etapa) => {
                // O piso de 4% existe para valor PEQUENO continuar visível.
                // Valor ZERO não ganha piso: barra desenhada para zero mente
                // numa tela de decisão de dinheiro (achado da revisão de
                // 08/09/2026, reproduzível com o dado real).
                const largura =
                  dados.totalLeads > 0 && etapa.valor > 0
                    ? Math.max(4, (etapa.valor / dados.totalLeads) * 100)
                    : 0;
                return (
                  <div key={etapa.rotulo} className="grid gap-1">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{etapa.rotulo}</span>
                      <span className="text-text-secondary tabular-nums">
                        {etapa.valor}
                        {etapa.taxa ? (
                          <span className="text-text-tertiary">
                            {" "}
                            ({etapa.taxa})
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-surface-4">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${largura}%`,
                          background: "var(--primary)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-3 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Megaphone
                strokeWidth={1.5}
                className="size-4 text-text-secondary"
              />
              <h2 className="text-[15px] font-semibold">Origem por canal</h2>
              <span className="text-sm text-text-tertiary">
                {pct(dados.rastreados, dados.totalLeads)} rastreadas
              </span>
            </div>
            <div className="grid gap-2">
              {dados.porCanal.map((canal) => {
                const largura =
                  maiorCanal > 0 && canal.total > 0
                    ? Math.max(3, (canal.total / maiorCanal) * 100)
                    : 0;
                const rotulo = rotuloDoCanal(canal.canal) ?? "Não rastreada";
                return (
                  <div
                    key={canal.canal ?? "nao_rastreada"}
                    className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-3"
                  >
                    <span className="truncate text-sm">{rotulo}</span>
                    <div className="h-2.5 overflow-hidden rounded-full bg-surface-4">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${largura}%`,
                          background: canal.canal
                            ? "var(--primary)"
                            : "var(--neutral)",
                        }}
                      />
                    </div>
                    <span className="text-right text-sm text-text-secondary tabular-nums">
                      {canal.total}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-3 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Send strokeWidth={1.5} className="size-4 text-text-secondary" />
              <h2 className="text-[15px] font-semibold">
                Conversões devolvidas à Meta
              </h2>
              {conversoes.ultimoEnvio ? (
                <span className="text-sm text-text-tertiary">
                  último envio{" "}
                  {/* Regra 3.6: exibir no fuso da clinica, nunca no do servidor. */}
                  {format(
                    new TZDate(conversoes.ultimoEnvio, active.timezone),
                    "dd/MM 'às' HH:mm",
                    { locale: ptBR },
                  )}
                </span>
              ) : null}
            </div>
            {conversoes.total === 0 ? (
              <p className="max-w-prose text-sm text-text-secondary">
                Nenhuma conversão registrada ainda. Escolha em qual etapa da
                jornada a clínica registra conversão na aba Jornada e
                conversões, em Configurações. O envio para a conta de anúncios
                liga depois, na aba de anúncios da Meta.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {statusDeConversao.map((status) => (
                    <div key={status.rotulo} className="grid gap-1">
                      <span className="flex items-center gap-1.5 text-sm text-text-secondary">
                        <status.Icone
                          strokeWidth={1.5}
                          className="size-4"
                          style={{ color: status.cor }}
                          aria-hidden
                        />
                        {status.rotulo}
                      </span>
                      <span className="text-xl font-semibold tabular-nums">
                        {status.valor}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-text-secondary">
                  {conversoes.comCtwa} de {conversoes.total} com identificador
                  do anúncio
                  {conversoes.valorEnviadoCents > 0
                    ? `, ${formatarCentavos(conversoes.valorEnviadoCents)} em valor já enviado`
                    : ""}
                  .
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
