import { describe, expect, it } from "vitest";

import type { Membership } from "@/lib/auth/active-clinic";
import {
  entradaNaAreaDaEquipe,
  temClinicaAtiva,
  vaiDiretoParaOPainel,
} from "@/lib/auth/area-da-equipe";

// A escolha de para onde a pessoa vai (decisao do dono de 03/11/2026, "Conta
// propria so para o painel"), sem I/O:
// - vaiDiretoParaOPainel: o super admin sem nenhum vinculo ATIVO vai direto
//   para o Painel geral (o layout da clinica redireciona); com vinculo ativo
//   (as contas antigas), entra na clinica como antes; quem nao e super admin
//   nunca vai; leitura que falhou nao decide nada;
// - entradaNaAreaDaEquipe: a guarda da area do super admin (sem sessao, o
//   login; leitura que falhou, o erro; quem nao e super admin, o Inicio; o
//   super admin fica, com "Abrir a clinica" so com vinculo ativo).

function vinculo(status: Membership["status"], id = "a"): Membership {
  return {
    clinicId: `${id}0000000-0000-4000-8000-000000000001`,
    clinicName: `Clínica ${id}`,
    slug: "",
    timezone: "America/Fortaleza",
    role: "admin",
    implementador: false,
    status,
    productName: "Conduzza Clínicas",
    primaryColor: "#B2E54F",
    labels: null,
  };
}

function sessao(
  isProductAdmin: boolean,
  memberships: Membership[],
  vinculoIndisponivel = false,
) {
  return { isProductAdmin, memberships, vinculoIndisponivel };
}

describe("temClinicaAtiva", () => {
  it("só o vínculo ativo conta (pendente e suspensa não)", () => {
    expect(temClinicaAtiva({ memberships: [] })).toBe(false);
    expect(temClinicaAtiva({ memberships: [vinculo("pendente")] })).toBe(false);
    expect(temClinicaAtiva({ memberships: [vinculo("suspensa")] })).toBe(false);
    expect(
      temClinicaAtiva({
        memberships: [vinculo("pendente"), vinculo("ativo", "b")],
      }),
    ).toBe(true);
  });
});

describe("vaiDiretoParaOPainel (a entrada pelo layout da clínica)", () => {
  it("super admin sem vínculo nenhum (a conta do painel): vai", () => {
    expect(vaiDiretoParaOPainel(sessao(true, []))).toBe(true);
  });

  it("super admin só com vínculo pendente: vai (pendente não é clínica)", () => {
    expect(vaiDiretoParaOPainel(sessao(true, [vinculo("pendente")]))).toBe(
      true,
    );
  });

  it("super admin com uma ou mais clínicas ativas (as contas antigas): fica na clínica", () => {
    expect(vaiDiretoParaOPainel(sessao(true, [vinculo("ativo")]))).toBe(false);
    expect(
      vaiDiretoParaOPainel(
        sessao(true, [vinculo("ativo"), vinculo("ativo", "b")]),
      ),
    ).toBe(false);
  });

  it("quem não é super admin nunca vai, com ou sem clínica", () => {
    expect(vaiDiretoParaOPainel(sessao(false, []))).toBe(false);
    expect(vaiDiretoParaOPainel(sessao(false, [vinculo("ativo")]))).toBe(false);
    expect(vaiDiretoParaOPainel(sessao(false, [vinculo("pendente")]))).toBe(
      false,
    );
  });

  it("leitura dos vínculos que falhou: não decide nada (o layout mostra o erro)", () => {
    expect(vaiDiretoParaOPainel(sessao(true, [], true))).toBe(false);
  });
});

describe("entradaNaAreaDaEquipe (a guarda da área do super admin)", () => {
  it("sem sessão: o login", () => {
    expect(entradaNaAreaDaEquipe(null)).toEqual({ destino: "login" });
  });

  it("quem não é super admin: o Início, com ou sem clínica", () => {
    expect(entradaNaAreaDaEquipe(sessao(false, []))).toEqual({
      destino: "inicio",
    });
    expect(entradaNaAreaDaEquipe(sessao(false, [vinculo("ativo")]))).toEqual({
      destino: "inicio",
    });
  });

  it("leitura que falhou: o erro, antes de decidir (nem painel nem Início)", () => {
    expect(entradaNaAreaDaEquipe(sessao(false, [], true))).toEqual({
      destino: "indisponivel",
    });
    expect(entradaNaAreaDaEquipe(sessao(true, [], true))).toEqual({
      destino: "indisponivel",
    });
  });

  it("a conta do painel (sem clínica): fica, sem Abrir a clínica", () => {
    expect(entradaNaAreaDaEquipe(sessao(true, []))).toEqual({
      destino: "painel",
      abrirClinica: false,
    });
    expect(entradaNaAreaDaEquipe(sessao(true, [vinculo("pendente")]))).toEqual({
      destino: "painel",
      abrirClinica: false,
    });
  });

  it("a conta antiga (super admin e membro ativo): fica, com Abrir a clínica", () => {
    expect(entradaNaAreaDaEquipe(sessao(true, [vinculo("ativo")]))).toEqual({
      destino: "painel",
      abrirClinica: true,
    });
  });
});
