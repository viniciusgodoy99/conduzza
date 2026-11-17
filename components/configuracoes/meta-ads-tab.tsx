"use client";

import { Check, Megaphone } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import {
  alternarEnvioMetaAction,
  salvarContaMetaAction,
  salvarTokenMetaAction,
} from "@/app/(app)/configuracoes/actions";
import { InvestimentoMetaCard } from "@/components/configuracoes/investimento-meta-card";
import type { LeituraDoInvestimento } from "@/components/configuracoes/investimento-meta";
import {
  OndeEncontro,
  OndeEncontroDoCampo,
} from "@/components/configuracoes/onde-encontro";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TOKEN_META_STATUS } from "@/lib/design/status";
import { ONDE_ENCONTRAR } from "@/lib/domain/onde-encontrar";

// Os cartoes da Meta (R6): a conta que recebe as conversoes de volta e,
// desde a Fase 4, de onde a clinica le o investimento nos anuncios (cartao
// "Investimento nos anuncios", que usa a MESMA conta deste cartao, sem
// repetir o campo).
//
// Desde 17/11/2026 (decisao do dono: um lugar so, com passo a passo) eles
// nao sao mais uma aba: useCartoesDaMeta devolve os quatro cartoes, e a aba
// "Anuncios e rastreio" poe cada um no passo dele. O estado dos campos mora
// no gancho, entao fechar um passo nao apaga o que foi digitado.
//
// O TOKEN E WRITE-ONLY: o servidor nunca manda o valor para ca, so o fato de
// existir (temToken). O campo sempre nasce vazio e salvar substitui.
//
// DECISAO D6 do dono (16/11/2026): os dois modos ficam liberados e a clinica
// escolhe. O telefone, quando sai, sai em hash e sem corte por autorizacao.
// O banco continua exigindo Pixel, modo e token para ligar o envio
// (migration 20261116100000).

export type ContaMeta = {
  pixel_id: string | null;
  ad_account_id: string | null;
  whatsapp_business_account_id: string | null;
  test_event_code: string | null;
  envio_ativado: boolean;
  modo_user_data: string | null;
  send_unmatched: boolean;
};

const CONTA_VAZIA: ContaMeta = {
  pixel_id: null,
  ad_account_id: null,
  whatsapp_business_account_id: null,
  test_event_code: null,
  envio_ativado: false,
  modo_user_data: null,
  send_unmatched: false,
};

/** Os quatro cartoes da Meta, cada um para o passo dele. */
export type CartoesDaMeta = {
  conta: ReactNode;
  token: ReactNode;
  envio: ReactNode;
  investimento: ReactNode;
};

type ParteDaMeta = "conta" | "token" | "envio";

