import { DetalhesDoAnuncio } from "@/components/leads/detalhes-do-anuncio";
import { dataLocal } from "@/components/leads/rotulos";
import {
  BlocoFicha,
  LinhaDaFicha,
  SemDado,
} from "@/components/pacientes/comum";
import {
  campanhaDaMeta,
  campanhaDoContato,
  campanhaForaDaMeta,
  conjuntoDoContato,
  ehLeadDeAnuncio,
  rotuloDoMetodo,
  textoDaOrigem,
  type TextoDeAtribuicao,
} from "@/lib/domain/leads-ui";
import type { ContatoDaFicha } from "@/lib/queries/pacientes";

// De onde a pessoa veio, preservado desde o tempo de lead: o gatilho de
// origem imutavel impede que virar paciente apague a atribuicao. E o que
// responde "qual campanha traz paciente que comparece".
//
// Origem real do anuncio (04/10/2026): o Canal junta canal, origem e
// plataforma ("Tráfego pago, Meta (Instagram)"); a Campanha e o Conjunto do
// lead de anuncio vem de meta_anuncio pelo id do anuncio (lidos com a ficha,
// pela sessao); o Metodo diz como a origem foi capturada. So leitura.
//
// Detalhes do anuncio (20/10/2026, pedido do dono): o lead de anuncio tem o
// bloco "Detalhes do anúncio" (o mesmo do Atendimento e da gaveta de Leads)
// com titulo, descricao e link do anuncio (anuncio_do_whatsapp, lido com a
// ficha) e a campanha e o conjunto da Meta, que sairam das linhas; a
// campanha do link ou do Google continua nas linhas. Sem botao de tentar de
// novo: a ficha e do servidor, o erro manda atualizar a pagina.

const ATUALIZE_A_PAGINA = "Atualize a página para tentar de novo.";

function ValorDeAtribuicao({ valor }: { valor: TextoDeAtribuicao }) {
  if (valor.tipo === "nome") {
    return <>{valor.texto}</>;
  }
  // A ficha e do servidor: tentar de novo e recarregar a pagina.
  return (
    <SemDado
      texto={
        valor.tipo === "erro"
          ? `${valor.texto}. ${ATUALIZE_A_PAGINA}`
          : valor.texto
      }
    />
  );
}

export function OrigemPaciente({
  contato,
  timezone,
}: {
  contato: ContatoDaFicha;
  timezone: string;
}) {
  const origem = textoDaOrigem(contato);
  const deAnuncio = ehLeadDeAnuncio(contato);
  // Lead de anuncio: nas linhas, so a campanha que nao vem da Meta (link ou
  // Google); a da Meta vai para o bloco "Detalhes do anúncio".
  const campanhaNasLinhas = deAnuncio
    ? campanhaForaDaMeta(contato)
    : campanhaDoContato(contato, contato.anuncio_meta);
  const campanhaDoBloco = deAnuncio
    ? campanhaDaMeta(contato, contato.anuncio_meta)
    : null;
  const conjunto = conjuntoDoContato(contato, contato.anuncio_meta);
  const metodo = rotuloDoMetodo(contato.source_method);
  const quando = contato.source_captured_at ?? contato.first_contact_at;

  return (
    <BlocoFicha titulo="Origem">
      <div className="grid gap-2">
        <LinhaDaFicha rotulo="Canal">
          {origem ?? <SemDado texto="Não informado" />}
        </LinhaDaFicha>
        {campanhaNasLinhas ? (
          <LinhaDaFicha rotulo="Campanha">
            <ValorDeAtribuicao valor={campanhaNasLinhas} />
          </LinhaDaFicha>
        ) : null}
        {metodo ? <LinhaDaFicha rotulo="Método">{metodo}</LinhaDaFicha> : null}
        <LinhaDaFicha rotulo="Chegou em">
          <span className="cz-num">{dataLocal(quando, timezone)}</span>
        </LinhaDaFicha>
      </div>
      {deAnuncio ? (
        <DetalhesDoAnuncio
          leitura={contato.anuncio_whatsapp}
          campanha={campanhaDoBloco}
          conjunto={conjunto}
          tela="ficha"
          tituloComo="h3"
          complementoDoErro={ATUALIZE_A_PAGINA}
        />
      ) : null}
    </BlocoFicha>
  );
}
