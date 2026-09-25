import Image from "next/image";

import { MARCA_PADRAO } from "@/lib/branding/marca-padrao";

// Layout de autenticacao do Conduzza Design System (docs/06 secao 5.13, C36):
// tela dividida. A coluna da marca fica em ink nos dois temas (a mesma pele
// da sidebar, "chrome e marketing: ink com lime" do DS) e o formulario segue
// o tema ativo, claro por padrao. No celular a coluna some e sobra uma faixa
// ink de 56px com o lockup: login, confirmacao e senha nova precisam
// funcionar no celular, porque e nele que a pessoa abre o e-mail.
//
// So o lockup para fundo escuro existe (C34): nenhum lugar poe a marca sobre
// fundo claro. O slogan e um <p>, nao um h1: cada pagina ja tem o seu h1.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <header className="flex h-14 shrink-0 items-center bg-sidebar px-4 md:hidden">
        <Image
          src={MARCA_PADRAO.lockupFundoEscuro}
          alt={MARCA_PADRAO.nomeDoProduto}
          width={146}
          height={24}
          priority
          className="h-6 w-auto"
        />
      </header>
      <aside className="hidden w-[44%] max-w-[640px] shrink-0 flex-col justify-between border-r border-(--sidebar-border) bg-sidebar p-10 md:flex">
        <Image
          src={MARCA_PADRAO.lockupFundoEscuro}
          alt={MARCA_PADRAO.nomeDoProduto}
          width={170}
          height={28}
          priority
          className="h-7 w-auto"
        />
        <div className="grid max-w-[30rem] gap-4">
          <p className="text-[32px] leading-[1.06] font-bold tracking-[-0.025em] text-balance text-sidebar-strong">
            Atendimento por IA no WhatsApp da sua clínica
          </p>
          <p className="text-[15px] leading-[1.55] text-(--sidebar-foreground)">
            Responde 24 horas, agenda, confirma consulta e devolve para a
            recepção o que precisa de gente.
          </p>
        </div>
        <p className="text-xs text-sidebar-muted">
          {MARCA_PADRAO.nomeDoProduto}
        </p>
      </aside>
      <main className="flex flex-1 items-start justify-center px-4 py-8 md:items-center md:p-10">
        <div className="w-full max-w-[400px] rounded-card border border-border bg-card p-6 shadow-sm md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
