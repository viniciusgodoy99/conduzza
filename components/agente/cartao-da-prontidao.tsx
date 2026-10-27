import { CircleAlert, CircleCheck, Info } from "lucide-react";
import Link from "next/link";

import { Aviso } from "@/components/shared/aviso";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { StatusDefinition } from "@/lib/design/status";
import {
  linkDaAbaDoCadastro,
  pendenciasDaProntidao,
  type PendenciaDoCadastro,
  type ProntidaoDoCadastro,
} from "@/lib/domain/cadastro-para-o-agente";

// Cartao "Prontidao do cadastro" da Tela 6 (cadastro para o agente, AG1):
// so leitura, com o que falta no Cadastro para o assistente atender e
// marcar consultas (prontidao_do_cadastro_da_ia: so contagens e nomes de
// cadastro) e o link para a aba de Cadastros certa. Sem pendencia, "Cadastro
// pronto para o agente.". So para quem configura o agente (administrador,
// gestor e super admin; o banco recusa os outros): a pagina nem le para a
// recepcao. Status nas 3 camadas, com os icones da tabela de reservados:
// CircleCheck sucesso, CircleAlert atencao, Info informacao. Server
// Component: nada aqui roda no navegador.

export const TEXTOS_DA_PRONTIDAO = {
  titulo: "Prontidão do cadastro",
  descricao:
    "O que o assistente precisa encontrar no Cadastro para atender e marcar consultas. Confere de novo a cada vez que a página abre.",
  pronto: "Cadastro pronto para o agente.",
  erro: "Não foi possível conferir o cadastro.",
  erroDescricao: "Recarregue a página. Se continuar, fale com o suporte.",
  informativo: "Informativo",
} as const;

export const STATUS_DA_PRONTIDAO: {
  pronto: StatusDefinition;
  pendente: (pendencias: number) => StatusDefinition;
} = {
  pronto: { label: "Pronto", tone: "success", icon: CircleCheck },
  pendente: (pendencias) => ({
    label: pendencias === 1 ? "1 pendência" : `${pendencias} pendências`,
    tone: "warning",
    icon: CircleAlert,
  }),
};

function LinhaDaPendencia({ pendencia }: { pendencia: PendenciaDoCadastro }) {
  const informativo = pendencia.tipo === "informativo";
  const Icone = informativo ? Info : CircleAlert;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl bg-surface-subtle px-3.5 py-3">
      <span className="flex min-w-0 flex-1 basis-64 items-start gap-2.5">
        <Icone
          aria-hidden
          className={
            informativo
              ? "mt-px size-[17px] shrink-0 text-info-text"
              : "mt-px size-[17px] shrink-0 text-warning-text"
          }
        />
        <span className="min-w-0 text-[13px] leading-[1.45] break-words text-foreground">
          {informativo ? (
            <span className="font-semibold text-info-text">
              {TEXTOS_DA_PRONTIDAO.informativo}:{" "}
            </span>
          ) : null}
          {pendencia.texto}
        </span>
      </span>
      <Button asChild variant="outline" className="shrink-0">
        <Link href={linkDaAbaDoCadastro(pendencia.aba)}>
          {pendencia.rotuloDoLink}
        </Link>
      </Button>
    </li>
  );
}

export function CartaoDaProntidao({
  prontidao,
}: {
  /** Nulo: a leitura falhou (o cartao diz isso, nunca "pronto"). */
  prontidao: ProntidaoDoCadastro | null;
}) {
  const todas = prontidao ? pendenciasDaProntidao(prontidao) : [];
  const pendencias = todas.filter((p) => p.tipo === "pendencia");
  const informativos = todas.filter((p) => p.tipo === "informativo");
  const status =
    prontidao === null
      ? null
      : pendencias.length === 0
        ? STATUS_DA_PRONTIDAO.pronto
        : STATUS_DA_PRONTIDAO.pendente(pendencias.length);

  return (
    <Card role="region" aria-labelledby="agente-prontidao-titulo">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id="agente-prontidao-titulo">
              {TEXTOS_DA_PRONTIDAO.titulo}
            </CardTitle>
            <CardDescription>{TEXTOS_DA_PRONTIDAO.descricao}</CardDescription>
          </div>
          {status ? <StatusChip definition={status} /> : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        {prontidao === null ? (
          <Aviso tom="alert" role="note" titulo={TEXTOS_DA_PRONTIDAO.erro}>
            {TEXTOS_DA_PRONTIDAO.erroDescricao}
          </Aviso>
        ) : pendencias.length === 0 ? (
          <p className="flex items-center gap-2.5 text-[13.5px] font-semibold text-success-text">
            <CircleCheck aria-hidden className="size-[17px] shrink-0" />
            {TEXTOS_DA_PRONTIDAO.pronto}
          </p>
        ) : null}
        {todas.length > 0 ? (
          <ul className="grid gap-2" aria-label={TEXTOS_DA_PRONTIDAO.titulo}>
            {[...pendencias, ...informativos].map((pendencia) => (
              <LinhaDaPendencia key={pendencia.chave} pendencia={pendencia} />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
