import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";

import { CadastroForm } from "./cadastro-form";

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>;
}) {
  const context = await getSessionContext();
  if (context) {
    // Sempre para /inicio: o layout da area logada decide o que mostrar
    // (clinica, escolha, espera ou criacao). Redirecionar para
    // /selecionar-clinica aqui criava laco com aquela pagina.
    redirect("/inicio");
  }
  const { tipo } = await searchParams;
  return <CadastroForm tipoInicial={tipo} />;
}
