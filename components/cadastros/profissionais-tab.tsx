"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { BriefcaseMedical, Plus, Sunrise, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  salvarJornadaAction,
  salvarProfissionalAction,
  type CadastroActionResult,
  type ResumoDosConvenios,
} from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  AcoesDaLinha,
  AvatarDoProfissional,
  AvisoDeConsultas,
  BotaoProtegido,
  CampoDeMarcar,
  ChipSituacao,
  DetalheSomenteLeitura,
  PainelDeCadastro,
  RodapeDeSalvar,
  useFocoAoAparecer,
  useFocoDeVoltaAoSalvar,
  VazioDaAba,
} from "@/components/cadastros/comum";
import { ListaDeConvenios } from "@/components/cadastros/lista-de-convenios";
import { Aviso } from "@/components/shared/aviso";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
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
import {
  AJUDA_CONVENIOS_QUE_ATENDE,
  conveniosQueAtendeNaAbertura,
  fraseDeQuemDeixaDeFazer,
  frasesDoResumoDosConvenios,
  MENSAGEM_CADASTRO_MUDOU,
  opcoesDosConveniosQueAtende,
  precisaSalvarConvenios,
  previaDosConveniosDoProfissional,
  ROTULO_CONVENIOS_QUE_ATENDE,
  ROTULO_TIRAR_CONVENIO,
  tituloDoAvisoDosConvenios,
  VAZIO_CONVENIOS_QUE_ATENDE,
  type ConveniosNaAbertura,
  type NomesDoResumo,
} from "@/lib/domain/convenios-do-medico";
import { especialidadesParaSalvar } from "@/lib/domain/profissionais";
import {
  WEEKDAY_LABELS,
  type Catalogo,
  type Profissional,
} from "@/lib/queries/catalogo";

type FormProfissional = {
  id?: string;
  name: string;
  council_type: string;
  council_number: string;
  specialties: string[];
  calendar_color: string;
  active: boolean;
};

type FaixaForm = {
  chave: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  unit_id: string | null;
};

// Constante de dominio, nao de interface: e a cor de agenda que um
// profissional novo recebe (dado gravado em professional.calendar_color, que
// a clinica troca no seletor). Por isso e o unico hex do arquivo (docs/06
// secao 5.11).
const COR_PADRAO = "#84cc16";

const FORM_VAZIO: FormProfissional = {
  name: "",
  council_type: "",
  council_number: "",
  specialties: [],
  calendar_color: COR_PADRAO,
  active: true,
};

function horaCurta(valor: string): string {
  // O banco devolve "HH:MM:SS"; o input type="time" quer "HH:MM".
  return valor.slice(0, 5);
}

// Fim antes do inicio e uma janela que VIRA O DIA (plantao 22:00 as 02:00),
// prevista no modelo de dados (catalogo_clinico.sql e scheduling.ts). A tela
// diz isso em texto e pede confirmacao ao salvar, para uma inversao por
// engano (18:00 as 08:00) nao virar plantao calado (achado 43).
//
// Fim 00:00 NAO e plantao: e "ate a meia-noite". O motor (scheduling.ts e
// vaga_de_espera_indisponivel no banco) leva esse fim para 00:00 do dia
// seguinte, entao o ultimo horario termina exatamente a meia-noite e nenhum
// comeca depois dela. O campo de hora nao aceita 24:00, e 23:59 perderia o
// ultimo horario: 00:00 e o unico jeito de dizer "ate a meia-noite".
function terminaAMeiaNoite(faixa: { ends_at: string }): boolean {
  return horaCurta(faixa.ends_at) === "00:00";
}

function viraODia(faixa: { starts_at: string; ends_at: string }): boolean {
  return (
    faixa.starts_at !== "" &&
    faixa.ends_at !== "" &&
    !terminaAMeiaNoite(faixa) &&
    horaCurta(faixa.ends_at) < horaCurta(faixa.starts_at)
  );
}

let contadorChave = 0;
function novaChave(): string {
  contadorChave += 1;
  return `faixa-${contadorChave}`;
}

// ---------------------------------------------------------------------------
// "Convenios que atende" (decisao do dono em 02/10/2026): o que o Salvar
// manda e como a tela le o retorno de salvarProfissionalAction. Puros e
// exportados para o teste de unidade (tests/unit/cadastros). A regra da
// cascata e do banco (RPC sincronizar_convenios_do_profissional); a tela so
// preve, pede confirmacao e resume.
// ---------------------------------------------------------------------------

/** Profissional novo: nada gravado e nada curado */
export const ABERTURA_SEM_CONVENIO: ConveniosNaAbertura = {
  marcados: [],
  gravados: [],
  emUsoForaDoCadastro: [],
};

export type ConveniosDoSalvar = {
  insurance_ids: string[];
  insurance_ids_na_abertura: string[];
};

/**
 * Os campos de convenio do Salvar, ou null para nao mexer (ausente, a action
 * nem chama a RPC). A lista marcada agora vai INTEIRA so quando difere dos
 * pares crus ou da abertura curada (precisaSalvarConvenios), e a abertura vai
 * sempre como os pares crus (`gravados`, nunca os marcados): e com ela que a
 * RPC confere a aba parada (CZ409). Profissional novo tem abertura vazia,
 * entao so manda quando ha convenio marcado.
 */
export function conveniosDoSalvar(
  abertura: ConveniosNaAbertura,
  marcados: Iterable<string>,
): ConveniosDoSalvar | null {
  const agora = [...new Set(marcados)];
  if (!precisaSalvarConvenios(abertura, agora)) {
    return null;
  }
  return {
    insurance_ids: agora,
    insurance_ids_na_abertura: [...abertura.gravados],
  };
}

