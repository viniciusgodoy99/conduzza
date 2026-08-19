import Image from "next/image";

// Layout de autenticacao no estilo do handoff: painel esquerdo escuro com o
// logo branco, painel direito com o formulario de 380px.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-[44%] flex-col justify-between p-10 [background:var(--sidebar)] md:flex">
        <Image
          src="/brand/conduzza-logo-branca.webp"
          alt="Conduzza"
          width={132}
          height={20}
          priority
          className="h-auto w-[132px]"
        />
        <div className="grid gap-3">
          <h1 className="max-w-md text-3xl leading-tight font-semibold text-white">
            Atendimento por IA no WhatsApp da sua clínica
          </h1>
          <p className="max-w-md text-sm leading-relaxed [color:var(--sidebar-foreground)]">
            Responde 24 horas, agenda, confirma consulta e devolve para a
            recepção o que precisa de gente.
          </p>
        </div>
        <span className="text-xs [color:var(--sidebar-muted)]">
          Conduzza Clínicas
        </span>
      </aside>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}
