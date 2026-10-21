"use client";

import {
  adicionarTelefoneDaIaAction,
  alternarNumeroDaIaAction,
  alternarTelefoneDaIaAction,
} from "@/app/(app)/configuracoes/ia-liberacao-actions";
import {
  dicasDaIa,
  estadoDaIa,
  faltasParaAEquipe,
  type AcaoDaIa,
} from "@/components/configuracoes/agente-de-ia";
import {
  CartaoDosNumeros,
  CartaoDosTelefones,
  RegiaoDoResultado,
  useAcaoDaIa,
} from "@/components/configuracoes/agente-de-ia-tab";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { Aviso } from "@/components/shared/aviso";
import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import type { DadosDaIa } from "@/lib/queries/ia-liberacao";

// Os numeros e os telefones da equipe do agente de UMA clinica, pelo Painel
// geral (onda 1): os mesmos cartoes da aba Agente de IA de Configuracoes, no
// modo do painel (noPainel), com as acoes levando o clinicId da tela. So a
// equipe Conduzza chega aqui (layout da rota), e a acao e o banco conferem
// de novo. Com o agente da clinica desligado ou a conta suspensa (a clinica
// sai da lista do banco), tudo fica visivel e desabilitado, com o porque
// escrito e na dica: a acao recusa mudar numero e telefone de clinica fora
// da lista.

export type CartoesDoAgenteNoPainelProps = {
  clinicId: string;
  dados: DadosDaIa;
  /** Os numeros da clinica, do painel (sem o telefone inteiro). */
  numeros: NumeroDoWhatsapp[];
  /** Os 4 ultimos digitos de cada numero, pelo id. */
  finais: Record<string, string | null>;
  /** O agente da clinica esta em teste (ia_clinica_habilitada). */
  agenteEmTeste: boolean;
  /**
   * A conta esta suspensa: a clinica sai da lista do banco e a acao recusa
   * mudar numero e telefone, mesmo com o agente em teste.
   */
  suspensa: boolean;
  /** T1 e T2 (producao com a chave e a clinica habilitada). */
  ambienteLigado: boolean;
  /** Relogio do servidor na carga (epoch ms): o horario do agente. */
  agoraMs: number;
  /** Fuso da clinica (CLAUDE.md 3.6). */
  fuso: string;
};

/**
 * Por que nada muda agora nos numeros e telefones: a conta suspensa, ou o
 * agente desligado (a clinica fora da lista do banco, e a acao recusa).
 * Nulo: muda.
 */
export function bloqueioDosCartoes(entrada: {
  agenteEmTeste: boolean;
  suspensa: boolean;
}): string | null {
  if (entrada.suspensa) {
    return TEXTOS_DO_PAINEL.suspensaNaoMudaNumeros;
  }
  return entrada.agenteEmTeste ? null : TEXTOS_DO_PAINEL.ligueOAgenteAntes;
}

/** A mesma dica em todos os controles. */
function dicasTravadas(dica: string): Record<AcaoDaIa, string | null> {
  return {
    escolha: dica,
    equipe: dica,
    numero: dica,
    telefone: dica,
    interruptor: dica,
  };
}

export function CartoesDoAgenteNoPainel({
  clinicId,
  dados,
  numeros,
  finais,
  agenteEmTeste,
  suspensa,
  ambienteLigado,
  agoraMs,
  fuso,
}: CartoesDoAgenteNoPainelProps) {
  const { pendente, resultado, executar, ocupado } = useAcaoDaIa();
  const estado = estadoDaIa({ dados, numeros, ambienteLigado, agoraMs, fuso });
  const bloqueio = bloqueioDosCartoes({ agenteEmTeste, suspensa });
  // Quem ve e sempre a equipe Conduzza: liga numero e usa o forcar.
  const dicas =
    bloqueio === null
      ? dicasDaIa({
          podeEditar: true,
          superAdmin: true,
          faltasParaAEquipe: faltasParaAEquipe(dados, numeros),
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
        superAdmin
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
        aoAdicionar={(valores, { limpar, pedirConfirmacao, pedirForcar }) =>
          executar(
            "telefone-novo",
            () => adicionarTelefoneDaIaAction({ ...valores, clinicId }),
            "Telefone da equipe adicionado.",
            {
              seDerCerto: limpar,
              sePedirConfirmacao: pedirConfirmacao,
              sePedirForcar: pedirForcar,
            },
          )
        }
      />
    </div>
  );
}
