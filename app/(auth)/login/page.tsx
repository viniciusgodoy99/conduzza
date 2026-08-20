import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const context = await getSessionContext();
  if (context) {
    // Sempre para /inicio: o layout da area logada decide o que mostrar
    // (clinica, escolha, espera ou criacao). Redirecionar para
    // /selecionar-clinica aqui criava laco com aquela pagina.
    redirect("/inicio");
  }
  return <LoginForm />;
}
