import { PasswordForm } from "@/app/(auth)/components/password-form";

export default function RedefinirSenhaPage() {
  return (
    <PasswordForm
      title="Redefinir senha"
      description="Escolha uma senha nova para a sua conta."
      submitLabel="Salvar nova senha"
    />
  );
}