/**
 * A previa "Ao salvar" so vale quando o Salvar de fato manda a lista. Ela le
 * a matriz e os vinculos AO VIVO, e o catalogo recarrega com o modal aberto
 * (foco na aba, staleTime de 30s, ou a matriz atrasada depois do salvo com
 * jornada que falhou); a abertura e os marcados sao a foto de quando o modal
 * abriu. Sem esta trava, uma mudanca feita em outra aba virava frase ("Amil
 * sai de 1 procedimento") que o Salvar nao ia cumprir. Quando a lista vai, a
 * RPC confere a abertura (CZ409, D5), entao a previa ao vivo e a melhor
 * estimativa. A cura sem mudanca continua sem frase: o curado conta como
 * atual.
 */
export function salvarMandaConvenios(
  abertura: ConveniosNaAbertura,
  marcados: Iterable<string>,
): boolean {
  return conveniosDoSalvar(abertura, marcados) !== null;
}

/** O fim que a action poe no parcial quando o reenvio basta */
const CHAMADA_DO_PARCIAL = "Clique em Salvar de novo.";

/**
 * O erro do parcial com a jornada junto. No parcial o id ja existe no banco
 * (a linha foi criada, ou os convenios da edicao foram gravados), entao a
 * jornada e salva do mesmo jeito, como no salvo, e o texto diz o que foi
 * salvo e o que nao foi (mapa de telas: "o erro parcial diz o que foi salvo e
 * o que nao foi"). Sem isso, quem aceitasse ficar sem o convenio e fechasse
 * o modal perdia a jornada digitada sem aviso, e a Agenda nao abria horario.
 * A chamada para salvar de novo fica sempre no fim; quando a action nao a
 * traz (criacao com o convenio recusado, como o desativado em outra aba),
 * ela pede para conferir os convenios antes.
 */
export function mensagemDoParcial(
  erroDoParcial: string,
  jornada: { ok: boolean; error?: string },
): string {
  const erro = erroDoParcial.trim();
  const trazAChamada = erro.endsWith(CHAMADA_DO_PARCIAL);
  const fato = trazAChamada
    ? erro.slice(0, -CHAMADA_DO_PARCIAL.length).trim()
    : erro;
  const motivo = jornada.error?.trim();
  const daJornada = jornada.ok
    ? "A jornada foi salva."
    : motivo
      ? `A jornada também não foi salva. ${motivo}`
      : "A jornada também não foi salva.";
  const chamada = trazAChamada
    ? CHAMADA_DO_PARCIAL
    : "Confira os convênios e clique em Salvar de novo.";
  return `${fato} ${daJornada} ${chamada}`;
}

const ERRO_AO_SALVAR = "Não foi possível salvar o profissional.";

export type PassoDoSalvar =
  | { tipo: "salvo"; id: string; convenios: ResumoDosConvenios | null }
  | {
      tipo: "parcial";
      id: string;
      erro: string;
      convenios: ResumoDosConvenios | null;
    }
  | {
      tipo: "confirmar";
      motivo: "desativar" | "convenios";
      consultas: number;
      primeira: string | null;
      convenios: ResumoDosConvenios | null;
    }
  | { tipo: "cadastro_mudou"; erro: string }
  | { tipo: "erro"; erro: string };

/**
 * O retorno de salvarProfissionalAction, na ordem do contrato: o parcial com
 * id vem ANTES do !ok, porque a linha (criacao) ou os convenios (edicao) ja
 * foram gravados e o id tem de ficar no formulario (senao o proximo Salvar
 * cria um duplicado). Nos pedidos de confirmacao e no cadastro_mudou (CZ409,
 * D5), nada foi gravado.
 */
export function passoDepoisDeSalvar(
  resultado: CadastroActionResult,
): PassoDoSalvar {
  const convenios = resultado.convenios ?? null;
  if (resultado.parcial && resultado.id) {
    return {
      tipo: "parcial",
      id: resultado.id,
      erro: resultado.error ?? ERRO_AO_SALVAR,
      convenios,
    };
  }
  if (resultado.ok && resultado.id) {
    return { tipo: "salvo", id: resultado.id, convenios };
  }
  if (resultado.code === "consultas_no_periodo") {
    return {
      tipo: "confirmar",
      motivo: resultado.motivo === "convenios" ? "convenios" : "desativar",
      consultas: resultado.consultas ?? 0,
      primeira: resultado.primeiraConsulta ?? null,
      convenios,
    };
  }
  if (resultado.code === "cadastro_mudou") {
    return {
      tipo: "cadastro_mudou",
      erro: resultado.error ?? MENSAGEM_CADASTRO_MUDOU,
    };
  }
  return { tipo: "erro", erro: resultado.error ?? ERRO_AO_SALVAR };
}

/**
 * A abertura depois do Salvar. Quando a RPC aplicou a lista enviada (salvo,
 * ou o parcial da edicao, que traz `convenios`), ela vira a abertura nova:
 * pares crus = marcados = enviados, sem nota de cura (a RPC gravou o par do
 * curado). Sem isso, o proximo Salvar (jornada ou linha que falhou)
 * reenviaria a abertura velha e a RPC recusaria com CZ409. No parcial da
 * criacao (os convenios nao foram gravados) e nos outros casos, nada muda.
 */
export function aberturaDepoisDeSalvar(
  passo: PassoDoSalvar,
  abertura: ConveniosNaAbertura,
  enviados: ConveniosDoSalvar | null,
): ConveniosNaAbertura {
  if (enviados === null) {
    return abertura;
  }
  const aplicou =
    passo.tipo === "salvo" ||
    (passo.tipo === "parcial" && passo.convenios !== null);
  if (!aplicou) {
    return abertura;
  }
  return {
    marcados: [...enviados.insurance_ids],
    gravados: [...enviados.insurance_ids],
    emUsoForaDoCadastro: [],
  };
}

