"use client";

import { CircleCheck, OctagonAlert } from "lucide-react";
import { useActionState, useState } from "react";

import { inviteMemberAction, type ActionState } from "@/app/(auth)/actions";
import {
  AVISO_DO_IMPLEMENTADOR,
  papelSoDoAdminPleno,
  rotuloDaOpcao,
} from "@/components/configuracoes/papel-na-equipe";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OPCOES_DE_PAPEL, type PapelNaTela } from "@/lib/domain/permissions";

const initialState: ActionState = {};

// Convite nominal por e-mail: o vinculo ja nasce ativo. Conta que ja existe
// entra direto, sem e-mail de convite, mas a resposta aqui e a MESMA do
// convite de conta nova (achados L17/L20): a tela nao confirma a quem convida
// que o e-mail tem cadastro. O gestor convida, mas nunca como administrador:
// a opcao fica visivel e desabilitada, como na liberacao de pedidos.
//
// Implementador (onda 5, item 18): so o administrador pleno convida (o
// gestor e o proprio Implementador veem a opcao desabilitada, com o porque),
// e escolher o papel mostra o aviso fixo de LGPD: a clinica decide quem ve
// os dados dos pacientes.
export function InviteForm({
  canInvite,
  hint,
  ehAdminPleno,
}: {
  canInvite: boolean;
  hint: string | null;
  /**
   * administrador sem a marca de Implementador: so ele convida
   * administrador e Implementador
   */
  ehAdminPleno: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    inviteMemberAction,
    initialState,
  );
  const [papel, setPapel] = useState<PapelNaTela>("recepcao");

  const submit = (
    <Button type="submit" disabled={!canInvite || pending}>
      {pending ? "Enviando..." : "Convidar por e-mail"}
    </Button>
  );

  return (
    <form action={formAction} className="grid gap-3">
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
        <div className="grid gap-1.5">
          <Label htmlFor="invite-email">E-mail</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            disabled={!canInvite}
            placeholder="nome@suaclinica.com.br"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="invite-role">Papel</Label>
          <Select
            name="role"
            value={papel}
            onValueChange={(valor) => setPapel(valor as PapelNaTela)}
            disabled={!canInvite}
          >
            <SelectTrigger id="invite-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPCOES_DE_PAPEL.map((option) => {
                const travada =
                  papelSoDoAdminPleno(option.value) && !ehAdminPleno;
                return (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    disabled={travada}
                  >
                    {rotuloDaOpcao(option.value, travada, "convidar")}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div>
          {canInvite || !hint ? (
            submit
          ) : (
            <DisabledWithHint hint={hint}>{submit}</DisabledWithHint>
          )}
        </div>
      </div>
      {papel === "implementador" ? (
        <Aviso tom="warning" role="note">
          {AVISO_DO_IMPLEMENTADOR}
        </Aviso>
      ) : null}
      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 text-[13px] text-alert-text"
        >
          <OctagonAlert aria-hidden className="mt-px size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p
          role="status"
          className="flex items-start gap-1.5 text-[13px] text-success-text"
        >
          <CircleCheck aria-hidden className="mt-px size-4 shrink-0" />
          {state.success}
        </p>
      ) : null}
    </form>
  );
}
