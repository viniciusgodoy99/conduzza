import { Users } from "lucide-react";
import { useId } from "react";

import {
  contagemNoPainel,
  dataEHoraNaClinica,
  haQuantoTempo,
  papelDaPessoa,
  SITUACAO_DO_MEMBRO_STATUS,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  EquipeNoPainel,
  PessoaDaEquipe,
} from "@/lib/queries/painel-geral";

// A equipe da clinica no detalhe do Painel geral (acompanhamento de
// cliente, 26/10/2026): cada pessoa com o nome, o e-mail (link de e-mail,
// 40px), o papel, a situacao (Ativa, Pendente, Inativa, em 3 camadas) e o
// ultimo acesso dela (ha quanto tempo e o dia e a hora no fuso da clinica);
// os Implementadores numa lista separada, abaixo (P18-5 da onda 5: ate aqui
// o Implementador aparecia entre os administradores). Quem e da equipe
// Conduzza aparece marcado; com vinculo ativo, conta no uso e nas contagens
// como qualquer pessoa da equipe (o desenho: "dos membros ATIVOS"), e a
// descricao diz quantas das ativas sao dela. O ultimo acesso de cada pessoa
// e a ultima atividade dela (o login ou a renovacao da sessao, decisao do
// dono de 26/10/2026). Ordem do banco: situacao, papel e nome. E dado da
// EQUIPE da clinica, nunca de paciente. Server Component.

export function textoDaEquipe(
  ativos: number,
  pendentes: number,
  daEquipeConduzza = 0,
): string {
  const membros =
    ativos === 1
      ? "1 membro ativo"
      : `${contagemNoPainel(ativos)} membros ativos`;
  const comConduzza =
    daEquipeConduzza > 0
      ? `${membros} (${contagemNoPainel(daEquipeConduzza)} da equipe Conduzza)`
      : membros;
  if (pendentes === 0) {
    return `${comConduzza}.`;
  }
  return pendentes === 1
    ? `${comConduzza} e 1 pedido de entrada esperando liberação.`
    : `${comConduzza} e ${contagemNoPainel(pendentes)} pedidos de entrada esperando liberação.`;
}

