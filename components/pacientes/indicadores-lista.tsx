import {
  CalendarOff,
  Repeat2,
  RotateCw,
  UserRoundPlus,
  Users,
} from "lucide-react";

import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import { Button } from "@/components/ui/button";
import { pluralize } from "@/lib/branding/labels";
import { formatarPercentual } from "@/lib/domain/formato-compacto";
import {
  cartoesDePacientes,
  type MetricasDePacientes,
} from "@/lib/domain/pacientes-ui";

// Os 4 cartoes do topo da lista de Pacientes (Fase 3, decisoes do dono em
// 02/10/2026), no cartao de metrica unico. Os numeros vem da RPC
// metricas_de_pacientes (a clinica inteira, contada no banco); a decisao de
// "Ainda não medido" e "Contando desde" e de cartoesDePacientes, com as
// mesmas fronteiras da funcao. Os cartoes NAO sao botoes: o filtro
// "Com pacote" continua sendo o unico controle com esse nome na tela.
//
// Icones neutros e sem dono (nenhum e status): Users (o mesmo do menu
// Pacientes), UserRoundPlus, Repeat2 (o Repeat e do follow-up e das etapas
// da jornada) e CalendarOff para "nada marcado". O MoonStar e da etiqueta
// Inativo, que conta 90 dias e qualquer consulta: outra definicao, entao
// outro icone.
//
// Profissional: a RLS recorta a agenda dele, e cada rodape diz isso.

const numero = new Intl.NumberFormat("pt-BR");

function maiuscula(texto: string): string {
  return (texto[0]?.toUpperCase() ?? "") + texto.slice(1);
}

export function IndicadoresDaLista({
  metricas,
  falhou,
  tentando,
  aoTentarDeNovo,
  agora,
  timezone,
  termoPacientes,
  termoConsulta,
  soDaSuaAgenda,
}: {
  /** undefined enquanto a primeira carga nao chegou (ou falhou) */
  metricas: MetricasDePacientes | undefined;
  /** A carga falhou e nao ha numero nenhum para mostrar */
  falhou: boolean;
  /** Uma nova tentativa esta em andamento */
  tentando: boolean;
  aoTentarDeNovo: () => void;
  /** O instante da carga: as fronteiras de dia saem dele, no fuso da clinica */
  agora: Date;
  timezone: string;
  /** "pacientes" no vocabulario da clinica (white-label) */
  termoPacientes: string;
  /** "consulta" no vocabulario da clinica (white-label) */
  termoConsulta: string;
  soDaSuaAgenda: boolean;
}) {
  const rotulos = {
    ativos: `${maiuscula(termoPacientes)} ativos`,
    novos: "Novos no mês",
    retorno: "Retorno em 90 dias",
    semConsulta: `Sem ${termoConsulta} há 6 meses`,
  };
  const icones = {
    ativos: Users,
    novos: UserRoundPlus,
    retorno: Repeat2,
    semConsulta: CalendarOff,
  };

  if (metricas === undefined) {
    // Sem numero nenhum: carregando ou erro em cada cartao, nunca zero.
    const tentarDeNovo = (
      <Button
        variant="outline"
        className="h-10"
        disabled={tentando}
        onClick={aoTentarDeNovo}
      >
        <RotateCw aria-hidden />
        {tentando ? "Tentando..." : "Tentar de novo"}
      </Button>
    );
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(Object.keys(rotulos) as (keyof typeof rotulos)[]).map((chave) =>
          falhou ? (
            <CartaoDeMetrica
              key={chave}
              rotulo={rotulos[chave]}
              icone={icones[chave]}
              estado="erro"
              tentarDeNovo={tentarDeNovo}
            />
          ) : (
            <CartaoDeMetrica
              key={chave}
              rotulo={rotulos[chave]}
              icone={icones[chave]}
              estado="carregando"
            />
          ),
        )}
      </div>
    );
  }

  const cartoes = cartoesDePacientes(metricas, agora, timezone);
  const mes = agora.toLocaleDateString("pt-BR", {
    month: "long",
    timeZone: timezone,
  });
  const naSuaAgenda = soDaSuaAgenda ? ", na sua agenda" : "";
  const consultas = pluralize(termoConsulta);
  const { ativos, retorno, semConsulta6m } = cartoes;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <CartaoDeMetrica
        rotulo={rotulos.ativos}
        icone={icones.ativos}
        valor={numero.format(ativos.valor)}
        variacao={
          ativos.anterior === null
            ? null
            : {
                atual: ativos.valor,
                anterior: ativos.anterior,
                comparadoCom: "30 dias atrás",
                formato: "absoluto",
              }
        }
        rodape={
          ativos.contandoDesde === null
            ? `Atendidos nos últimos 12 meses${naSuaAgenda}`
            : `Contando desde ${ativos.contandoDesde}${naSuaAgenda}`
        }
      />
      <CartaoDeMetrica
        rotulo={rotulos.novos}
        icone={icones.novos}
        valor={numero.format(cartoes.novosNoMes)}
        rodape={`Primeira ${termoConsulta} em ${mes}${naSuaAgenda}`}
      />
      {retorno.medido ? (
        <CartaoDeMetrica
          rotulo={rotulos.retorno}
          icone={icones.retorno}
          valor={formatarPercentual(retorno.percentual)}
          unidade="%"
          rodape={`De ${numero.format(retorno.base)} ${
            retorno.base === 1 ? termoConsulta : consultas
          }${naSuaAgenda}`}
        />
      ) : (
        <CartaoDeMetrica
          rotulo={rotulos.retorno}
          icone={icones.retorno}
          estado="nao-medido"
          dica={`Mede quantas ${consultas} atendidas tiveram outra marcada em até 90 dias. A conta só fecha 90 dias depois do atendimento, por isso ainda não há número.`}
          rodape={
            retorno.primeiraMedidaEm === null
              ? undefined
              : `Primeira medida em ${retorno.primeiraMedidaEm}${naSuaAgenda}`
          }
        />
      )}
      {semConsulta6m.medido ? (
        <CartaoDeMetrica
          rotulo={rotulos.semConsulta}
          icone={icones.semConsulta}
          valor={numero.format(semConsulta6m.valor)}
          rodape={`Atendidos há mais de 6 meses, nada marcado${naSuaAgenda}`}
        />
      ) : (
        <CartaoDeMetrica
          rotulo={rotulos.semConsulta}
          icone={icones.semConsulta}
          estado="nao-medido"
          dica="Conta quem foi atendido há mais de 6 meses e não tem nada marcado. Com menos de 6 meses de atendimentos no sistema, o zero não diria nada."
          rodape={
            semConsulta6m.contaDesde === null
              ? undefined
              : `Começa a contar em ${semConsulta6m.contaDesde}${naSuaAgenda}`
          }
        />
      )}
    </div>
  );
}
