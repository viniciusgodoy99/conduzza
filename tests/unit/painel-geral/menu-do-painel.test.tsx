import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O item "Painel geral" do menu (onda 1): so a equipe Conduzza (super admin)
// o ve, qualquer que seja o papel na clinica ativa. Item com moduleKey null
// apareceria para TODOS os papeis sem a flag soSuperAdmin: o teste renderiza
// o AppShell de verdade (o filtro itemsForRole vive nele) com e sem o super
// admin, em todos os papeis. A rota tem a propria guarda no servidor
// (app/(app)/painel-geral/layout.tsx).

vi.mock("next/navigation", () => ({
  usePathname: () => "/inicio",
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/shell/use-contadores-do-menu", () => ({
  useContadoresDoMenu: ({
    iniciais,
  }: {
    iniciais: { conversas: number; confirmacoes: number };
  }) => iniciais,
}));
vi.mock("@/app/(auth)/actions", () => ({
  signOutAction: vi.fn(),
  pickClinicAction: vi.fn(),
}));

import { AppShell } from "@/components/shell/app-shell";
import { ROLE_LABELS, type Role } from "@/lib/domain/permissions";
import { NAV_ITEMS, itemDaRota } from "@/lib/navigation";

const PAPEIS: Role[] = [
  "admin",
  "gestor",
  "recepcao",
  "profissional",
  "leitura",
];

function shell(role: Role, superAdmin: boolean | undefined): string {
  return renderToStaticMarkup(
    <AppShell
      viewer={{
        name: "Vinicius",
        role,
        roleLabel: ROLE_LABELS[role],
        clinicName: "teste123",
        productName: "Conduzza Clínicas",
      }}
      clinicId="acd9c539-585e-4f2a-a195-712c70099564"
      timezone="America/Fortaleza"
      counts={{ conversas: 0, confirmacoes: 0 }}
      {...(superAdmin === undefined ? {} : { superAdmin })}
    >
      <p>conteúdo</p>
    </AppShell>,
  );
}

describe("item Painel geral no menu", () => {
  it("está no menu com a flag da equipe Conduzza, no bloco Administração", () => {
    const item = NAV_ITEMS.find((i) => i.href === "/painel-geral");
    expect(item).toMatchObject({
      label: "Painel geral",
      group: "administracao",
      moduleKey: null,
      soSuperAdmin: true,
    });
    expect(itemDaRota("/painel-geral")?.href).toBe("/painel-geral");
    expect(
      itemDaRota("/painel-geral/acd9c539-585e-4f2a-a195-712c70099564")?.href,
    ).toBe("/painel-geral");
    // So ele e da equipe Conduzza; o Inicio continua para todos.
    expect(NAV_ITEMS.filter((i) => i.soSuperAdmin).map((i) => i.href)).toEqual([
      "/painel-geral",
    ]);
  });

  it.each(PAPEIS)("papel %s sem super admin: o item não aparece", (papel) => {
    const saida = shell(papel, false);
    expect(saida).not.toContain('href="/painel-geral"');
    expect(saida).not.toContain("Painel geral");
    // O menu continua de pe (o Inicio e de todos).
    expect(saida).toContain('href="/inicio"');
  });

  it("sem a prop (o padrão do AppShell): o item não aparece", () => {
    expect(shell("admin", undefined)).not.toContain('href="/painel-geral"');
  });

  it.each(PAPEIS)("papel %s com super admin: o item aparece", (papel) => {
    const saida = shell(papel, true);
    expect(saida).toContain('href="/painel-geral"');
    expect(saida).toContain("Painel geral");
  });
});
