"use client";

import { CircleSlash, UserMinus, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  desativarMembroAction,
  mudarPapelAction,
  reativarMembroAction,
} from "@/app/(app)/configuracoes/actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_OPTIONS } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/permissions";

// Lista da equipe da clinica: quem tem acesso, com qual papel, e quem esta
// com o acesso desativado (fica no fim, esmaecido e com chip). Tirar acesso
// nao apaga ninguem: o vinculo vira inativo e volta com um clique.
//
// Tres travas, iguais as do banco, aqui so para explicar antes de tentar:
// ninguem mexe na propria linha, gestor nao mexe em administrador, e o unico
// administrador ativo nao pode ser rebaixado nem desativado.

export type MembroEquipe = {
  userId: string;
  nome: string;
  email: string;
  papel: Role;
  /** false = acesso tirado, reversivel */
  ativo: boolean;
};

function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0] ?? "")
    .join("")
    .toUpperCase();
}

export function ListaEquipe({
  membros,
  meuUserId,
  podeGerenciar,
  ehAdmin,
  dica,
}: {
  membros: MembroEquipe[];
  meuUserId: string;
  podeGerenciar: boolean;
  ehAdmin: boolean;
  dica: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmar, setConfirmar] = useState<MembroEquipe | null>(null);

  const adminsAtivos = membros.filter(
    (membro) => membro.ativo && membro.papel === "admin",
  );
  const unicoAdminId =
    adminsAtivos.length === 1 ? (adminsAtivos[0]?.userId ?? null) : null;

  // Devolve o motivo de a acao estar travada, ou null quando ela esta liberada.
  const motivo = (
    membro: MembroEquipe,
    acao: "papel" | "acesso",
  ): string | null => {
    if (!podeGerenciar) {
      return dica;
    }
    if (membro.userId === meuUserId) {
      return acao === "papel"
        ? "Você não altera o próprio papel"
        : "Você não tira o próprio acesso";
    }
    if (!ehAdmin && membro.papel === "admin") {
      return "Somente um administrador altera o acesso de outro administrador";
    }
    if (membro.userId === unicoAdminId) {
      return "A clínica precisa de pelo menos um administrador ativo";
    }
    return null;
  };

  const executar = (
    task: () => Promise<{ ok: boolean; error?: string }>,
    sucesso: string,
    falha: string,
  ) => {
    startTransition(async () => {
      const resultado = await task();
      if (!resultado.ok) {
        toast.error(resultado.error ?? falha);
        return;
      }
      toast.success(sucesso);
    });
  };

  const confirmarDesativacao = () => {
    const alvo = confirmar;
    if (!alvo) {
      return;
    }
    startTransition(async () => {
      const resultado = await desativarMembroAction({ user_id: alvo.userId });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível tirar o acesso.");
        return;
      }
      setConfirmar(null);
      toast.success(`${alvo.nome} ficou sem acesso`);
    });
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-semibold">Quem trabalha nesta clínica</h3>
        <p className="text-[12.5px] text-text-secondary">
          O papel decide o que cada pessoa vê e altera. Tirar o acesso não apaga
          nada: o histórico fica e você devolve o acesso quando quiser.
        </p>
      </div>

      <ul className="grid gap-2">
        {membros.map((membro) => {
          const motivoPapel = motivo(membro, "papel");
          const motivoAcesso = motivo(membro, "acesso");

          const seletor = (
            <Select
              value={membro.papel}
              onValueChange={(valor) =>
                executar(
                  () =>
                    mudarPapelAction({ user_id: membro.userId, papel: valor }),
                  `Papel de ${membro.nome} atualizado`,
                  "Não foi possível mudar o papel.",
                )
              }
              disabled={motivoPapel !== null || pending}
            >
              <SelectTrigger
                className="h-10 w-44"
                aria-label={`Papel de ${membro.nome}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opcao) => (
                  <SelectItem key={opcao.value} value={opcao.value}>
                    {opcao.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );

          const botao = (
            <Button
              variant="outline"
              className="h-10"
              disabled={motivoAcesso !== null || pending}
              onClick={() =>
                membro.ativo
                  ? setConfirmar(membro)
                  : executar(
                      () => reativarMembroAction({ user_id: membro.userId }),
                      `${membro.nome} voltou a ter acesso`,
                      "Não foi possível devolver o acesso.",
                    )
              }
            >
              {membro.ativo ? (
                <UserMinus strokeWidth={1.5} className="size-4" />
              ) : (
                <UserPlus strokeWidth={1.5} className="size-4" />
              )}
              {membro.ativo ? "Tirar acesso" : "Reativar"}
            </Button>
          );

          return (
            <li
              key={membro.userId}
              className={`flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2 ${
                membro.ativo ? "" : "opacity-70"
              }`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {iniciais(membro.nome)}
              </span>
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-sm font-medium">
                  {membro.nome}
                  {membro.userId === meuUserId ? (
                    <span className="font-normal text-text-tertiary">
                      {" "}
                      (você)
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-xs text-text-tertiary">
                  {membro.email}
                </span>
              </span>

              {membro.ativo ? null : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-text-tertiary">
                  <CircleSlash strokeWidth={1.5} className="size-3.5" />
                  Sem acesso
                </span>
              )}

              {motivoPapel ? (
                <DisabledWithHint hint={motivoPapel}>
                  {seletor}
                </DisabledWithHint>
              ) : (
                seletor
              )}
              {motivoAcesso ? (
                <DisabledWithHint hint={motivoAcesso}>{botao}</DisabledWithHint>
              ) : (
                botao
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={confirmar !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setConfirmar(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Tirar o acesso de {confirmar?.nome ?? "esta pessoa"}?
            </DialogTitle>
            <DialogDescription>
              A pessoa perde o acesso à clínica na hora, inclusive às conversas
              de paciente. Nada é apagado: o histórico dela continua aqui e você
              pode devolver o acesso quando quiser.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="h-10"
              onClick={() => setConfirmar(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="h-10"
              disabled={pending}
              onClick={confirmarDesativacao}
            >
              {pending ? "Tirando..." : "Tirar acesso"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
