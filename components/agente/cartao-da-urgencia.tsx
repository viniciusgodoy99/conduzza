import { LifeBuoy } from "lucide-react";

import { LadrilhoDoCartao } from "@/components/agente/cartao-da-passagem";
import { TEXTOS_DA_URGENCIA as T } from "@/components/agente/textos";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { URGENCIA_DA_CONVERSA } from "@/lib/design/status";

// [AG6 urgência] início "Urgência" (AG6a, desenho da secao 6; D-52 e D-53 pela
// recomendacao, pendentes do dono), na aba Regras e limites da Tela 6, logo
// depois de "Para quem vai a conversa". Nesta rodada, so o texto: quando a
// pessoa descreve algo que pode ser uma emergencia (a lista curta e fixa do
// portao, proposta ao responsavel tecnico), a conversa passa para a equipe
// marcada como Urgente, no topo do Atendimento, e o contato recebe a frase
// de sempre. Nao ha o que ligar nem desligar (como os gatilhos
// obrigatorios), entao nao ha controle nem dica de permissao: todo papel ve
// igual. A chave do aviso do SAMU (192), com a aprovacao do responsavel
// tecnico, e da AG6c e entra neste cartao.
//
// O ladrilho (LifeBuoy) e decorativo e neutro (docs/06, 4.6: sem dono de
// status). O chip de exemplo e o do Atendimento (URGENCIA_DA_CONVERSA:
// "Urgente", alerta, BellRing), no mesmo sentido e na mesma cor.

export function CartaoDaUrgencia() {
  return (
    <Card role="region" aria-labelledby="agente-urgencia-titulo">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <LadrilhoDoCartao icone={LifeBuoy} />
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id="agente-urgencia-titulo">{T.titulo}</CardTitle>
            <CardDescription>{T.descricao}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 text-[13.5px]">
        <p>{T.texto}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-text-secondary">
          <span>{T.exemplo}</span>
          <StatusChip definition={URGENCIA_DA_CONVERSA} />
        </p>
        <p className="text-text-secondary">{T.marca}</p>
      </CardContent>
    </Card>
  );
}
// [AG6 urgência] fim
