import { ErroDoPainel } from "@/components/painel-geral/erro-do-painel";
import { FaixaDeSaude } from "@/components/painel-geral/faixa-de-saude";
import { InterruptorGeral } from "@/components/painel-geral/interruptor-geral";
import { ListaDoPainel } from "@/components/painel-geral/lista-do-painel";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { TotaisDoPainel } from "@/components/painel-geral/totais-do-painel";
import { AvisoCelular } from "@/components/shared/aviso-celular";
import { PageHeader } from "@/components/shared/page-header";
import { fetchPainelGeral, type PainelGeral } from "@/lib/queries/painel-geral";
import { createClient } from "@/lib/supabase/server";

// Painel geral (onda 1, decisao do dono de 20/10/2026; desde 26/10/2026, o
// acompanhamento de cliente): todas as clinicas do sistema, so para a
// equipe Conduzza (a guarda e o layout desta rota). Uma leitura so
// (painel_cs_das_clinicas, SECURITY DEFINER e so do super admin): os
// cartoes do topo e a lista, com busca e filtros no cliente. De paciente, so
// contagens; nome e e-mail sao da equipe da clinica (dado de operacao),
// entao nada vai para a trilha de leitura de paciente. Erro de leitura vira
// o estado de erro com "Tentar de novo", nunca uma lista vazia.
//
// Os cartoes do topo vem primeiro (o retrato das clinicas); o interruptor
// geral do agente (onda 2, decisao P8) continua no topo da lista, logo
// abaixo deles. O estado dele vem do banco pela sessao
// (ia_interruptor_ligado, so o booleano); leitura que falhou vira o aviso
// do cartao, sem derrubar o painel.
//
// Segunda leva (26/10/2026): logo abaixo dos cartoes de hoje, a faixa da
// saude (Saudavel, Atencao e Em risco, de todas as clinicas da leitura),
// que filtra a lista no clique. Sem a leitura, nem a faixa: nunca uma
// contagem que nao foi lida.

/** O interruptor geral; nulo: a leitura falhou. Nunca lanca. */
async function lerInterruptor(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc("ia_interruptor_ligado");
    return error || typeof data !== "boolean" ? null : data;
  } catch {
    return null;
  }
}

export default async function PainelGeralPage() {
  const supabase = await createClient();
  const [painel, interruptor] = await Promise.all([
    fetchPainelGeral(supabase).catch((): PainelGeral | null => null),
    lerInterruptor(supabase),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-content grid-cols-[minmax(0,1fr)] content-start gap-4 p-4 md:p-6">
      <PageHeader
        eyebrow={TEXTOS_DO_PAINEL.eyebrow}
        title={TEXTOS_DO_PAINEL.titulo}
        description={TEXTOS_DO_PAINEL.descricao}
      />
      <AvisoCelular />
      {painel ? (
        <>
          <TotaisDoPainel totais={painel.totais} />
          <FaixaDeSaude contagem={painel.totais.saude} />
          <InterruptorGeral ligado={interruptor} />
          {/* "Hoje" e "Há N dias" pelo relogio da leitura, o mesmo do
              "Em uso". */}
          <ListaDoPainel
            clinicas={painel.clinicas}
            agoraIso={painel.geradoEm}
          />
        </>
      ) : (
        <>
          <InterruptorGeral ligado={interruptor} />
          <ErroDoPainel />
        </>
      )}
    </div>
  );
}
