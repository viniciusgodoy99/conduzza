import { dataLocal } from "@/components/leads/rotulos";
import {
  BlocoFicha,
  LinhaDaFicha,
  SemDado,
} from "@/components/pacientes/comum";
import {
  campanhaDoContato,
  conjuntoDoContato,
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

function ValorDeAtribuicao({ valor }: { valor: TextoDeAtribuicao }) {
  if (valor.tipo === "nome") {
    return <>{valor.texto}</>;
  }
  // A ficha e do servidor: tentar de novo e recarregar a pagina.
  return (
    <SemDado
      texto={
        valor.tipo === "erro"
          ? `${valor.texto}. Atualize a página para tentar de novo.`
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
  const campanha = campanhaDoContato(contato, contato.anuncio_meta);
  const conjunto = conjuntoDoContato(contato, contato.anuncio_meta);
  const metodo = rotuloDoMetodo(contato.source_method);
  const quando = contato.source_captured_at ?? contato.first_contact_at;

  return (
    <BlocoFicha titulo="Origem">
      <div className="grid gap-2">
        <LinhaDaFicha rotulo="Canal">
          {origem ?? <SemDado texto="Não informado" />}
        </LinhaDaFicha>
        <LinhaDaFicha rotulo="Campanha">
          <ValorDeAtribuicao valor={campanha} />
        </LinhaDaFicha>
        {conjunto ? (
          <LinhaDaFicha rotulo="Conjunto">
            <ValorDeAtribuicao valor={conjunto} />
          </LinhaDaFicha>
        ) : null}
        {metodo ? <LinhaDaFicha rotulo="Método">{metodo}</LinhaDaFicha> : null}
        <LinhaDaFicha rotulo="Chegou em">
          <span className="cz-num">{dataLocal(quando, timezone)}</span>
        </LinhaDaFicha>
      </div>
    </BlocoFicha>
  );
}