/** Como o resumo e o aviso chamam o convenio e o procedimento */
export function nomesDoResumo(
  catalogo: Pick<Catalogo, "convenios" | "procedimentos">,
): NomesDoResumo {
  const convenios = new Map(
    catalogo.convenios.map((c) => [
      c.id,
      c.plan_name ? `${c.name} (${c.plan_name})` : c.name,
    ]),
  );
  const procedimentos = new Map(
    catalogo.procedimentos.map((p) => [p.id, p.name]),
  );
  return {
    // Cadastrado depois de a tela carregar (outra pessoa, outra aba).
    convenio: (id) => convenios.get(id) ?? "Outro convênio",
    procedimento: (id) => procedimentos.get(id) ?? "outro procedimento",
  };
}

const AVISO_DOS_CONVENIOS_SEM_DETALHE =
  "Os convênios desmarcados mudam os procedimentos deste profissional. Confira antes de salvar.";

/**
 * Textos do aviso ANTES de gravar, quando tirar convenio pede confirmacao:
 * consulta futura (D4) e procedimento que ele deixa de fazer (D3). O titulo
 * e a das consultas, se houver; sem consulta, a de quem deixa de fazer. Com
 * as duas, quem deixa de fazer vai como complemento.
 */
export function textosDoAvisoDosConvenios(
  convenios: ResumoDosConvenios | null,
  nomes: Pick<NomesDoResumo, "procedimento">,
): { titulo: string; complemento: string | null } {
  if (!convenios) {
    return { titulo: AVISO_DOS_CONVENIOS_SEM_DETALHE, complemento: null };
  }
  const consultas = tituloDoAvisoDosConvenios(
    convenios.consultasFuturas,
    convenios.saem.length,
  );
  const deixaDeFazer = fraseDeQuemDeixaDeFazer(
    convenios.deixaDeFazer,
    convenios.saem.length,
    nomes,
  );
  if (consultas) {
    return { titulo: consultas, complemento: deixaDeFazer };
  }
  if (deixaDeFazer) {
    return { titulo: deixaDeFazer, complemento: null };
  }
  return { titulo: AVISO_DOS_CONVENIOS_SEM_DETALHE, complemento: null };
}

/**
 * Alvos de foco do modal: o aviso de consultas ou convenios, quando ele
 * entra no lugar do Salvar, e o Salvar do rodape, quando o aviso sai.
 */
const ID_DO_AVISO = "prof-aviso-de-consultas";
const ID_DO_SALVAR = "prof-salvar";

/** "Fim da faixa" de uma faixa da jornada (alvo do "Corrigir a faixa") */
const idDoFimDaFaixa = (chave: string) => `prof-${chave}-fim`;

/**
 * Faixa que vira o dia (achado 43): a pergunta toma o lugar do Salvar e
 * recebe o foco quando aparece (fora da ordem do Tab, como o AvisoDeConsultas):
 * o proximo Tab cai em "É plantão, salvar assim" e um Enter repetido nao
 * confirma sem leitura.
 */
export function AvisoDePlantao({
  salvando,
  aoConfirmar,
  aoCorrigir,
}: {
  salvando: boolean;
  aoConfirmar: () => void;
  aoCorrigir: () => void;
}) {
  const alvo = useFocoAoAparecer<HTMLDivElement>();
  return (
    <div ref={alvo} tabIndex={-1} className="rounded-xl">
      <Aviso tom="warning" icone={Sunrise} role="alert">
        <p>
          Uma faixa termina no dia seguinte (plantão noturno): a agenda vai
          abrir horários depois da meia-noite. Se o fim ficou antes do início
          por engano, corrija a faixa.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={salvando} onClick={aoConfirmar}>
            É plantão, salvar assim
          </Button>
          <Button variant="outline" onClick={aoCorrigir}>
            Corrigir a faixa
          </Button>
        </div>
      </Aviso>
    </div>
  );
}

/** Vazio de quem so le: nada a cadastrar daqui, so o fato */
const VAZIO_DOS_CONVENIOS_NA_LEITURA =
  "Atende só Particular. A clínica não tem convênio ativo.";

/** Mostra o resumo do que a RPC gravou por 10s (frases longas) */
const DURACAO_DO_RESUMO_MS = 10_000;

