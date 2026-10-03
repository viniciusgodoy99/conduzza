import { redirect } from "next/navigation";

import { AvisoCelular } from "@/components/shared/aviso-celular";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import {
  fetchCatalogo,
  fetchMatrizDeConvenios,
  fetchUsoDosPacotes,
} from "@/lib/queries/catalogo";
import { createClient } from "@/lib/supabase/server";

import { redirecionamentoDeAbaQueSaiu } from "./abas";
import { CadastrosClient } from "./cadastros-client";

// Tela 8, Cadastros (tarefa 2.2): as cinco abas do catalogo clinico (lista
// e motivo em ./abas). Escrita so de administrador e gestor; recepcao e
// demais papeis VEEM tudo, com as acoes visiveis e desabilitadas com dica
// (nunca escondidas).
export default async function CadastrosPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string | string[] }>;
}) {
  const { aba } = await searchParams;
  // Link antigo para uma aba que saiu (29/09/2026): vai para onde o assunto
  // mora agora, antes de buscar o catalogo.
  const destino = redirecionamentoDeAbaQueSaiu(aba);
  if (destino) {
    redirect(destino);
  }

  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  // O uso dos pacotes e um detalhe de uma aba: se falhar, a tela carrega o
  // resto e a aba Pacotes tenta de novo no navegador (e mostra o erro se
  // continuar falhando), em vez de derrubar Cadastros inteiro.
  // A matriz de convenios (quem atende e o que cobre) NAO tem .catch, de
  // proposito: vazia por erro, os modais do Profissional e do Procedimento
  // abririam sem os convenios gravados e o proximo Salvar os apagaria. Se
  // falhar, a tela cai no erro de (app), como o catalogo.
  const [catalogo, matriz, usoDosPacotes] = await Promise.all([
    fetchCatalogo(supabase, active.clinicId),
    fetchMatrizDeConvenios(supabase, active.clinicId),
    fetchUsoDosPacotes(supabase, active.clinicId).catch(() => null),
  ]);

  const podeEditar = canEdit(active.role, "cadastros");
  const dica = permissionHint(active.role, "cadastros");

  return (
    <div className="mx-auto grid w-full max-w-content content-start gap-4 p-6">
      <PageHeader
        eyebrow="Administração"
        title="Cadastros"
        description="Profissionais, procedimentos e quem faz cada um, convênios, pacotes e unidades da clínica"
      />
      {/* Tela de computador (brief secao 6): no celular so avisa, nada trava */}
      <AvisoCelular />
      <CadastrosClient
        clinicId={active.clinicId}
        catalogoInicial={catalogo}
        matrizInicial={matriz}
        usoDosPacotesInicial={usoDosPacotes}
        abaInicial={typeof aba === "string" ? aba : undefined}
        podeEditar={podeEditar}
        dica={dica ?? "Seu perfil não altera os cadastros"}
        timezone={active.timezone}
      />
    </div>
  );
}