export function EquipeDaClinica({
  equipe,
  membrosAtivos,
  membrosPendentes,
  membrosEquipeConduzza = 0,
  fuso,
  agoraMs,
}: {
  equipe: EquipeNoPainel;
  /** As contagens da lista (a equipe Conduzza ativa inclusive). */
  membrosAtivos: number;
  membrosPendentes: number;
  /** Das ativas, quantas sao da equipe Conduzza. */
  membrosEquipeConduzza?: number;
  /** clinic.timezone: o ultimo acesso no relogio da clinica. */
  fuso: string;
  /** O relogio da leitura do painel (epoch ms). */
  agoraMs: number;
}) {
  const id = useId();
  const agora = new Date(agoraMs);
  const temEquipeConduzza = [...equipe.equipe, ...equipe.implementadores].some(
    (pessoa) => pessoa.equipeConduzza,
  );
  return (
    <Card role="region" aria-labelledby={`${id}-titulo`}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
          >
            <Users className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={`${id}-titulo`}>
              {TEXTOS_DO_PAINEL.equipeTitulo}
            </CardTitle>
            <CardDescription>
              {textoDaEquipe(
                membrosAtivos,
                membrosPendentes,
                membrosEquipeConduzza,
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        <section aria-labelledby={`${id}-equipe`} className="grid gap-2">
          <p id={`${id}-equipe`} className="cz-eyebrow text-text-secondary">
            {TEXTOS_DO_PAINEL.equipeLista}
          </p>
          {equipe.equipe.length === 0 ? (
            <p className="text-[13px] text-text-secondary">
              {TEXTOS_DO_PAINEL.equipeVazia}
            </p>
          ) : (
            <TabelaDePessoas
              rotuloId={`${id}-equipe`}
              pessoas={equipe.equipe}
              comPapel
              fuso={fuso}
              agora={agora}
            />
          )}
          <p className="text-[12px] text-text-secondary">
            {TEXTOS_DO_PAINEL.ultimoAcessoEAtividade}
          </p>
          {temEquipeConduzza ? (
            <p className="text-[12px] text-text-secondary">
              {TEXTOS_DO_PAINEL.equipeConduzzaExplicacao}
            </p>
          ) : null}
        </section>
        <section
          aria-labelledby={`${id}-implementadores`}
          className="grid gap-2"
        >
          <p
            id={`${id}-implementadores`}
            className="cz-eyebrow text-text-secondary"
          >
            {TEXTOS_DO_PAINEL.implementadoresTitulo}
          </p>
          <p className="text-[12px] text-text-secondary">
            {TEXTOS_DO_PAINEL.implementadoresDescricao}
          </p>
          {equipe.implementadores.length === 0 ? (
            <p className="text-[13px] text-text-secondary">
              {TEXTOS_DO_PAINEL.nenhumImplementador}
            </p>
          ) : (
            <TabelaDePessoas
              rotuloId={`${id}-implementadores`}
              pessoas={equipe.implementadores}
              comPapel={false}
              fuso={fuso}
              agora={agora}
            />
          )}
        </section>
      </CardContent>
    </Card>
  );
}

/**
 * Uma tabela de pessoas. Os Implementadores nao tem a coluna Papel: todos
 * sao administradores com a marca, e a lista ja diz o que sao. No celular,
 * so a tabela rola para o lado, dentro do cartao.
 */
function TabelaDePessoas({
  rotuloId,
  pessoas,
  comPapel,
  fuso,
  agora,
}: {
  rotuloId: string;
  pessoas: PessoaDaEquipe[];
  comPapel: boolean;
  fuso: string;
  agora: Date;
}) {
  return (
    <Table
      aria-labelledby={rotuloId}
      containerClassName="rounded-lg border border-border"
    >
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Pessoa</TableHead>
          {comPapel ? <TableHead scope="col">Papel</TableHead> : null}
          <TableHead scope="col">Situação</TableHead>
          <TableHead scope="col">Último acesso</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pessoas.map((pessoa) => (
          <TableRow key={pessoa.userId}>
            <TableCell className="min-w-[200px] py-2 whitespace-normal">
              <div className="grid justify-items-start gap-0.5">
                <span className="font-semibold break-words text-text-strong">
                  {pessoa.nome ?? TEXTOS_DO_PAINEL.semNomeNoPerfil}
                </span>
                {pessoa.email ? (
                  <a
                    href={`mailto:${pessoa.email}`}
                    className="inline-flex min-h-10 items-center text-[13px] break-all text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {pessoa.email}
                  </a>
                ) : null}
                {pessoa.equipeConduzza ? (
                  <span className="text-[12px] font-semibold text-text-secondary">
                    {TEXTOS_DO_PAINEL.equipeConduzzaMarca}
                  </span>
                ) : null}
              </div>
            </TableCell>
            {comPapel ? (
              <TableCell className="py-2">{papelDaPessoa(pessoa)}</TableCell>
            ) : null}
            <TableCell className="py-2">
              <StatusChip
                size="sm"
                definition={SITUACAO_DO_MEMBRO_STATUS[pessoa.situacao]}
              />
            </TableCell>
            <TableCell className="py-2">
              {pessoa.ultimoAcessoEm ? (
                <div className="grid gap-0.5">
                  <span className="text-text-strong">
                    {haQuantoTempo(pessoa.ultimoAcessoEm, fuso, agora)}
                  </span>
                  <span className="cz-num text-[12px] text-text-secondary">
                    {dataEHoraNaClinica(pessoa.ultimoAcessoEm, fuso)}
                  </span>
                </div>
              ) : (
                <span className="text-text-secondary">
                  {TEXTOS_DO_PAINEL.nuncaEntrou}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
