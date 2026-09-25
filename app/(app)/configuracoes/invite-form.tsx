"use client";

import { CircleCheck, OctagonAlert } from "lucide-react";
import { useActionState } from "react";

import { inviteMemberAction, type ActionState } from "@/app/(auth)/actions";
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
import { ROLE_OPTIONS } from "@/lib/domain/permissions";

const initialState: ActionState = {};

// Convite nominal por e-mail: o vinculo ja nasce ativo. Conta que ja existe
// entra direto, sem e-mail de convite, mas a resposta aqui e a MESMA do
// convite de conta nova (achados L17/L20): a tela nao confirma a quem convida
// que o e-mail tem cadastro. O gestor convida, mas nunca como administrador:
// a opcao fica visivel e desabilitada, como na liberacao de pedidos.
export function InviteForm({
  canInvite,
  hint,
  ehAdmin,
}: {
  canInvite: boolean;
  hint: string | null;
  /** so o administrador convida outro administrador */
  ehAdmin: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    inviteMemberAction,
    initialState,
  );

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
          <Select name="role" defaultValue="recepcao" disabled={!canInvite}>
            <SelectTrigger id="invite-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((option) => {
                const soAdmin = option.value === "admin" && !ehAdmin;
                return (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    disabled={soAdmin}
                  >
                    {soAdmin
                      ? `${option.label} (só um administrador convida)`
                      : option.label}
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
