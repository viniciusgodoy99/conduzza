"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarSearch, ClipboardCheck, Flag, History } from "lucide-react";
import { useState } from "react";

import { DialogLinhaDeBase } from "@/components/relatorios/dialog-linha-de-base";
import { Secao } from "@/components/relatorios/secao";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  formatarPercentualDoObjetivo,
  taxasDaConfirmacao,
} from "@/lib/domain/exportacao-de-resultados";
import { formatarPercentual, percentualDe } from "@/lib/domain/formato-compacto";
import type {
  AgendaDoPeriodo,
  LinhaDeBase,
  PivoDaRegua,
} from "@/lib/queries/relatorios";

// Confirmacao de consulta COMPLETA (spec 8.10, aba Comercial): o relatorio
// que renova o contrato. Toda comparacao aqui e entre numeros de ORIGEM
// DECLARADA: a linha de base e informada pela clinica (e rotulada assim), a
// taxa do periodo e medida pelo sistema, e o pivo antes/depois usa so
// consultas com desfecho. Nunca um numero sintetico misturando os dois, e
// nenhuma frase de causa.
//
// O lime da aba Comercial e o das Consultas recuperadas (C17): aqui todo
// botao e outline, inclusive o "Registrar a linha de base".

const DICA_LINHA_DE_BASE = "Só quem administra a clínica registra a linha de base.";

/** Instante (timestamptz) exibido no fuso da clinica (regra 3.6). */
function dataCurta(instante: string, timezone: string): string {
  return format(new TZDate(instante, timezone), "dd/MM/yy", { locale: ptBR });
}

function dataDoDia(dia: string, timezone: string): string {
  // Dia civil aaaa-mm-dd: o meio-dia no fuso da clinica nunca vira a data.
  return dataCurta(`${dia}T12:00:00`, timezone);
}

