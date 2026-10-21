"use client";

import {
  adicionarTelefoneDaIaAction,
  alternarNumeroDaIaAction,
  alternarTelefoneDaIaAction,
  excluirTelefoneDaIaAction,
} from "@/app/(app)/agente/whatsapp-actions";
import {
  dicasDaIa,
  escolhaAtual,
  estadoDaIa,
  faltasParaAEquipe,
  TEXTOS_DA_IA,
  type AcaoDaIa,
} from "@/components/agente/whatsapp/agente-de-ia";
import {
  CartaoDosNumeros,
  CartaoDosTelefones,
  RegiaoDoResultado,
  useAcaoDaIa,
} from "@/components/agente/whatsapp/agente-de-ia-tab";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { Aviso } from "@/components/shared/aviso";
import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import type { DadosDaIa } from "@/lib/queries/ia-liberacao";

// Os numeros e os telefones da equipe do agente de UMA clinica, pelo Painel
// geral (onda 1): os mesmos cartoes da aba WhatsApp da Tela 6 (ate a onda
// 2, a aba Agente de IA de Configuracoes), no modo do painel (noPainel), com
// as acoes levando o clinicId da tela. So a equipe Conduzza chega aqui
// (layout da rota), e a acao e o banco conferem de novo. Com o agente da
// clinica desligado ou a conta suspensa (a clinica sai da lista do banco),
// tudo fica visivel e desabilitado, com o porque escrito e na dica: a acao
// recusa mudar numero e telefone de clinica fora da lista. Onda 2: o
// "Excluir" de cada telefone (item 9) e o "Usar mesmo assim" com a
// confirmacao do teste (item 3) tambem valem aqui.

export type CartoesDoAgenteNoPainelProps = {
  clinicId: string;
  dados: DadosDaIa;
  /** Os numeros da clinica, do painel (sem o telefone inteiro). */
  numeros: NumeroDoWhatsapp[];
  /** Os 4 ultimos digitos de cada numero, pelo id. */
  finais: Record<string, string | null>;
  /**
   * O agente da clinica esta habilitado (ia_clinica_habilitada em teste ou,
   * com a onda 2, em producao).
   */
  agenteHabilitado: boolean;
  /**
   * A conta esta suspensa: a clinica sai da lista do banco e a acao recusa
   * mudar numero e telefone, mesmo com o agente habilitado.
   */
  suspensa: boolean;
  /** T1 e T2 (producao com a chave e a clinica habilitada). */
  ambienteLigado: boolean;
  /** Relogio do servidor na carga (epoch ms): o horario do agente. */
  agoraMs: number;
  /** Fuso da clinica (CLAUDE.md 3.6). */
  fuso: string;
  /** Os ids dos telefones forcados (o dialogo de excluir); nulo: falhou. */
  telefonesForcados: string[] | null;
};

/**
 * Por que nada muda agora nos numeros e telefones: a conta suspensa, ou o
 * agente desligado (a clinica fora da lista do banco, e a acao recusa).
 * Nulo: muda.
 */
export function bloqueioDosCartoes(entrada: {
  agenteHabilitado: boolean;
  suspensa: boolean;
}): string | null {
  if (entrada.suspensa) {
    return TEXTOS_DO_PAINEL.suspensaNaoMudaNumeros;
  }
  return entrada.agenteHabilitado ? null : TEXTOS_DO_PAINEL.ligueOAgenteAntes;
}

/** A mesma dica em todos os controles. */
function dicasTravadas(dica: string): Record<AcaoDaIa, string | null> {
  return {
    modo: dica,
    escolha: dica,
    equipe: dica,
    producao: dica,
    numero: dica,
    telefone: dica,
    excluir: dica,
    forcar: dica,
    pausa: dica,
  };
}

export function CartoesDoAgenteNoPainel({
  clinicId,
  dados,
  numeros,
  finais,
  agenteHabilitado,
  suspensa,
  ambienteLigado,
  agoraMs,
  fuso,
  telefonesForcados,
}: CartoesDoAgenteNoPainelProps) {
  const { pendente, resultado, executar, ocupado } = useAcaoDaIa();
  const estado = estadoDaIa({ dados, numeros, ambienteLigado, agoraMs, fuso });
  const emProducao = escolhaAtual(dados.liberacao) === "producao";
  const bloqueio = bloqueioDosCartoes({ agenteHabilitado, suspensa });
  // Quem ve e sempre a equipe Conduzza: liga numero e usa o forcar.
  const dicas =
    bloqueio === null
      ? dicasDaIa({
          podeEditar: true,
          superAdmin: true,
          faltasParaAEquipe: faltasParaAEquipe(dados, numeros),
          emProducao,
        })
      : dicasTravadas(bloqueio);

  return (
    <div className="grid min-w-0 gap-4">
      <RegiaoDoResultado resultado={resultado} />
      {/* A dica de cada controle so abre no tooltip: travado, o porque
          tambem fica escrito. */}
      {bloqueio === null ? null : (
        <Aviso tom="info" role="note">
          {bloqueio}
        </Aviso>
      )}
      <CartaoDosNumeros
        noPainel
        dados={dados}
        numeros={numeros}
        estadoDoAssistente={estado}
        emProducao={emProducao}
        dicas={dicas}
        apoioDoDesligar={null}
        pendente={pendente}
        ocupado={ocupado}
        telefoneDoNumero={(numero) => {
          const final = finais[numero.id];
          return final ? `final ${final}` : null;
        }}
        aoAlternar={(numero, ligado) =>
          executar(
            `numero-${numero.id}`,
            () =>
              alternarNumeroDaIaAction({
                clinicId,
                whatsappAccountId: numero.id,
                ligado,
              }),
            ligado
              ? `Número ${numero.nome} ligado ao agente.`
              : `Número ${numero.nome} desligado do agente.`,
          )
        }
      />
      <CartaoDosTelefones
        noPainel
        dados={dados}
        numeros={numeros}
        estadoDoAssistente={estado}
        emProducao={emProducao}
        forcados={telefonesForcados ? new Set(telefonesForcados) : null}
        dicas={dicas}
        pendente={pendente}
        ocupado={ocupado}
        aoAlternar={(telefone, ligado) =>
          executar(
            `telefone-${telefone.id}`,
            () =>
              alternarTelefoneDaIaAction({
                clinicId,
                telefone: telefone.telefone,
                ligado,
              }),
            ligado ? "Telefone ligado." : "Telefone desligado.",
          )
        }
        aoExcluir={(telefone, { fechar }) =>
          executar(
            `excluir-${telefone.id}`,
            () => excluirTelefoneDaIaAction({ clinicId, id: telefone.id }),
            TEXTOS_DA_IA.telefoneExcluido,
            { sempre: fechar },
          )
        }
        aoAdicionar={(valores, depois) =>
          executar(
            "telefone-novo",
            () => adicionarTelefoneDaIaAction({ ...valores, clinicId }),
            "Telefone da equipe adicionado.",
            depois,
          )
        }
      />
    </div>
  );
}
