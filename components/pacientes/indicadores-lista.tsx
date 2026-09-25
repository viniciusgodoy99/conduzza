import { MoonStar, Package, UserRoundPlus, UsersRound } from "lucide-react";

import { CartaoIndicador, ValorIndicador } from "@/components/pacientes/comum";
import type { IndicadoresDaLista as Indicadores } from "@/lib/domain/pacientes-ui";
import { PACIENTES_LIMIT } from "@/lib/queries/pacientes";

// Indicadores do topo da lista de Pacientes (decisao C28 do dono, 24/09/2026).
// So numeros que o sistema ja sabe contar, com a MESMA regra dos filtros e das
// etiquetas: nada de "ativo", "retorno" ou variacao sem definicao (o kit
// sugere; o brief nao tem). Os cartoes NAO sao botoes: o filtro "Com pacote"
// continua sendo o unico controle com esse nome na tela.
//
// O cartao de inativos usa o icone e o tom do sinal "Inativo" (PATIENT_TAG):
// o cartao E aquele sinal, entao a forma e a cor sao as mesmas.

const numero = new Intl.NumberFormat("pt-BR");

export function IndicadoresDaLista({
  indicadores,
  agora,
  timezone,
  termoPacientes,
  termoConsulta,
  soDaSuaAgenda,
  noLimite,
}: {
  indicadores: Indicadores;
  agora: Date;
  timezone: string;
  termoPacientes: string;
  termoConsulta: string;
  soDaSuaAgenda: boolean;
  /** A lista bateu no teto de carga: a contagem e dos primeiros */
  noLimite: boolean;
}) {
  const mes = agora.toLocaleDateString("pt-BR", {
    month: "long",
    timeZone: timezone,
  });
  const naSuaAgenda = soDaSuaAgenda ? ", na sua agenda" : "";

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <CartaoIndicador
        rotulo={`Total de ${termoPacientes}`}
        icone={UsersRound}
        nota={
          noLimite
            ? `Contados os primeiros ${numero.format(PACIENTES_LIMIT)} em ordem alfabética`
            : `Com pelo menos uma ${termoConsulta}`
        }
      >
        <ValorIndicador>{numero.format(indicadores.total)}</ValorIndicador>
      </CartaoIndicador>
      <CartaoIndicador
        rotulo="Novos no mês"
        icone={UserRoundPlus}
        nota={`Primeira ${termoConsulta} em ${mes}${naSuaAgenda}`}
      >
        <ValorIndicador>{numero.format(indicadores.novosNoMes)}</ValorIndicador>
      </CartaoIndicador>
      <CartaoIndicador
        rotulo="Com pacote ativo"
        icone={Package}
        nota="Com sessão para usar, dentro da validade"
      >
        <ValorIndicador>
          {numero.format(indicadores.comPacoteAtivo)}
        </ValorIndicador>
      </CartaoIndicador>
      <CartaoIndicador
        rotulo={`Sem ${termoConsulta} há mais de 90 dias`}
        icone={MoonStar}
        iconeClassName="text-neutral-text"
        nota={`Nada marcado adiante, o mesmo critério do sinal Inativo${naSuaAgenda}`}
      >
        <ValorIndicador>{numero.format(indicadores.inativos)}</ValorIndicador>
      </CartaoIndicador>
    </div>
  );
}
