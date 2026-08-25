import { redirect } from "next/navigation";

import { AvisoCelular } from "@/components/shared/aviso-celular";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { createT } from "@/lib/branding/labels";
import { fetchCatalogo } from "@/lib/queries/catalogo";
import { fetchPacientes } from "@/lib/queries/pacientes";
import { createClient } from "@/lib/supabase/server";

import { PacientesClient } from "./pacientes-client";

// Tela 9, Pacientes: quem ja teve pelo menos uma consulta. A lista sai de UMA
// chamada da RPC pacientes_resumo (agrega consulta e pacote no banco); o
// catalogo entra so pelos nomes de profissional do filtro, porque o nome do
// convenio ja vem da RPC. A RLS recorta por clinica; a matriz de papeis
// decide quem edita a ficha.
export default async function PacientesPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();

  // Regra 3.1: a tela mostra nome, telefone e historico de consulta (dado de
  // saude); a leitura vai para a trilha, com throttle no helper. Sem await:
  // nao atrasa a renderizacao.
  void auditarLeituraDePaciente(supabase, {
    clinicId: active.clinicId,
    userId: context.userId,
    entity: "pacientes",
  });

  const [pacientes, catalogo] = await Promise.all([
    fetchPacientes(supabase, active.clinicId),
    fetchCatalogo(supabase, active.clinicId),
  ]);

  const t = createT(active.labels);
  const titulo = t("paciente", { plural: true, capitalize: true });

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title={titulo}
        description={`A lista traz quem já teve pelo menos uma ${t("consulta")}. Quem ainda não agendou fica em Leads.`}
      />
      <AvisoCelular />
      <PacientesClient
        clinicId={active.clinicId}
        timezone={active.timezone}
        pacientesIniciais={pacientes}
        convenios={catalogo.convenios.map((convenio) => ({
          id: convenio.id,
          name: convenio.name,
        }))}
        profissionais={catalogo.profissionais.map((profissional) => ({
          id: profissional.id,
          name: profissional.name,
        }))}
      />
    </div>
  );
}
