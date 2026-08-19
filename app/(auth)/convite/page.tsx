import { PasswordForm } from "@/app/(auth)/components/password-form";

export default function ConvitePage() {
  return (
    <PasswordForm
      title="Bem-vindo"
      description="Você foi convidado para a clínica. Defina sua senha para entrar."
      submitLabel="Definir senha e entrar"
    />
  );
}
