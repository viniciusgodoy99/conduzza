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
    redirect(context.active ? "/inicio" : "/selecionar-clinica");
  }
  const { tipo } = await searchParams;
  return <CadastroForm tipoInicial={tipo} />;
}
