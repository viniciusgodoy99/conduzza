import {
  ArrowLeft,
  CalendarClock,
  Contact,
  LogIn,
  MessagesSquare,
  Smartphone,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";

import type { ContextoDaIa } from "@/components/agente/whatsapp/agente-de-ia";
import { AgenteDaClinica } from "@/components/painel-geral/agente-da-clinica";
import { CartoesDoAgenteNoPainel } from "@/components/painel-geral/cartoes-do-agente-no-painel";
import { ContaDaClinica } from "@/components/painel-geral/conta-da-clinica";
import { EquipeDaClinica } from "@/components/painel-geral/equipe-da-clinica";
import { GastoDaIa } from "@/components/painel-geral/gasto-da-ia";
import {
  contagemNoPainel,
  dataEHoraNaClinica,
  dataNaClinica,
  haQuantoTempo,
  quandoNaClinica,
  quemEntrou,
  textoDosNumeros,
  TEXTOS_DO_PAINEL,
  USO_DA_CLINICA_STATUS,
} from "@/components/painel-geral/painel-geral";
import { RequisitosDaProducaoCartao } from "@/components/painel-geral/requisitos-da-producao";
import { TetoDaIa } from "@/components/painel-geral/teto-da-ia";
import { Aviso } from "@/components/shared/aviso";
import { AvisoCelular } from "@/components/shared/aviso-celular";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import { PageHeader } from "@/components/shared/page-header";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import { corDoNumero } from "@/lib/domain/cor-do-numero";
import type { DadosDaIa } from "@/lib/queries/ia-liberacao";
import type {
  ClinicaNoPainel,
  EquipeNoPainel,
  RequisitosDaProducao,
  TetosDaIa,
} from "@/lib/queries/painel-geral";

// O detalhe de uma clinica no Painel geral (onda 1, decisao do dono de
// 20/10/2026; desde 26/10/2026, o acompanhamento de cliente): as metricas
// (o ultimo acesso da equipe primeiro, com quem entrou), a equipe da
// clinica com os Implementadores numa lista separada (P18-5), a conta
// (suspender e reativar), o agente (Desligado, Teste e Producao, sempre
// com o estado que a tela mostrava: o banco recusa a pagina velha), os
// requisitos da producao (onda 2, item 11), os numeros e os telefones do
// agente (os cartoes da aba WhatsApp da Tela 6, no modo do painel), o gasto
// contra o teto e o proprio teto. De paciente, so contagens; nome, e-mail,
// papel e ultimo acesso sao da equipe da clinica. A pagina
// (app/(app)/painel-geral/[clinicId]/page.tsx) le os dados; aqui so se
// desenha, e cada leitura de apoio que falhou mostra o erro no proprio
// cartao (nunca um cartao vazio que afirma o que nao leu). Server
// Component; os cartoes com acao sao filhos client.

/** Uma leitura de apoio: o valor, ou "erro" quando ela falhou. */
export type LeituraDoDetalhe<T> = T | "erro";

export type DetalheDaClinicaProps = {
  clinica: ClinicaNoPainel;
  /** A equipe da clinica e os Implementadores (equipe_da_clinica_no_painel). */
  equipe: LeituraDoDetalhe<EquipeNoPainel>;
  /** A liberacao, os numeros ligados, os telefones e a situacao do agente. */
  dados: LeituraDoDetalhe<DadosDaIa>;
  /** Nulo: a clinica ainda nao tem a linha de liberacao (nem teto). */
  tetos: LeituraDoDetalhe<TetosDaIa | null>;
  /**
   * So T1: a producao da Vercel com a chave da OpenAI e o segredo do
   * identificador (ambienteDaIaLigado). A parte da clinica (T2: agente
   * habilitado e conta ativa) vem da propria linha do painel
   * (agenteAtendeNoAmbiente).
   */
  ambienteDaIa: boolean;
  /**
   * O relogio da leitura do painel (epoch ms): o "Há N dias" do ultimo
   * acesso conta pelo mesmo relogio do "Em uso".
   */
  agoraMs: number;
  /** Os requisitos da producao (onda 2, item 11). */
  requisitos: LeituraDoDetalhe<RequisitosDaProducao>;
  /**
   * O publico da ultima versao publicada (o dialogo da producao). Nulo:
   * ainda nao escolhido ou nao deu para ler.
   */
  publicoPublicado: string | null;
  /** Os ids dos telefones forcados (o dialogo de excluir); nulo: falhou. */
  telefonesForcados: string[] | null;
  /** As versoes de agora do filtro e do modelo (P11e); nulas: sem aviso. */
  versoes: { filtro: string; modelo: string } | null;
};

/**
 * T1 e T2 pela linha do painel: o ambiente de pe, o agente da clinica
 * habilitado (em teste ou, com a onda 2, em producao) e a conta ativa (a
 * lista do banco, ia_clinicas_da_fase_controlada, tira a clinica suspensa).
 * Com isso, o motivo "servidor" da situacao so aparece quando o que falta e
 * o ambiente, e nunca culpa a chave da OpenAI por uma clinica desligada ou
 * suspensa (o painel ja diz isso no chip e no aviso do cartao do agente).
 */
export function agenteAtendeNoAmbiente(
  clinica: Pick<ClinicaNoPainel, "agente" | "suspensao">,
  ambienteDaIa: boolean,
): boolean {
  return (
    ambienteDaIa &&
    clinica.agente.estado !== "desligado" &&
    clinica.suspensao === null
  );
}

/**
 * Os numeros do painel no formato dos cartoes da aba (sem o telefone
 * inteiro: o painel so traz os 4 ultimos digitos, que vao em finais).
 */
export function numerosDosCartoes(clinica: ClinicaNoPainel): {
  numeros: NumeroDoWhatsapp[];
  finais: Record<string, string | null>;
} {
  const finais: Record<string, string | null> = {};
  const numeros = clinica.numeros.map((numero) => {
    finais[numero.id] = numero.final;
    return {
      id: numero.id,
      nome: numero.nome,
      principal: false,
      unitId: null,
      displayPhone: null,
      status: numero.conexao,
      connectedAt: null,
      provider: null,
      cor: corDoNumero(null),
    };
  });
  return { numeros, finais };
}

/**
 * Por que o teto nao muda agora: com a conta suspensa e a liberacao ligada,
 * a clinica sai da lista e o banco recusa (definir_teto_da_ia, P0001
 * clinica_suspensa). Nulo: muda (sem a linha, o proprio TetoDaIa explica).
 */
export function bloqueioDoTeto(
  clinica: Pick<ClinicaNoPainel, "agente" | "suspensao">,
): string | null {
  return clinica.suspensao !== null && clinica.agente.liberada
    ? TEXTOS_DO_PAINEL.suspensaNaoMudaOTeto
    : null;
}

export function VoltarParaOPainel() {
  return (
    <div>
      <Button asChild variant="ghost" className="-ml-2">
        <Link href="/painel-geral">
          <ArrowLeft aria-hidden />
          Voltar para o painel geral
        </Link>
      </Button>
    </div>
  );
}

export function DetalheDaClinica({
  clinica,
  equipe,
  dados,
  tetos,
  ambienteDaIa,
  agoraMs,
  requisitos,
  publicoPublicado,
  telefonesForcados,
  versoes,
}: DetalheDaClinicaProps) {
  const { numeros, finais } = numerosDosCartoes(clinica);
  const ambienteLigado = agenteAtendeNoAmbiente(clinica, ambienteDaIa);
  const contexto: ContextoDaIa | null =
    dados === "erro"
      ? null
      : { dados, numeros, ambienteLigado, agoraMs, fuso: clinica.fuso };
  const agora = new Date(agoraMs);
  const acesso = clinica.ultimoAcesso;

  return (
    <div className="mx-auto grid w-full max-w-content grid-cols-[minmax(0,1fr)] content-start gap-4 p-4 md:p-6">
      <VoltarParaOPainel />
      <PageHeader
        eyebrow={TEXTOS_DO_PAINEL.titulo}
        title={clinica.nome}
        description={`Criada em ${dataNaClinica(clinica.criadaEm, clinica.fuso)}. Fuso da clínica: ${clinica.fuso}.`}
      />
      <AvisoCelular />

      {/* Quatro por linha a partir de 1024px: o ultimo acesso ocupa duas
          colunas (diz quando e quem), e as oito vagas fecham em duas linhas.
          No celular, o ultimo acesso ocupa a linha inteira. */}
      <section
        aria-label="Movimento da clínica"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {acesso ? (
          <CartaoDeMetrica
            className="col-span-2"
            rotulo="Último acesso da equipe"
            icone={LogIn}
            tamanho="md"
            valor={haQuantoTempo(acesso.em, clinica.fuso, agora)}
            rodape={`${dataEHoraNaClinica(acesso.em, clinica.fuso)}, por ${quemEntrou(acesso)}`}
          >
            {clinica.emUso ? null : (
              <StatusChip
                size="sm"
                className="w-fit"
                definition={USO_DA_CLINICA_STATUS.sem_uso}
              />
            )}
          </CartaoDeMetrica>
        ) : (
          <CartaoDeMetrica
            className="col-span-2"
            rotulo="Último acesso da equipe"
            icone={LogIn}
            tamanho="md"
            estado="vazio"
            texto={TEXTOS_DO_PAINEL.ninguemEntrou}
          >
            <StatusChip
              size="sm"
              className="w-fit"
              definition={USO_DA_CLINICA_STATUS.sem_uso}
            />
          </CartaoDeMetrica>
        )}
        <CartaoDeMetrica
          rotulo="Equipe"
          icone={Users}
          valor={contagemNoPainel(clinica.membrosAtivos)}
          rodape={
            clinica.membrosPendentes > 0
              ? `${contagemNoPainel(clinica.membrosPendentes)} esperando liberação`
              : "Membros ativos"
          }
        />
        {clinica.numerosTotal === 0 ? (
          <CartaoDeMetrica
            rotulo="Números conectados"
            icone={Smartphone}
            estado="vazio"
            texto="Nenhum número"
          />
        ) : (
          <CartaoDeMetrica
            rotulo="Números conectados"
            icone={Smartphone}
            valor={textoDosNumeros(clinica)}
            rodape="Sem os removidos"
          />
        )}
        <CartaoDeMetrica
          rotulo="Contatos"
          icone={Contact}
          valor={contagemNoPainel(clinica.contatos)}
          rodape="Leads e pacientes"
        />
        <CartaoDeMetrica
          rotulo="Leads em 30 dias"
          icone={UserPlus}
          valor={contagemNoPainel(clinica.leads30Dias)}
        />
        <CartaoDeMetrica
          rotulo="Conversas em 30 dias"
          icone={MessagesSquare}
          valor={contagemNoPainel(clinica.conversas30Dias)}
        />
        {clinica.ultimaMensagemEm ? (
          <CartaoDeMetrica
            rotulo="Última mensagem recebida"
            icone={CalendarClock}
            tamanho="md"
            valor={quandoNaClinica(
              clinica.ultimaMensagemEm,
              clinica.fuso,
              new Date(agoraMs),
            )}
            rodape="No fuso da clínica"
          />
        ) : (
          <CartaoDeMetrica
            rotulo="Última mensagem recebida"
            icone={CalendarClock}
            tamanho="md"
            estado="vazio"
            texto="Nenhuma ainda"
          />
        )}
      </section>

      {equipe === "erro" ? (
        <Aviso tom="alert" role="note">
          {TEXTOS_DO_PAINEL.equipeSemLeitura}
        </Aviso>
      ) : (
        <EquipeDaClinica
          equipe={equipe}
          membrosAtivos={clinica.membrosAtivos}
          membrosPendentes={clinica.membrosPendentes}
          membrosEquipeConduzza={clinica.membrosEquipeConduzza}
          fuso={clinica.fuso}
          agoraMs={agoraMs}
        />
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid min-w-0 gap-4">
          <ContaDaClinica
            clinicId={clinica.id}
            nome={clinica.nome}
            fuso={clinica.fuso}
            suspensao={clinica.suspensao}
          />
          <AgenteDaClinica
            clinicId={clinica.id}
            nome={clinica.nome}
            estado={clinica.agente.estado}
            suspensa={clinica.suspensao !== null}
            tetoDiarioCentavos={clinica.tetoDiarioCentavos}
            contexto={contexto}
            requisitos={requisitos}
            publicoPublicado={publicoPublicado}
          />
          <RequisitosDaProducaoCartao
            clinicId={clinica.id}
            fuso={clinica.fuso}
            requisitos={requisitos}
            versoes={versoes}
            emProducao={clinica.agente.estado === "producao"}
          />
          {dados === "erro" ? (
            <Aviso tom="alert" role="note">
              Não foi possível carregar os números e os telefones do agente
              desta clínica. Recarregue a página.
            </Aviso>
          ) : (
            <CartoesDoAgenteNoPainel
              clinicId={clinica.id}
              dados={dados}
              numeros={numeros}
              finais={finais}
              agenteHabilitado={clinica.agente.estado !== "desligado"}
              suspensa={clinica.suspensao !== null}
              ambienteLigado={ambienteLigado}
              agoraMs={agoraMs}
              fuso={clinica.fuso}
              telefonesForcados={telefonesForcados}
            />
          )}
        </div>
        <div className="grid min-w-0 gap-4">
          <GastoDaIa
            gasto={clinica.gasto}
            tetoDiarioCentavos={clinica.tetoDiarioCentavos}
          />
          {tetos === "erro" ? (
            <Aviso tom="alert" role="note">
              Não foi possível carregar o teto de gasto. Recarregue a página.
            </Aviso>
          ) : (
            <TetoDaIa
              clinicId={clinica.id}
              tetos={tetos}
              bloqueio={bloqueioDoTeto(clinica)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