export function ProfissionaisTab({
  catalogo,
  matriz,
  podeEditar,
  dica,
  aoMudar,
  timezone,
}: TabProps) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormProfissional>(FORM_VAZIO);
  const [faixas, setFaixasBruto] = useState<FaixaForm[]>([]);
  const [especialidadeDigitada, setEspecialidadeDigitada] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Quem so ve Cadastros consulta a jornada por dia neste mesmo painel, em
  // modo leitura (achado 41).
  const [somenteLeitura, setSomenteLeitura] = useState(false);
  // Faixa que vira o dia (achado 43): pedindoVirada mostra a pergunta;
  // confirmarVirada guarda o "sim" ate a jornada mudar de novo.
  const [pedindoVirada, setPedindoVirada] = useState(false);
  const [confirmarVirada, setConfirmarVirada] = useState(false);
  // Confirmacao esperando resposta, ANTES de gravar: desativar com consulta
  // futura (achado 37) ou tirar convenio com consulta futura ou que tira o
  // profissional de um procedimento (D3 e D4 de 02/10/2026).
  const [aviso, setAviso] = useState<{
    motivo: "desativar" | "convenios";
    consultas: number;
    primeira: string | null;
    convenios: ResumoDosConvenios | null;
  } | null>(null);
  // Os "sim" se acumulam entre reenvios (desativar e depois tirar convenio
  // pedem duas confirmacoes seguidas). Cada um se perde quando a pessoa mexe
  // no que ele confirmou.
  const [confirmouDesativar, setConfirmouDesativar] = useState(false);
  const [confirmouConvenios, setConfirmouConvenios] = useState(false);
  // "Convenios que atende": o que estava gravado quando o modal abriu (com a
  // auto cura) e o que esta marcado agora.
  const [abertura, setAbertura] = useState<ConveniosNaAbertura>(
    ABERTURA_SEM_CONVENIO,
  );
  const [conveniosMarcados, setConveniosMarcados] = useState<
    ReadonlySet<string>
  >(() => new Set());
  // Foco do teclado: a pergunta que sai depois de gravar (erro, cadastro
  // mudou, parcial) leva junto o botao que tinha o foco; ele volta ao Salvar.
  const focoDeVolta = useFocoDeVoltaAoSalvar(ID_DO_SALVAR, {
    avisoAberto: aviso !== null || pedindoVirada,
    salvando,
  });

  const temVariasUnidades = catalogo.unidades.length >= 2;
  const nomes = nomesDoResumo(catalogo);

  // Mexeu na jornada: a confirmacao de plantao anterior nao vale mais.
  const setFaixas = (proximas: FaixaForm[]) => {
    setConfirmarVirada(false);
    setPedindoVirada(false);
    setFaixasBruto(proximas);
  };

  const abrir = (profissional?: Profissional, leitura = false) => {
    setErro(null);
    setAviso(null);
    focoDeVolta.esquecer();
    setConfirmarVirada(false);
    setPedindoVirada(false);
    setConfirmouDesativar(false);
    setConfirmouConvenios(false);
    setSomenteLeitura(leitura);
    setEspecialidadeDigitada("");
    // Auto cura: abre marcado o par gravado E o convenio que ele ja atende
    // em algum vinculo ativo (sem isso, o proximo Salvar desativaria esse
    // vinculo). A matriz e os vinculos sao os da ultima leitura do catalogo.
    const naAbertura = profissional
      ? conveniosQueAtendeNaAbertura(
          profissional.id,
          matriz.atendimentos,
          catalogo.vinculos,
        )
      : ABERTURA_SEM_CONVENIO;
    setAbertura(naAbertura);
    setConveniosMarcados(new Set(naAbertura.marcados));
    if (profissional) {
      setForm({
        id: profissional.id,
        name: profissional.name,
        council_type: profissional.council_type ?? "",
        council_number: profissional.council_number ?? "",
        specialties: profissional.specialties,
        calendar_color: profissional.calendar_color ?? COR_PADRAO,
        active: profissional.active,
      });
      const salvas = catalogo.jornadas
        .filter((j) => j.professional_id === profissional.id)
        .map((j) => ({
          chave: novaChave(),
          weekday: j.weekday,
          starts_at: horaCurta(j.starts_at),
          ends_at: horaCurta(j.ends_at),
          unit_id: j.unit_id,
        }));
      setFaixas(salvas);
      // Plantao que ja estava salvo nao pede confirmacao de novo ate a
      // jornada mudar (a linha continua dizendo "termina no dia seguinte").
      setConfirmarVirada(salvas.some(viraODia));
    } else {
      setForm(FORM_VAZIO);
      setFaixas([]);
    }
    setAberto(true);
  };

  const adicionarEspecialidade = () => {
    const valor = especialidadeDigitada.trim();
    if (!valor) return;
    if (!form.specialties.includes(valor)) {
      setForm({ ...form, specialties: [...form.specialties, valor] });
    }
    setEspecialidadeDigitada("");
  };

  const removerEspecialidade = (valor: string) => {
    setForm({
      ...form,
      specialties: form.specialties.filter((s) => s !== valor),
    });
  };

  // Mexeu nos convenios: o "sim" de tirar convenio valia para a lista
  // anterior, e o aviso dela sai (o Salvar volta ao rodape).
  const marcarConvenio = (insuranceId: string, marcado: boolean) => {
    setConfirmouConvenios(false);
    setAviso((atual) => (atual?.motivo === "convenios" ? null : atual));
    setConveniosMarcados((atual) => {
      const proximo = new Set(atual);
      if (marcado) {
        proximo.add(insuranceId);
      } else {
        proximo.delete(insuranceId);
      }
      return proximo;
    });
  };

  const adicionarFaixa = () => {
    setFaixas([
      ...faixas,
      {
        chave: novaChave(),
        weekday: 1,
        starts_at: "08:00",
        ends_at: "12:00",
        unit_id: null,
      },
    ]);
  };

  const atualizarFaixa = (chave: string, mudanca: Partial<FaixaForm>) => {
    setFaixas(
      faixas.map((f) => (f.chave === chave ? { ...f, ...mudanca } : f)),
    );
  };

  const removerFaixa = (chave: string) => {
    setFaixas(faixas.filter((f) => f.chave !== chave));
  };

  // "Corrigir a faixa": a pergunta sai com o botao que tinha o foco; o foco
  // vai para o fim da primeira faixa que vira o dia (o campo a corrigir).
  const corrigirFaixa = () => {
    setPedindoVirada(false);
    const primeira = faixas.find(viraODia);
    if (primeira) {
      document.getElementById(idDoFimDaFaixa(primeira.chave))?.focus();
    }
  };

  const salvar = async (
    opcoes: {
      confirmarVirada?: boolean;
      confirmarConsultas?: boolean;
      confirmarConvenios?: boolean;
    } = {},
  ) => {
    // Validacao da jornada ANTES de qualquer gravacao (achado 36): antes, a
    // faixa invalida so era recusada depois de o profissional ja existir.
    for (const faixa of faixas) {
      if (!faixa.starts_at || !faixa.ends_at) {
        setErro("Preencha início e fim de todas as faixas da jornada.");
        return;
      }
      if (horaCurta(faixa.starts_at) === horaCurta(faixa.ends_at)) {
        setErro(
          `A faixa de ${WEEKDAY_LABELS[faixa.weekday] ?? "um dos dias"} começa e termina no mesmo horário. Corrija o início ou o fim.`,
        );
        return;
      }
    }
    const confirmouVirada = opcoes.confirmarVirada === true || confirmarVirada;
    if (faixas.some(viraODia) && !confirmouVirada) {
      setErro(null);
      setConfirmarVirada(false);
      setAviso(null);
      setPedindoVirada(true);
      return;
    }
    setPedindoVirada(false);
    if (opcoes.confirmarVirada) {
      setConfirmarVirada(true);
      // A pergunta do plantao sai agora: se a gravacao parar com o modal
      // aberto, o foco volta ao Salvar.
      focoDeVolta.devolver();
    }
    // Veio do "mesmo assim" do aviso: se o aviso sair com o modal aberto, o
    // foco volta ao Salvar (o AvisoDeConsultas cuida do erro com ele aberto).
    const veioDoAviso =
      opcoes.confirmarConsultas === true || opcoes.confirmarConvenios === true;
    // Os "sim" ja dados continuam valendo neste reenvio.
    const confirmarConsultas =
      opcoes.confirmarConsultas === true || confirmouDesativar;
    const confirmarConvenios =
      opcoes.confirmarConvenios === true || confirmouConvenios;
    if (opcoes.confirmarConsultas) {
      setConfirmouDesativar(true);
    }
    if (opcoes.confirmarConvenios) {
      setConfirmouConvenios(true);
    }

    setSalvando(true);
    setErro(null);
    const criando = !form.id;
    // Ausente = nao mexe nos convenios; presente = a lista inteira.
    const convenios = conveniosDoSalvar(abertura, conveniosMarcados);
    const resultado = await salvarProfissionalAction({
      id: form.id,
      name: form.name,
      council_type: form.council_type.trim() || null,
      council_number: form.council_number.trim() || null,
      specialties: especialidadesParaSalvar(
        form.specialties,
        especialidadeDigitada,
      ),
      calendar_color: form.calendar_color || null,
      active: form.active,
      confirmar_consultas: confirmarConsultas,
      ...(convenios ?? {}),
      confirmar_convenios: confirmarConvenios,
    });
    const passo = passoDepoisDeSalvar(resultado);
    setAbertura((atual) => aberturaDepoisDeSalvar(passo, atual, convenios));

    if (passo.tipo === "confirmar") {
      // Nada foi gravado: a pergunta toma o lugar do Salvar.
      setSalvando(false);
      setAviso({
        motivo: passo.motivo,
        consultas: passo.consultas,
        primeira: passo.primeira,
        convenios: passo.convenios,
      });
      return;
    }
    if (passo.tipo === "cadastro_mudou") {
      // Aba parada (D5): nada foi gravado. O catalogo e a matriz recarregam
      // para o modal reabrir com o que esta gravado agora.
      setSalvando(false);
      if (veioDoAviso) {
        focoDeVolta.devolver();
      }
      setAviso(null);
      setErro(passo.erro);
      aoMudar();
      return;
    }
    if (passo.tipo === "erro") {
      setSalvando(false);
      setErro(passo.erro);
      // Com convenio na conta, o erro costuma ser catalogo parado (convenio
      // desativado ou apagado em outra aba): recarrega, e o inativo marcado
      // aparece com o selo para poder sair.
      if (convenios) {
        aoMudar();
      }
      return;
    }

    if (veioDoAviso) {
      focoDeVolta.devolver();
    }
    setAviso(null);
    // O id fica no formulario ANTES de qualquer outro passo (jornada, ou o
    // parcial): o proximo Salvar atualiza este profissional em vez de criar
    // um duplicado.
    const novoId = passo.id;
    // A especialidade digitada sem Enter ja foi enviada: passa para a lista,
    // para um novo Salvar (jornada que falhou) nao perde-la.
    setForm((atual) => ({
      ...atual,
      id: novoId,
      specialties: especialidadesParaSalvar(
        atual.specialties,
        especialidadeDigitada,
      ),
    }));
    setEspecialidadeDigitada("");
    // O resumo vem do RETORNO da RPC (o que foi gravado), nao da previa.
    const resumo = passo.convenios
      ? frasesDoResumoDosConvenios(passo.convenios, nomes).join(" ")
      : "";
    const avisarConveniosSalvos = () => {
      if (resumo) {
        toast.success("Convênios salvos", {
          description: resumo,
          duration: DURACAO_DO_RESUMO_MS,
        });
      }
    };

    // A jornada substitui a semana inteira (substituir_jornada): regravar no
    // proximo Salvar nao tem efeito colateral.
    const salvarJornada = () =>
      salvarJornadaAction(
        novoId,
        faixas.map((f) => ({
          weekday: f.weekday,
          starts_at: f.starts_at,
          ends_at: f.ends_at,
          unit_id: f.unit_id,
        })),
      );

    if (passo.tipo === "parcial") {
      // Uma parte foi gravada e a outra nao. O id ja existe e a jornada nao
      // depende dos convenios nem da linha: vai agora, como no salvo, e o
      // erro diz tambem o que aconteceu com ela. A abertura ja acompanha o
      // que a RPC gravou, entao o proximo Salvar so reenvia o que faltou. O
      // modal fica aberto, com o id no formulario.
      const jornadaDoParcial = await salvarJornada();
      setSalvando(false);
      setErro(mensagemDoParcial(passo.erro, jornadaDoParcial));
      avisarConveniosSalvos();
      aoMudar();
      return;
    }

    const resultadoJornada = await salvarJornada();
    setSalvando(false);
    if (!resultadoJornada.ok) {
      const motivo = resultadoJornada.error ?? "Tente de novo.";
      setErro(
        criando
          ? `O profissional foi criado, mas a jornada não foi salva. ${motivo} Corrija e clique em Salvar de novo.`
          : `O profissional foi salvo, mas a jornada não. ${motivo}`,
      );
      avisarConveniosSalvos();
      aoMudar();
      return;
    }
    toast.success(
      criando ? "Profissional criado" : "Profissional atualizado",
      resumo
        ? { description: resumo, duration: DURACAO_DO_RESUMO_MS }
        : undefined,
    );
    // O modal fecha e o Radix devolve o foco a quem o abriu.
    focoDeVolta.esquecer();
    setAberto(false);
    aoMudar();
  };

  const diasDeJornada = (profissionalId: string): number =>
    new Set(
      catalogo.jornadas
        .filter((j) => j.professional_id === profissionalId)
        .map((j) => j.weekday),
    ).size;

  const colunas: ColumnDef<Profissional>[] = [
    {
      id: "nome",
      header: "Nome",
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <AvatarDoProfissional
            nome={row.original.name}
            cor={row.original.calendar_color}
          />
          <span className="truncate font-semibold text-text-strong">
            {row.original.name}
          </span>
        </span>
      ),
    },
    {
      id: "conselho",
      header: "Conselho",
      cell: ({ row }) =>
        row.original.council_type ? (
          <span className="cz-num whitespace-nowrap text-text-secondary">
            {`${row.original.council_type} ${row.original.council_number ?? ""}`.trim()}
          </span>
        ) : (
          <span className="text-text-secondary">Sem conselho</span>
        ),
    },
    {
      id: "especialidades",
      header: "Especialidades",
      cell: ({ row }) => {
        const especialidades = row.original.specialties;
        if (especialidades.length === 0) {
          return <span className="text-text-secondary">Sem especialidade</span>;
        }
        const restantes = especialidades.slice(3);
        return (
          <span className="flex flex-wrap items-center gap-1 py-1.5">
            {especialidades.slice(0, 3).map((esp) => (
              // Especialidade e Tag neutra do DS (variante outline do
              // Badge), nunca status: sem icone e sem cor semantica.
              <Badge
                key={esp}
                variant="outline"
                className="h-5 px-2 text-[11px]"
              >
                {esp}
              </Badge>
            ))}
            {restantes.length > 0 ? (
              <span
                className="cz-num text-xs text-text-secondary"
                title={restantes.join(", ")}
              >
                +{restantes.length}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "jornada",
      header: "Jornada",
      cell: ({ row }) => {
        const dias = diasDeJornada(row.original.id);
        if (dias === 0) {
          return <span className="text-text-secondary">Sem jornada</span>;
        }
        return (
          <span className="whitespace-nowrap text-text-secondary">
            <span className="cz-num">{dias}</span>{" "}
            {dias === 1 ? "dia/semana" : "dias/semana"}
          </span>
        );
      },
    },
    {
      id: "situacao",
      header: "Situação",
      cell: ({ row }) => <ChipSituacao active={row.original.active} />,
    },
    {
      id: "acoes",
      header: () => <span className="sr-only">Ações</span>,
      meta: { align: "right", numeric: false },
      cell: ({ row }) => (
        <AcoesDaLinha
          podeEditar={podeEditar}
          dica={dica}
          nome={row.original.name}
          aoEditar={() => abrir(row.original)}
          aoVerDetalhes={() => abrir(row.original, true)}
        />
      ),
    },
  ];

  const fechar = () => setAberto(false);

  // Ativos por nome, mais o inativo que esta (ou estava) marcado, para poder
  // sair; o curado leva a nota de por que veio marcado.
  const opcoesDeConvenio = opcoesDosConveniosQueAtende({
    convenios: catalogo.convenios,
    marcados: conveniosMarcados,
    naAbertura: abertura.marcados,
    emUsoForaDoCadastro: abertura.emUsoForaDoCadastro,
  });
  // Previa ao vivo do que o Salvar muda nos procedimentos dele, pela mesma
  // regra da RPC. So na edicao (profissional novo nao faz procedimento
  // nenhum ainda) e so quando o Salvar de fato manda a lista (ver
  // salvarMandaConvenios: recarregar o catalogo nao anuncia mudanca que o
  // Salvar nao vai fazer).
  const previaDosConvenios =
    form.id &&
    !somenteLeitura &&
    salvarMandaConvenios(abertura, conveniosMarcados)
      ? frasesDoResumoDosConvenios(
          previaDosConveniosDoProfissional({
            professionalId: form.id,
            agora: [...conveniosMarcados],
            atendimentos: matriz.atendimentos,
            coberturas: matriz.coberturas,
            vinculos: catalogo.vinculos,
          }),
          nomes,
        )
      : [];
  const textosDoAviso =
    aviso?.motivo === "convenios"
      ? textosDoAvisoDosConvenios(aviso.convenios, nomes)
      : null;

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          onClick={() => abrir()}
        >
          <Plus aria-hidden /> Novo profissional
        </BotaoProtegido>
      </div>

      {catalogo.profissionais.length === 0 ? (
        <VazioDaAba
          icon={BriefcaseMedical}
          titulo="Nenhum profissional cadastrado"
          descricao="Cadastre quem atende na clínica para montar a agenda e liberar o agendamento pela IA."
          acao={{
            rotulo: "Cadastrar o primeiro profissional",
            onClick: () => abrir(),
          }}
          podeEditar={podeEditar}
          dica={dica}
        />
      ) : (
        <DataTable columns={colunas} data={catalogo.profissionais} />
      )}

      <PainelDeCadastro
        aberto={aberto}
        aoMudarAberto={setAberto}
        larga
        titulo={
          somenteLeitura
            ? form.name
            : form.id
              ? "Editar profissional"
              : "Novo profissional"
        }
        erro={somenteLeitura ? null : erro}
        aviso={
          somenteLeitura ? null : pedindoVirada ? (
            <AvisoDePlantao
              salvando={salvando}
              aoConfirmar={() => void salvar({ confirmarVirada: true })}
              aoCorrigir={corrigirFaixa}
            />
          ) : aviso && textosDoAviso ? (
            // Tirar convenio (D3 e D4): nada foi gravado ainda, nem os
            // outros campos. Cancelar fecha sem salvar; mexer nos convenios
            // tira o aviso e devolve o Salvar. Sem consulta futura (D3 so
            // com quem deixa de fazer), o AvisoDeConsultas fica so com o
            // titulo e a confirmacao. A `key` por motivo faz o aviso que
            // chega depois do "Desativar mesmo assim" ser novo (e receber o
            // foco), nao o mesmo com outro texto.
            <AvisoDeConsultas
              key="convenios"
              id={ID_DO_AVISO}
              consultas={aviso.consultas}
              primeira={aviso.primeira}
              timezone={timezone}
              titulo={
                textosDoAviso.complemento ? (
                  <>
                    {textosDoAviso.titulo}
                    <span className="mt-1 block font-normal">
                      {textosDoAviso.complemento}
                    </span>
                  </>
                ) : (
                  textosDoAviso.titulo
                )
              }
              rotuloConfirmar={ROTULO_TIRAR_CONVENIO}
              confirmando={salvando}
              aoConfirmar={() => void salvar({ confirmarConvenios: true })}
            />
          ) : aviso ? (
            <AvisoDeConsultas
              key="desativar"
              id={ID_DO_AVISO}
              consultas={aviso.consultas}
              primeira={aviso.primeira}
              timezone={timezone}
              rotuloConfirmar="Desativar mesmo assim"
              confirmando={salvando}
              aoConfirmar={() => void salvar({ confirmarConsultas: true })}
            />
          ) : null
        }
        rodape={
          somenteLeitura ? undefined : pedindoVirada || aviso ? (
            <Button variant="ghost" onClick={fechar}>
              Cancelar
            </Button>
          ) : (
            <RodapeDeSalvar
              salvando={salvando}
              aoCancelar={fechar}
              aoSalvar={() => void salvar()}
              idDoSalvar={ID_DO_SALVAR}
            />
          )
        }
      >
        {somenteLeitura ? (
          <DetalheSomenteLeitura
            itens={[
              {
                rotulo: "Conselho",
                valor: form.council_type ? (
                  <span className="cz-num">
                    {`${form.council_type} ${form.council_number}`.trim()}
                  </span>
                ) : (
                  "Sem conselho"
                ),
              },
              {
                rotulo: "Especialidades",
                valor: form.specialties.join(", "),
              },
              {
                // Quem so le ve a mesma lista, desabilitada e com a dica do
                // papel (o rotulo a vista e o da lista de detalhes).
                rotulo: ROTULO_CONVENIOS_QUE_ATENDE,
                valor: (
                  <ListaDeConvenios
                    legenda={ROTULO_CONVENIOS_QUE_ATENDE}
                    legendaOculta
                    ajuda={AJUDA_CONVENIOS_QUE_ATENDE}
                    opcoes={opcoesDeConvenio}
                    marcados={conveniosMarcados}
                    aoMudar={() => undefined}
                    vazio={VAZIO_DOS_CONVENIOS_NA_LEITURA}
                    podeEditar={false}
                    dica={dica}
                  />
                ),
              },
              {
                rotulo: "Situação",
                valor: <ChipSituacao active={form.active} />,
              },
              {
                rotulo: "Jornada semanal",
                valor:
                  faixas.length === 0 ? (
                    "Sem jornada cadastrada"
                  ) : (
                    <ul className="grid gap-1">
                      {[...faixas]
                        .sort(
                          (a, b) =>
                            a.weekday - b.weekday ||
                            a.starts_at.localeCompare(b.starts_at),
                        )
                        .map((faixa) => (
                          <li key={faixa.chave}>
                            {WEEKDAY_LABELS[faixa.weekday]}:{" "}
                            <span className="cz-num">{faixa.starts_at}</span> às{" "}
                            <span className="cz-num">{faixa.ends_at}</span>
                            {viraODia(faixa)
                              ? " (termina no dia seguinte)"
                              : terminaAMeiaNoite(faixa)
                                ? " (meia-noite)"
                                : ""}
                            {temVariasUnidades && faixa.unit_id
                              ? `, ${
                                  catalogo.unidades.find(
                                    (u) => u.id === faixa.unit_id,
                                  )?.name ?? "unidade removida"
                                }`
                              : ""}
                          </li>
                        ))}
                    </ul>
                  ),
              },
            ]}
          />
        ) : null}
        {/* O formulario fica fora da arvore visivel no modo leitura
            (atributo hidden, que o preflight do Tailwind forca). */}
        <div className="grid gap-4" hidden={somenteLeitura}>
          <div className="grid gap-1.5">
            <Label htmlFor="prof-nome">Nome</Label>
            <Input
              id="prof-nome"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="prof-conselho">Conselho</Label>
              <Input
                id="prof-conselho"
                value={form.council_type}
                onChange={(e) =>
                  setForm({ ...form, council_type: e.target.value })
                }
                placeholder="CRM, CRO, CREFITO... (vazio se não tiver)"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="prof-numero">Número</Label>
              <Input
                id="prof-numero"
                value={form.council_number}
                onChange={(e) =>
                  setForm({ ...form, council_number: e.target.value })
                }
                className="cz-num"
              />
            </div>
          </div>
          {/* gap-2 (8px) e nao 1,5: a area de toque do "x" passa 8px acima
              e abaixo da etiqueta e nao pode cobrir o rotulo nem o campo. */}
          <div className="grid gap-2">
            <Label htmlFor="prof-especialidade">Especialidades</Label>
            {form.specialties.length > 0 ? (
              <ul
                aria-label="Especialidades adicionadas"
                className="flex flex-wrap gap-2"
              >
                {form.specialties.map((esp) => (
                  <li key={esp} className="flex">
                    {/* A etiqueta nao recorta (overflow-visible): o botao de
                        remover tem 40x40px de verdade (achados 44 e R16).
                        Ele comeca depois do nome, entao tocar no fim do nome
                        nao remove nada, e passa so 8px da borda da
                        etiqueta, o mesmo vao ate a vizinha. */}
                    <Badge
                      variant="outline"
                      className="gap-1 overflow-visible pr-0"
                    >
                      {esp}
                      <button
                        type="button"
                        onClick={() => removerEspecialidade(esp)}
                        aria-label={`Remover ${esp}`}
                        className="group/remover relative -my-2 -mr-2 flex size-10 shrink-0 items-center pl-2 outline-none"
                      >
                        <span className="grid size-5 place-items-center rounded-sm text-text-secondary cz-transition group-hover/remover:bg-surface-3 group-hover/remover:text-text-strong group-focus-visible/remover:outline-2 group-focus-visible/remover:outline-offset-1 group-focus-visible/remover:outline-focus group-focus-visible/remover:outline-solid">
                          <X aria-hidden className="size-3" />
                        </span>
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-2">
              <Input
                id="prof-especialidade"
                value={especialidadeDigitada}
                onChange={(e) => setEspecialidadeDigitada(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    adicionarEspecialidade();
                  }
                }}
                placeholder="Digite a especialidade"
              />
              {/* No celular o Enter nao e obvio: o botao adiciona do mesmo
                  jeito. E o que ficar digitado sem adicionar entra no Salvar. */}
              <Button
                type="button"
                variant="outline"
                className="h-10 shrink-0"
                onClick={adicionarEspecialidade}
              >
                <Plus aria-hidden />
                Adicionar
              </Button>
            </div>
          </div>
          {/* Convenios que atende (decisao do dono em 02/10/2026): o
              Particular vale sempre (texto da ajuda, sem caixa), o convenio
              inativo so aparece se estava marcado, e sem convenio ativo fica
              so o texto (D6: trocar de aba fecharia o modal). */}
          <div className="grid">
            <ListaDeConvenios
              legenda={ROTULO_CONVENIOS_QUE_ATENDE}
              ajuda={AJUDA_CONVENIOS_QUE_ATENDE}
              opcoes={opcoesDeConvenio}
              marcados={conveniosMarcados}
              aoMudar={marcarConvenio}
              vazio={VAZIO_CONVENIOS_QUE_ATENDE}
              podeEditar={podeEditar}
              dica={dica}
            />
            {/* A regiao fica montada mesmo vazia: assim o leitor de tela
                anuncia a primeira frase quando ela aparece. */}
            <div aria-live="polite">
              {previaDosConvenios.length > 0 ? (
                <div className="mt-2 grid gap-1 rounded-xl bg-surface-subtle px-3.5 py-3 text-[13px] text-foreground">
                  <p className="text-xs font-semibold text-text-secondary">
                    Ao salvar
                  </p>
                  {previaDosConvenios.map((frase, indice) => (
                    <p key={`${indice}-${frase}`}>{frase}</p>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="prof-cor">Cor na agenda</Label>
            <input
              id="prof-cor"
              type="color"
              value={form.calendar_color}
              onChange={(e) =>
                setForm({ ...form, calendar_color: e.target.value })
              }
              className="h-10 w-16 cursor-pointer rounded-lg border border-input bg-card p-1 cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            />
          </div>
          <CampoDeMarcar
            id="prof-ativo"
            rotulo="Profissional ativo"
            descricao={
              form.id && !form.active
                ? "Desativado, o profissional sai da Agenda e da oferta de horários. Consultas já marcadas não são desmarcadas."
                : undefined
            }
            marcado={form.active}
            aoMudar={(marcado) => {
              setAviso(null);
              setConfirmouDesativar(false);
              setForm({ ...form, active: marcado });
            }}
          />

          <div className="grid gap-3 border-t border-border pt-4">
            <div className="grid gap-1">
              <p className="text-sm font-bold text-text-strong">
                Jornada semanal
              </p>
              <p className="text-xs text-text-secondary">
                Almoço: crie duas faixas no mesmo dia (manhã e tarde).
              </p>
            </div>
            {faixas.length === 0 ? (
              <p className="text-[13px] text-text-secondary">
                Sem jornada cadastrada. Sem faixas, a agenda não abre horários
                para este profissional.
              </p>
            ) : (
              <div className="grid gap-2">
                {faixas.map((faixa) => (
                  <div
                    key={faixa.chave}
                    className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-4 p-2"
                  >
                    <Select
                      value={String(faixa.weekday)}
                      onValueChange={(v) =>
                        atualizarFaixa(faixa.chave, { weekday: Number(v) })
                      }
                    >
                      <SelectTrigger
                        aria-label="Dia da faixa"
                        className="w-[110px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAY_LABELS.map((rotulo, indice) => (
                          <SelectItem key={rotulo} value={String(indice)}>
                            {rotulo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="time"
                      value={faixa.starts_at}
                      onChange={(e) =>
                        atualizarFaixa(faixa.chave, {
                          starts_at: e.target.value,
                        })
                      }
                      aria-label="Início da faixa"
                      className="w-[112px] cz-num"
                    />
                    <Input
                      id={idDoFimDaFaixa(faixa.chave)}
                      type="time"
                      value={faixa.ends_at}
                      onChange={(e) =>
                        atualizarFaixa(faixa.chave, {
                          ends_at: e.target.value,
                        })
                      }
                      aria-label="Fim da faixa"
                      className="w-[112px] cz-num"
                    />
                    {temVariasUnidades ? (
                      <Select
                        value={faixa.unit_id ?? "todas"}
                        onValueChange={(v) =>
                          atualizarFaixa(faixa.chave, {
                            unit_id: v === "todas" ? null : v,
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label="Unidade da faixa"
                          className="w-[130px]"
                        >
                          <SelectValue placeholder="Unidade" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todas">
                            Qualquer unidade
                          </SelectItem>
                          {catalogo.unidades.map((unidade) => (
                            <SelectItem key={unidade.id} value={unidade.id}>
                              {unidade.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto"
                      onClick={() => removerFaixa(faixa.chave)}
                      aria-label="Remover faixa"
                    >
                      <Trash2 aria-hidden />
                    </Button>
                    {viraODia(faixa) ? (
                      <span className="flex basis-full items-center gap-1.5 px-1 text-xs font-medium text-warning-text">
                        <Sunrise className="size-4 shrink-0" aria-hidden />
                        Termina no dia seguinte (plantão noturno)
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            <Button
              variant="outline"
              onClick={adicionarFaixa}
              className="justify-self-start"
            >
              <Plus aria-hidden /> Adicionar faixa
            </Button>
          </div>
        </div>
      </PainelDeCadastro>
    </div>
  );
}
