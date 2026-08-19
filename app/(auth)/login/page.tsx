import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const context = await getSessionContext();
  if (context) {
    redirect(context.active ? "/inicio" : "/selecionar-clinica");
  }
  return <LoginForm />;
}
