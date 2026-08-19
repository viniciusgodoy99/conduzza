"use client";

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

const initialState: ActionState = {};

const ROLE_OPTIONS = [
  { value: "admin", label: "Administrador" },
  { value: "gestor", label: "Gestor" },
  { value: "recepcao", label: "Recepção" },
  { value: "profissional", label: "Profissional" },
  { value: "leitura", label: "Somente leitura" },
];

export function InviteForm({
  canInvite,
  hint,
}: {
  canInvite: boolean;
  hint: string | null;
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
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <div className="grid gap-2">
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
        <div className="grid gap-2">
          <Label htmlFor="invite-role">Papel</Label>
          <Select name="role" defaultValue="recepcao" disabled={!canInvite}>
            <SelectTrigger id="invite-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {state.error ? (
        <p role="alert" className="text-alert-text text-sm">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-success-text text-sm">
          {state.success}
        </p>
      ) : null}
      <div>
        {canInvite || !hint ? (
          submit
        ) : (
          <DisabledWithHint hint={hint}>{submit}</DisabledWithHint>
        )}
      </div>
    </form>
  );
}
