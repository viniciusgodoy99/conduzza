import { ErroDoPainel } from "@/components/painel-geral/erro-do-painel";
import { ListaDoPainel } from "@/components/painel-geral/lista-do-painel";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { TotaisDoPainel } from "@/components/painel-geral/totais-do-painel";
import { AvisoCelular } from "@/components/shared/aviso-celular";
import { PageHeader } from "@/components/shared/page-header";
import { fetchPainelGeral, type PainelGeral } from "@/lib/queries/painel-geral";
import { createClient } from "@/lib/supabase/server";

// Painel geral (onda 1, decisao do dono de 20/10/2026): todas as clinicas do
// sistema, so para a equipe Conduzza (a guarda e o layout desta rota). Uma
// leitura so (painel_geral_das_clinicas, SECURITY DEFINER e so do super
// admin): os totais do topo e a lista, com busca e filtros no cliente. So
// contagens, nenhum dado de paciente, entao nada vai para a trilha de
// leitura de paciente. Erro de leitura vira o estado de erro com "Tentar de
// novo", nunca uma lista vazia.
export default async function PainelGeralPage() {
  const supabase = await createClient();
  let painel: PainelGeral | null = null;
  try {
    painel = await fetchPainelGeral(supabase);
  } catch {
    painel = null;
  }

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
          <ListaDoPainel
            clinicas={painel.clinicas}
            agoraIso={new Date().toISOString()}
          />
        </>
      ) : (
        <ErroDoPainel />
      )}
    </div>
  );
}