export function useCartoesDaMeta({
  conta,
  temToken,
  temTokenDeLeitura,
  leitura,
  timezone,
  agoraMs,
  podeGerenciar,
  dica,
}: {
  conta: ContaMeta | null;
  temToken: boolean;
  /** Existe token de leitura de anuncios (o valor nunca vem para ca). */
  temTokenDeLeitura: boolean;
  /** Situacao da leitura do investimento; nula enquanto nao existe. */
  leitura: LeituraDoInvestimento | null;
  /** Fuso da clinica, para o "Atualizado em". */
  timezone: string;
  /** Instante da renderizacao no servidor (ms). */
  agoraMs: number;
  podeGerenciar: boolean;
  dica: string;
}): CartoesDaMeta {
  const atual = conta ?? CONTA_VAZIA;
  const [pixel, setPixel] = useState(atual.pixel_id ?? "");
  const [contaAnuncios, setContaAnuncios] = useState(atual.ad_account_id ?? "");
  const [waba, setWaba] = useState(atual.whatsapp_business_account_id ?? "");
  const [codigoTeste, setCodigoTeste] = useState(atual.test_event_code ?? "");
  const [semIdentificador, setSemIdentificador] = useState(
    atual.send_unmatched,
  );
  const [modoEscolhido, setModoEscolhido] = useState(
    atual.modo_user_data ?? "",
  );
  const [token, setToken] = useState("");
  const [erro, setErro] = useState<{
    onde: ParteDaMeta;
    texto: string;
  } | null>(null);
  const [pendente, startTransition] = useTransition();

  // "onde": o cartao que pediu (a conta, ou o envio ao escolher como os
  // dados saem), para o erro aparecer ao lado de quem clicou.
  const salvarConta = (onde: "conta" | "envio") => {
    setErro(null);
    // Cada botao grava so o que e do cartao dele; o resto vai como esta
    // salvo. Sem isto, "Salvar conta" gravava junto a escolha de enviar o
    // telefone, mexida no passo 3 e nao confirmada (revisao de 17/11/2026).
    const daConta = onde === "conta";
    startTransition(async () => {
      const resultado = await salvarContaMetaAction({
        pixel_id: daConta ? pixel.trim() || null : atual.pixel_id,
        ad_account_id: daConta
          ? contaAnuncios.trim() || null
          : atual.ad_account_id,
        whatsapp_business_account_id: daConta
          ? waba.trim() || null
          : atual.whatsapp_business_account_id,
        test_event_code: daConta
          ? codigoTeste.trim() || null
          : atual.test_event_code,
        send_unmatched: daConta ? semIdentificador : atual.send_unmatched,
        modo_user_data: daConta
          ? atual.modo_user_data
          : modoEscolhido === "ctwa_apenas" ||
              modoEscolhido === "telefone_hasheado"
            ? modoEscolhido
            : null,
      });
      if (!resultado.ok) {
        setErro({ onde, texto: resultado.error });
        return;
      }
      // O servidor grava sempre act_<digitos>: o campo mostra o que ficou.
      if (daConta) {
        setContaAnuncios(resultado.adAccountId ?? "");
      }
      toast.success(
        onde === "conta" ? "Conta de anúncios salva." : "Escolha salva.",
      );
    });
  };

  const salvarToken = () => {
    setErro(null);
    startTransition(async () => {
      const resultado = await salvarTokenMetaAction({
        capi_access_token: token,
      });
      if (!resultado.ok) {
        setErro({
          onde: "token",
          texto: resultado.error ?? "Não foi possível salvar o token.",
        });
        return;
      }
      setToken("");
      toast.success("Token salvo. Ele não aparece de novo por segurança.");
    });
  };

  const alternarEnvio = (ligar: boolean) => {
    setErro(null);
    startTransition(async () => {
      const resultado = await alternarEnvioMetaAction({ ligar });
      if (!resultado.ok) {
        setErro({
          onde: "envio",
          texto: resultado.error ?? "Não foi possível alterar o envio.",
        });
        return;
      }
      toast.success(
        ligar
          ? "Envio de conversões ligado."
          : "Envio de conversões desligado.",
      );
    });
  };

  const controlesLiberados = podeGerenciar && !pendente;

  // A trava do envio: ligado, sempre da para desligar; desligado, so liga
  // com o modo escolhido e salvo.
  const envioTravado =
    !controlesLiberados || (!atual.envio_ativado && !atual.modo_user_data);
  const seletorDoModo = (
    <Select
      value={modoEscolhido}
      onValueChange={setModoEscolhido}
      disabled={!controlesLiberados}
    >
      <SelectTrigger id="meta-modo" className="w-full">
        <SelectValue placeholder="Escolha como os dados saem" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ctwa_apenas">
          Só o identificador do anúncio (sem dado pessoal)
        </SelectItem>
        <SelectItem value="telefone_hasheado">
          Identificador do anúncio e telefone protegido
        </SelectItem>
      </SelectContent>
    </Select>
  );
  const chaveDoEnvio = (
    <Switch
      id="meta-envio"
      checked={atual.envio_ativado}
      onCheckedChange={alternarEnvio}
      disabled={envioTravado}
    />
  );

  const botaoSalvarConta = (
    <Button
      onClick={() => salvarConta("conta")}
      disabled={!podeGerenciar || pendente}
    >
      <Check className="size-4" />
      {pendente ? "Salvando..." : "Salvar conta"}
    </Button>
  );
  // O modo e gravado junto da conta: o passo do envio tem o proprio botao,
  // para ninguem precisar voltar ao passo 1 so para salvar a escolha.
  const botaoSalvarModo = (
    <Button
      variant="outline"
      onClick={() => salvarConta("envio")}
      disabled={
        !podeGerenciar ||
        pendente ||
        modoEscolhido === (atual.modo_user_data ?? "")
      }
    >
      Salvar escolha
    </Button>
  );
  const erroDe = (onde: ParteDaMeta) =>
    erro?.onde === onde ? (
      <Aviso tom="alert" role="alert">
        {erro.texto}
      </Aviso>
    ) : null;
  const botaoSalvarToken = (
    <Button
      variant="outline"
      onClick={salvarToken}
      disabled={!podeGerenciar || pendente || token.trim().length < 20}
    >
      Salvar token
    </Button>
  );

  const cartaoDaConta = (
    <>
      {erroDe("conta")}
      <Card>
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            {/* Ladrilho da Meta: decorativo, a cor nao diz estado. */}
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-md bg-meta/10"
            >
              <Megaphone className="size-5 text-meta" />
            </span>
            <div className="grid min-w-0 gap-[3px]">
              <CardTitle>Conta de anúncios</CardTitle>
              <CardDescription>
                Usada para ler o investimento nos anúncios e para devolver as
                conversões. Embaixo de cada campo está onde achar o número na
                Meta.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-[13px] text-text-secondary">
            Com eles preenchidos, a clínica devolve as conversões da aba Jornada
            para os anúncios.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <Label htmlFor="meta-pixel">Pixel (conjunto de dados)</Label>
              <Input
                id="meta-pixel"
                value={pixel}
                onChange={(evento) => setPixel(evento.target.value)}
                placeholder="Só números"
                inputMode="numeric"
                className="cz-num"
                disabled={!podeGerenciar}
              />
              <OndeEncontroDoCampo ajuda={ONDE_ENCONTRAR.pixel} />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="meta-conta">Conta de anúncios</Label>
              <Input
                id="meta-conta"
                value={contaAnuncios}
                onChange={(evento) => setContaAnuncios(evento.target.value)}
                placeholder="act_1234567890"
                className="cz-num"
                aria-describedby="meta-conta-ajuda"
                disabled={!podeGerenciar}
              />
              <p id="meta-conta-ajuda" className="text-[11px] text-text-secondary">
                Só os números, com ou sem act_ na frente. Também vale colar o
                link do Gerenciador de Anúncios.
              </p>
              <OndeEncontroDoCampo ajuda={ONDE_ENCONTRAR.contaDeAnuncios} />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="meta-waba">
                Conta do WhatsApp Business (WABA)
              </Label>
              <Input
                id="meta-waba"
                value={waba}
                onChange={(evento) => setWaba(evento.target.value)}
                placeholder="Só números"
                inputMode="numeric"
                className="cz-num"
                disabled={!podeGerenciar}
              />
              <p className="text-[11px] text-text-secondary">
                Necessária para casar a conversão com o clique do anúncio de
                WhatsApp.
              </p>
              <OndeEncontroDoCampo ajuda={ONDE_ENCONTRAR.waba} />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="meta-teste">Código de evento de teste</Label>
              <Input
                id="meta-teste"
                value={codigoTeste}
                onChange={(evento) => setCodigoTeste(evento.target.value)}
                placeholder="TEST12345"
                className="cz-num"
                disabled={!podeGerenciar}
              />
              <p className="text-[11px] text-text-secondary">
                Com o código preenchido, os eventos aparecem na aba de teste do
                Gerenciador de Eventos, sem sujar o dado real. Apague depois de
                validar.
              </p>
              <OndeEncontroDoCampo ajuda={ONDE_ENCONTRAR.codigoDeTeste} />
            </div>
          </div>
          <div className="flex min-h-10 items-start gap-2.5">
            <Checkbox
              id="meta-sem-id"
              className="mt-0.5"
              checked={semIdentificador}
              onCheckedChange={(valor) => setSemIdentificador(valor === true)}
              disabled={!controlesLiberados}
            />
            <div className="grid gap-0.5">
              <Label htmlFor="meta-sem-id">
                Enviar também conversões sem identificador do anúncio
              </Label>
              <span className="text-[11px] text-text-secondary">
                Vale só quando o envio com telefone protegido estiver liberado.
                Salve a conta para guardar esta escolha.
              </span>
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          {podeGerenciar ? (
            botaoSalvarConta
          ) : (
            <DisabledWithHint hint={dica}>{botaoSalvarConta}</DisabledWithHint>
          )}
        </CardFooter>
      </Card>
    </>
  );

  const cartaoDoInvestimento = (
    <InvestimentoMetaCard
      adAccountId={atual.ad_account_id}
      temTokenDeLeitura={temTokenDeLeitura}
      leitura={leitura}
      timezone={timezone}
      agoraMs={agoraMs}
      podeGerenciar={podeGerenciar}
      dica={dica}
    />
  );

  const cartaoDoToken = (
    <>
      {erroDe("token")}
      <Card>
        <CardHeader>
          <CardTitle>Token da API de conversões</CardTitle>
          <CardAction>
            <StatusChip
              size="sm"
              definition={TOKEN_META_STATUS[temToken ? "salvo" : "ausente"]}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-[13px] text-text-secondary">
            {temToken
              ? "Cole um novo para substituir; por segurança, o valor atual nunca é mostrado."
              : "Gere o token na Meta, pelo caminho abaixo, e cole aqui. Depois de salvo, ele não aparece de novo, por segurança."}
          </p>
          <OndeEncontro ajuda={ONDE_ENCONTRAR.tokenDeConversoes} />
          <div className="flex flex-wrap gap-2">
            <Input
              type="password"
              value={token}
              onChange={(evento) => setToken(evento.target.value)}
              placeholder="Cole o token aqui"
              aria-label="Token da API de conversões"
              className="min-w-0 flex-1 font-mono"
              disabled={!podeGerenciar}
              autoComplete="off"
            />
            {podeGerenciar ? (
              botaoSalvarToken
            ) : (
              <DisabledWithHint hint={dica}>
                {botaoSalvarToken}
              </DisabledWithHint>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );

  const cartaoDoEnvio = (
    <>
      {erroDe("envio")}
      <Card>
        <CardHeader>
          <CardTitle>Envio das conversões</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="meta-modo">Como os dados saem da clínica</Label>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1 basis-64">
                {podeGerenciar ? (
                  seletorDoModo
                ) : (
                  <DisabledWithHint className="w-full" hint={dica}>
                    {seletorDoModo}
                  </DisabledWithHint>
                )}
              </div>
              {podeGerenciar ? (
                botaoSalvarModo
              ) : (
                <DisabledWithHint hint={dica}>{botaoSalvarModo}</DisabledWithHint>
              )}
            </div>
          </div>

          <div className="flex min-h-10 items-center gap-2.5">
            {envioTravado ? (
              <DisabledWithHint
                hint={
                  !podeGerenciar
                    ? dica
                    : "Para ligar, cadastre o Pixel e o token, escolha como os dados saem e salve."
                }
              >
                {chaveDoEnvio}
              </DisabledWithHint>
            ) : (
              chaveDoEnvio
            )}
            <Label htmlFor="meta-envio">
              {atual.envio_ativado
                ? "Devolvendo conversões para a Meta"
                : "Devolver conversões para a Meta"}
            </Label>
          </div>

          <p className="text-xs text-text-secondary">
            Enquanto o envio está desligado, a clínica já registra as conversões
            das etapas da Jornada. Ao ligar, os registros dos últimos{" "}
            <span className="cz-num">7</span> dias são enviados (a Meta não
            aceita mais antigos) e o painel de Resultados mostra cada situação.
          </p>
          <p className="text-xs text-text-secondary">
            Quais etapas viram conversão, e com qual evento, a clínica escolhe
            em{" "}
            <Link
              href="/configuracoes?aba=jornada"
              prefetch={false}
              className="font-semibold text-primary-text underline underline-offset-2"
            >
              Jornada e conversões
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </>
  );

  return {
    conta: cartaoDaConta,
    token: cartaoDoToken,
    envio: cartaoDoEnvio,
    investimento: cartaoDoInvestimento,
  };
}
