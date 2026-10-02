import { CalendarDays, Clock, Sparkles } from "lucide-react";

import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import type { Leitura, ResumoDoDia } from "@/lib/queries/inicio";

import {
  COMPARADO_COM_O_DIA,
  rodapeDasConfirmadas,
  rodapeDasUnidades,
  rodapeDoAguardando,
} from "./numeros-do-dia";

// Os 4 cartoes do DIA do Inicio (Fase 3, decisao do dono de 02/10), na
// ordem do prototipo: Consultas hoje, Confirmadas (o lime da grade),
// Aguardando (o status, Clock em warning) e Resolvidas pela IA (A2, ainda
// nao medido). A variacao A1 compara com o mesmo dia da semana passada; o
// dia de hoje ainda esta em andamento, D-7 ja fechou (vies conhecido e
// aceito). Erro nunca vira zero: o cartao diz que nao carregou.

const DICA_DA_IA =
  "Chega com o agente de IA. Sem o agente atendendo, não existe número para mostrar.";

export function IndicadoresDoDia({
  resumo,
  timezone,
}: {
  resumo: Leitura<ResumoDoDia>;
  timezone: string;
}) {
  return (
    <section
      aria-label="Indicadores de hoje"
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      {resumo.ok ? (
        <CartoesComValor resumo={resumo.dados} timezone={timezone} />
      ) : (
        <>
          <CartaoDeMetrica
            rotulo="Consultas hoje"
            icone={CalendarDays}
            estado="erro"
          />
          <CartaoDeMetrica destaque rotulo="Confirmadas" estado="erro" />
          <CartaoDeMetrica
            rotulo="Aguardando"
            icone={Clock}
            tom="warning"
            estado="erro"
          />
        </>
      )}
      <CartaoDeMetrica
        rotulo="Resolvidas pela IA"
        icone={Sparkles}
        tom="ai"
        estado="nao-medido"
        dica={DICA_DA_IA}
      />
    </section>
  );
}

function CartoesComValor({
  resumo,
  timezone,
}: {
  resumo: ResumoDoDia;
  timezone: string;
}) {
  const { hoje, semanaPassada } = resumo;
  return (
    <>
      <CartaoDeMetrica
        rotulo="Consultas hoje"
        icone={CalendarDays}
        valor={hoje.total.toLocaleString("pt-BR")}
        rodape={rodapeDasUnidades(hoje.unidades)}
        variacao={{
          atual: hoje.total,
          anterior: semanaPassada.total,
          comparadoCom: COMPARADO_COM_O_DIA,
        }}
      />
      <CartaoDeMetrica
        destaque
        rotulo="Confirmadas"
        valor={hoje.confirmadas.toLocaleString("pt-BR")}
        rodape={rodapeDasConfirmadas(hoje.confirmadas, hoje.total)}
        variacao={{
          atual: hoje.confirmadas,
          anterior: semanaPassada.confirmadas,
          comparadoCom: COMPARADO_COM_O_DIA,
        }}
      />
      <CartaoDeMetrica
        rotulo="Aguardando"
        icone={Clock}
        tom="warning"
        valor={hoje.aguardando.toLocaleString("pt-BR")}
        rodape={rodapeDoAguardando(resumo.ultimoDisparo, timezone)}
      />
    </>
  );
}
