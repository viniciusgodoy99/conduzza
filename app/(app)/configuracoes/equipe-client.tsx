"use client";

import { Check, Copy, RefreshCw, X } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ROLE_OPTIONS } from "@/lib/domain/permissions";

import {
  alternarCodigoAction,
  aprovarMembroAction,
  gerarNovoCodigoAction,
  recusarMembroAction,
} from "./actions";

export type Pendente = {
  userId: string;
  nome: string;
  email: string;
};

export function PendentesList({
  pendentes,
  podeGerenciar,
  ehAdmin,
}: {
  pendentes: Pendente[];
  podeGerenciar: boolean;
  /** gestor libera colega, mas nao consegue liberar ninguem como administrador */
  ehAdmin: boolean;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [papeis, setPapeis] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  if (pendentes.length === 0) {
    return null;
  }

  const executar = (task: () => Promise<{ ok: boolean; error?: string }>) => {
    setErro(null);
    startTransition(async () => {
      const resultado = await task();
      if (!resultado.ok) {
        setErro(resultado.error ?? "Algo deu errado.");
      }
    });
  };

  return (
    <div className="grid gap-3 rounded-lg border [border-color:var(--warning)] p-4 [background:var(--warning-bg)]">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-semibold [color:var(--warning-text)]">
          {pendentes.length === 1
            ? "1 pessoa aguardando liberação"
            : `${pendentes.length} pessoas aguardando liberação`}
        </h3>
        <p className="text-[12.5px] text-text-secondary">
          Entraram com o código da clínica. Enquanto não forem liberadas, não
          veem nenhuma conversa de paciente.
        </p>
      </div>
      <ul className="grid gap-2">
        {pendentes.map((pessoa) => (
          <li
            key={pessoa.userId}
            className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3"
          >
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm font-medium">
                {pessoa.nome}
              </span>
              <span className="truncate text-xs text-text-tertiary">
                {pessoa.email}
              </span>
            </span>
            <Select
              value={papeis[pessoa.userId] ?? "recepcao"}
              onValueChange={(valor) =>
                setPapeis((atual) => ({ ...atual, [pessoa.userId]: valor }))
              }
              disabled={!podeGerenciar || pending}
            >
              <SelectTrigger className="h-10 w-40" aria-label="Papel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((papel) => {
                  const soAdmin = papel.value === "admin" && !ehAdmin;
                  return (
                    <SelectItem
                      key={papel.value}
                      value={papel.value}
                      disabled={soAdmin}
                    >
                      {soAdmin
                        ? `${papel.label} (só um administrador libera)`
                        : papel.label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!podeGerenciar || pending}
              onClick={() =>
                executar(() =>
                  aprovarMembroAction(
                    pessoa.userId,
                    papeis[pessoa.userId] ?? "recepcao",
                  ),
                )
              }
            >
              <Check strokeWidth={1.5} className="size-4" />
              Liberar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!podeGerenciar || pending}
              onClick={() => executar(() => recusarMembroAction(pessoa.userId))}
            >
              <X strokeWidth={1.5} className="size-4" />
              Recusar
            </Button>
          </li>
        ))}
      </ul>
      {erro ? (
        <p role="alert" className="text-[12.5px] [color:var(--alert-text)]">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

export function CodigoAcesso({
  codigo,
  ativo,
  podeGerenciar,
}: {
  codigo: string;
  ativo: boolean;
  podeGerenciar: boolean;
}) {
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const executar = (task: () => Promise<{ ok: boolean; error?: string }>) => {
    setErro(null);
    startTransition(async () => {
      const resultado = await task();
      if (!resultado.ok) {
        setErro(resultado.error ?? "Algo deu errado.");
      }
    });
  };

  return (
    <div className="grid gap-3 border-t pt-6">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-semibold">Código da clínica</h3>
        <p className="text-[12.5px] text-text-secondary">
          Quem tem este código pode pedir entrada na clínica pelo cadastro. O
          acesso só abre depois que você liberar aqui.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-muted px-3 py-2 font-mono text-sm tracking-[0.3em]">
          {ativo ? codigo : "desativado"}
        </code>
        <Button
          variant="outline"
          size="sm"
          disabled={!ativo}
          onClick={() => {
            void navigator.clipboard.writeText(codigo);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          }}
        >
          <Copy strokeWidth={1.5} className="size-4" />
          {copiado ? "Copiado" : "Copiar"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!podeGerenciar || pending}
          onClick={() => executar(gerarNovoCodigoAction)}
        >
          <RefreshCw strokeWidth={1.5} className="size-4" />
          Gerar novo
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor="allow-code" className="text-[12.5px]">
            Aceitar entrada por código
          </Label>
          <Switch
            id="allow-code"
            checked={ativo}
            disabled={!podeGerenciar || pending}
            onCheckedChange={(valor) =>
              executar(() => alternarCodigoAction(valor))
            }
          />
        </div>
      </div>
      <p className="text-xs text-text-tertiary">
        Gerar um código novo invalida o anterior na hora. Se o código vazar, use
        isso.
      </p>
      {erro ? (
        <p role="alert" className="text-[12.5px] [color:var(--alert-text)]">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
