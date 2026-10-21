import { notFound } from "next/navigation";

import {
  DetalheDaClinica,
  VoltarParaOPainel,
} from "@/components/painel-geral/detalhe-da-clinica";
import { ErroDoPainel } from "@/components/painel-geral/erro-do-painel";
import { ambienteDaIaLigado } from "@/lib/ia/liberacao";
import { fetchLiberacaoDaIa } from "@/lib/queries/ia-liberacao";
import {
  fetchClinicaDoPainel,
  fetchTetosDaIa,
} from "@/lib/queries/painel-geral";
import { createClient } from "@/lib/supabase/server";

// Detalhe de uma clinica no Painel geral (onda 1, decisao do dono de
// 20/10/2026), so para a equipe Conduzza (a guarda e o layout da rota). Aqui
// so se le; o desenho e o DetalheDaClinica (components/painel-geral).
//
// A linha da clinica vem do painel (painel_geral_das_clinicas, obrigatoria:
// sem ela, o estado de erro com "Tentar de novo"; fora do painel, o
// not-found). As leituras do agente (a liberacao, os numeros ligados, os
// telefones da equipe e a situacao) sao as mesmas da aba de Configuracoes,
// com a sessao: o super admin le pelas policies proprias, sem ser membro da
// clinica. Cada uma que falha tira so o cartao que dependia dela. Nenhuma
// le dado de paciente. Do ambiente, so T1 (ambienteDaIaLigado): a clinica
// estar habilitada sai da propria linha do painel.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O valor da leitura, ou "erro" quando ela lancou. */
async function ouErro<T>(promessa: Promise<T>): Promise<T | "erro"> {
  try {
    return await promessa;
  } catch {
    return "erro";
  }
}

export default async function DetalheDaClinicaNoPainelPage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;
  if (!UUID.test(clinicId)) {
    notFound();
  }

  const supabase = await createClient();
  const [clinica, dados, tetos] = await Promise.all([
    ouErro(fetchClinicaDoPainel(supabase, clinicId)),
    ouErro(fetchLiberacaoDaIa(supabase, clinicId)),
    ouErro(fetchTetosDaIa(supabase, clinicId)),
  ]);

  if (clinica === "erro") {
    return (
      <div className="mx-auto grid w-full max-w-content content-start gap-4 p-4 md:p-6">
        <VoltarParaOPainel />
        <ErroDoPainel titulo="Não foi possível carregar esta clínica" />
      </div>
    );
  }
  if (!clinica) {
    notFound();
  }

  // So o ambiente (T1) vem daqui: a parte da clinica (agente em teste e
  // conta ativa) sai da propria linha do painel (agenteAtendeNoAmbiente).
  return (
    <DetalheDaClinica
      clinica={clinica}
      dados={dados}
      tetos={tetos}
      ambienteDaIa={ambienteDaIaLigado()}
      agoraMs={Date.now()}
    />
  );
}
