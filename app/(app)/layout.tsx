import { AppShell } from "@/components/shell/app-shell";

// Layout da area logada.
// INTERINO ate a conexao com o Supabase: sem banco nao ha sessao, entao o
// shell renderiza com um visitante de desenvolvimento fixo. A tarefa 0.5
// substitui este bloco por sessao real, clinica ativa validada em
// clinic_member e redirecionamento para /login.
const DEV_VIEWER = {
  name: "Visitante de desenvolvimento",
  role: "admin" as const,
  roleLabel: "Administrador",
  clinicName: "Clínica de demonstração",
  productName: "Conduzza Clínicas",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell viewer={DEV_VIEWER}>{children}</AppShell>;
}