function plural(n: number, singular: string, pluralizado: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : pluralizado}`;
}

/** Cartao afundado de taxa de faltas: valor com 1 casa ou "Sem dados". */
function CartaoDeTaxaDeFalta({
  rotulo,
  faltas,
  comDesfecho,
  tamanho,
}: {
  rotulo: string;
  faltas: number;
  comDesfecho: number;
  tamanho: "lg" | "md";
}) {
  const taxa = percentualDe(faltas, comDesfecho);
  const rodape =
    comDesfecho > 0
      ? `${plural(faltas, "falta", "faltas")} em ${plural(comDesfecho, "consulta", "consultas")} com desfecho (compareceu ou faltou)`
      : "nenhuma consulta com desfecho";
  return taxa === null ? (
    <CartaoDeMetrica
      variante="afundado"
      tamanho={tamanho}
      rotulo={rotulo}
      estado="vazio"
      rodape={rodape}
    />
  ) : (
    <CartaoDeMetrica
      variante="afundado"
      tamanho={tamanho}
      rotulo={rotulo}
      valor={formatarPercentual(taxa)}
      unidade="%"
      rodape={rodape}
    />
  );
}

export function ConfirmacaoCompleta({
  agenda,
  pivo,
  linhaDeBase,
  ehAdmin,
  timezone,
  aoMudarLinhaDeBase,
}: {
  agenda: AgendaDoPeriodo;
  pivo: PivoDaRegua;
  linhaDeBase: LinhaDeBase;
  ehAdmin: boolean;
  timezone: string;
  aoMudarLinhaDeBase: () => Promise<unknown> | void;
}) {
  const [dialogAberto, setDialogAberto] = useState(false);
  const comDesfecho = agenda.porStatus.compareceu + agenda.porStatus.faltou;

  const botaoDaLinhaDeBase = (rotulo: string) =>
    ehAdmin ? (
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => setDialogAberto(true)}
      >
        {rotulo}
      </Button>
    ) : (
      <DisabledWithHint hint={DICA_LINHA_DE_BASE}>
        <Button variant="outline" className="w-fit" disabled>
          {rotulo}
        </Button>
      </DisabledWithHint>
    );

  return (
    <div id="confirmacao" className="grid scroll-mt-4 gap-4">
      <Secao
        titulo="Confirmação de consulta"
        icone={ClipboardCheck}
        meta="Consultas com início no período"
      >
        {agenda.total === 0 ? (
          <EmptyState
            compact
            icon={CalendarSearch}
            title="Nenhuma consulta com início neste período"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {taxasDaConfirmacao(agenda).map((taxa) => {
              const rodape = `${taxa.parte.toLocaleString("pt-BR")} de ${taxa.total.toLocaleString("pt-BR")}`;
              return taxa.percentual === null ? (
                <CartaoDeMetrica
                  key={taxa.rotulo}
                  variante="afundado"
                  tamanho="md"
                  rotulo={taxa.rotulo}
                  estado="vazio"
                  rodape={rodape}
                />
              ) : (
                <CartaoDeMetrica
                  key={taxa.rotulo}
                  variante="afundado"
                  tamanho="md"
                  rotulo={taxa.rotulo}
                  valor={formatarPercentual(taxa.percentual)}
                  unidade="%"
                  rodape={rodape}
                />
              );
            })}
          </div>
        )}
        <p className="text-xs text-text-secondary">
          Confirmadas em algum momento conta quem confirmou mesmo que depois
          tenha comparecido ou faltado. Remarcaram após a falta: consulta nova
          em até <span className="cz-num">30</span> dias, então faltas recentes
          ainda estão dentro dessa janela.
        </p>
      </Secao>

      <Secao titulo="Contra a linha de base" icone={Flag}>
        {linhaDeBase ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <CartaoDeMetrica
              variante="afundado"
              rotulo="Linha de base (informada pela clínica)"
              valor={formatarPercentualDoObjetivo(linhaDeBase.ratePercent)}
              unidade="%"
              rodape={`faltas medidas de ${dataDoDia(linhaDeBase.measuredFrom, timezone)} a ${dataDoDia(linhaDeBase.measuredTo, timezone)}${
                linhaDeBase.note ? ` (${linhaDeBase.note})` : ""
              }`}
              acao={botaoDaLinhaDeBase("Registrar de novo")}
            />
            <CartaoDeTaxaDeFalta
              rotulo="Taxa de faltas no período (medida pelo sistema)"
              faltas={agenda.porStatus.faltou}
              comDesfecho={comDesfecho}
              tamanho="lg"
            />
          </div>
        ) : (
          <EmptyState
            compact
            icon={Flag}
            title="A linha de base ainda não foi registrada"
            description="Registre a taxa de faltas da clínica dos 30 dias anteriores às mensagens automáticas. Sem ela, não existe prova de resultado."
          >
            {botaoDaLinhaDeBase("Registrar a linha de base")}
          </EmptyState>
        )}
      </Secao>

      <Secao
        titulo="Antes e depois da primeira mensagem de régua"
        icone={History}
      >
        {pivo ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <CartaoDeTaxaDeFalta
              rotulo="Faltas antes"
              faltas={pivo.antes.faltas}
              comDesfecho={pivo.antes.comDesfecho}
              tamanho="md"
            />
            <CartaoDeTaxaDeFalta
              rotulo={`Faltas a partir de ${dataCurta(pivo.primeiraReguaEm, timezone)}`}
              faltas={pivo.depois.faltas}
              comDesfecho={pivo.depois.comDesfecho}
              tamanho="md"
            />
          </div>
        ) : (
          <EmptyState
            compact
            icon={History}
            title="A régua desta clínica ainda não enviou nenhuma mensagem"
            description="Quando o primeiro toque sair, o comparativo aparece aqui."
          />
        )}
      </Secao>

      <DialogLinhaDeBase
        aberto={dialogAberto}
        onFechar={() => setDialogAberto(false)}
        aoMudar={aoMudarLinhaDeBase}
      />
    </div>
  );
}
