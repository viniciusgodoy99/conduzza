"use client";

import {
  CalendarDays,
  CircleCheck,
  CircleSlash,
  Eye,
  Pencil,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatarCentavos, lerReais } from "@/lib/utils/moeda";

// Pecas minimas compartilhadas pelas abas de Cadastros.

// Acao de escrita: visivel sempre; desabilitada com dica quando o papel nao
// edita (regra do brief: esconder confunde, desabilitar explica). Alvo de
// toque minimo de 40px (h-10) em qualquer tamanho.
export function BotaoProtegido({
  podeEditar,
  dica,
  onClick,
  children,
  variant = "default",
  size = "default",
  className,
  disabled = false,
}: {
  podeEditar: boolean;
  dica: string;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
  disabled?: boolean;
}) {
  const classe = cn("h-10", className);
  if (podeEditar) {
    return (
      <Button
        variant={variant}
        size={size}
        onClick={onClick}
        className={classe}
        disabled={disabled}
      >
        {children}
      </Button>
    );
  }
  return (
    <DisabledWithHint hint={dica}>
      <Button variant={variant} size={size} disabled className={classe}>
        {children}
      </Button>
    </DisabledWithHint>
  );
}

// Acoes da linha de uma tabela de Cadastros. Quem edita ve o lapis. Quem so
// ve (achado 41) ganha "Ver detalhes", que abre o mesmo painel em modo
// leitura, e o lapis continua visivel e desabilitado com a dica do papel.
export function AcoesDaLinha({
  podeEditar,
  dica,
  nome,
  aoEditar,
  aoVerDetalhes,
}: {
  podeEditar: boolean;
  dica: string;
  nome: string;
  aoEditar: () => void;
  aoVerDetalhes?: () => void;
}) {
  if (podeEditar) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-10"
        onClick={aoEditar}
        aria-label={`Editar ${nome}`}
      >
        <Pencil className="size-4" />
      </Button>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1">
      {aoVerDetalhes ? (
        <Button
          variant="ghost"
          className="h-10"
          onClick={aoVerDetalhes}
          aria-label={`Ver detalhes de ${nome}`}
        >
          <Eye className="size-4" /> Ver detalhes
        </Button>
      ) : null}
      <DisabledWithHint hint={dica}>
        <Button
          variant="ghost"
          size="icon"
          className="size-10"
          disabled
          aria-label={`Editar ${nome}`}
        >
          <Pencil className="size-4" />
        </Button>
      </DisabledWithHint>
    </div>
  );
}

// Painel em modo leitura: rotulo e valor em texto corrido, sem truncar
// (preparo e observacoes podem ser longos e a recepcao responde por eles).
export function DetalheSomenteLeitura({
  itens,
}: {
  itens: { rotulo: string; valor: React.ReactNode }[];
}) {
  return (
    <dl className="grid gap-4 py-4">
      {itens.map((item) => (
        <div key={item.rotulo} className="grid gap-1">
          <dt className="text-xs font-medium text-text-secondary">
            {item.rotulo}
          </dt>
          <dd className="text-sm break-words whitespace-pre-wrap">
            {item.valor === null ||
            item.valor === undefined ||
            item.valor === "" ? (
              <span className="text-text-tertiary">Não informado</span>
            ) : (
              item.valor
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Aviso de consultas ja marcadas no periodo afetado (achado 37): bloqueio e
// desativacao nao desmarcam nada, entao a tela conta, avisa e so segue com
// confirmacao explicita. Datas no fuso da clinica (regra 3.6).
export function AvisoDeConsultas({
  consultas,
  primeira,
  timezone,
  rotuloConfirmar,
  confirmando,
  aoConfirmar,
}: {
  consultas: number;
  primeira: string | null;
  timezone: string;
  rotuloConfirmar: string;
  confirmando: boolean;
  aoConfirmar: () => void;
}) {
  const quando = primeira
    ? `${new Date(primeira).toLocaleDateString("pt-BR", {
        timeZone: timezone,
        day: "2-digit",
        month: "2-digit",
      })} às ${new Date(primeira).toLocaleTimeString("pt-BR", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : null;
  return (
    <div
      role="alert"
      className="grid gap-3 rounded-lg border border-[color:var(--warning)] bg-[color:var(--warning-bg)] p-3"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert
          className="mt-0.5 size-4 shrink-0 [color:var(--warning-text)]"
          aria-hidden
        />
        <div className="grid gap-1 text-sm">
          <p className="font-medium">
            {consultas === 1
              ? "Há 1 consulta marcada neste período. Remarque ou cancele."
              : `Há ${consultas} consultas marcadas neste período. Remarque ou cancele.`}
          </p>
          <p className="text-text-secondary">
            {quando ? `A primeira é em ${quando}. ` : ""}
            Esta ação não desmarca nada: as consultas continuam valendo e os
            lembretes continuam saindo para os pacientes.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" className="h-10">
          <Link href="/agenda">
            <CalendarDays className="size-4" /> Abrir a Agenda
          </Link>
        </Button>
        <Button
          variant="ghost"
          className="h-10"
          onClick={aoConfirmar}
          disabled={confirmando}
        >
          {confirmando ? "Salvando..." : rotuloConfirmar}
        </Button>
      </div>
    </div>
  );
}

// Situacao ativo/inativo nas 3 camadas (icone de forma distinta, rotulo em
// texto e cor). Nunca so cor.
export function ChipSituacao({ active }: { active: boolean }) {
  const Icone = active ? CircleCheck : CircleSlash;
  const chip = chipAtivo(active);
  return (
    <span className={cn("inline-flex items-center gap-1.5", chip.classe)}>
      <Icone className="size-4 shrink-0" aria-hidden />
      {chip.texto}
    </span>
  );
}

// Previa do valor em reais ao lado do campo (achado 34): quem digita "250.00"
// ve "R$ 250,00" antes de salvar, e o que nao da para ler vira aviso em
// texto, nao um valor 100 vezes maior gravado em silencio.
export function PreviaDeReais({ texto, id }: { texto: string; id?: string }) {
  const centavos = lerReais(texto);
  if (centavos === null) {
    return null;
  }
  if (centavos === undefined) {
    return (
      <p
        id={id}
        aria-live="polite"
        className="text-xs [color:var(--alert-text)]"
      >
        Não entendemos este valor. Use o formato 250,00.
      </p>
    );
  }
  return (
    <p
      id={id}
      aria-live="polite"
      className="font-mono text-xs text-text-secondary tabular-nums"
    >
      Será salvo como {formatarCentavos(centavos)}
    </p>
  );
}

export function chipAtivo(active: boolean): {
  texto: string;
  classe: string;
} {
  // Estado com rotulo em texto, nunca so cor.
  return active
    ? { texto: "Ativo", classe: "text-[color:var(--success-text)]" }
    : { texto: "Inativo", classe: "text-text-tertiary" };
}
