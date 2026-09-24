"use client";

import { Check, KeyRound, SendHorizonal } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  alternarEnvioMetaAction,
  salvarContaMetaAction,
  salvarTokenMetaAction,
} from "@/app/(app)/configuracoes/actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
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
import { Switch } from "@/components/ui/switch";

// Aba Anuncios da Meta (R6): a conta que recebe as conversoes de volta.
//
// O TOKEN E WRITE-ONLY: o servidor nunca manda o valor para ca, so o fato de
// existir (temToken). O campo sempre nasce vazio e salvar substitui.
//
// A DECISAO D6 (LGPD) AINDA ESTA EM ABERTO: o dono adiou a escolha de como
// os dados pessoais saem (so o identificador do anuncio, ou telefone
// protegido com autorizacao). A trava DE VERDADE vive no banco (gatilho da
// migration 20260910150000, que recusa qualquer modo ate para o service
// role); esta constante so alinha a tela. A liberacao tem dois passos:
// a migration de liberacao (substitui a funcao do gatilho) e virar esta
// constante para true.
const DECISAO_LGPD_TOMADA = false;

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

export function MetaAdsTab({
  conta,
  temToken,
  podeGerenciar,
  dica,
}: {
  conta: ContaMeta | null;
  temToken: boolean;
  podeGerenciar: boolean;
  dica: string;
}) {
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
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const salvarConta = () => {
    setErro(null);
    startTransition(async () => {
      const resultado = await salvarContaMetaAction({
        pixel_id: pixel.trim() || null,
        ad_account_id: contaAnuncios.trim() || null,
        whatsapp_business_account_id: waba.trim() || null,
        test_event_code: codigoTeste.trim() || null,
        send_unmatched: semIdentificador,
        // O banco embarga qualquer modo ate a decisao D6; ate la o seletor
        // vive desabilitado e este campo viaja nulo.
        modo_user_data:
          modoEscolhido === "ctwa_apenas" ||
          modoEscolhido === "telefone_hasheado"
            ? modoEscolhido
            : null,
      });
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível salvar.");
        return;
      }
      toast.success("Conta de anúncios salva.");
    });
  };

  const salvarToken = () => {
    setErro(null);
    startTransition(async () => {
      const resultado = await salvarTokenMetaAction({
        capi_access_token: token,
      });
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível salvar o token.");
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
        setErro(resultado.error ?? "Não foi possível alterar o envio.");
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

  return (
    <div className="grid gap-4">
      <article className="grid gap-4 rounded-lg border bg-card p-4">
        <p className="text-sm font-semibold">Conta de anúncios</p>
        <p className="text-sm text-text-secondary">
          Os identificadores ficam no Gerenciador de Eventos e no Gerenciador de
          Negócios da Meta. Com eles preenchidos, a clínica devolve as
          conversões da aba Jornada para os anúncios.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="meta-pixel">Pixel (conjunto de dados)</Label>
            <Input
              id="meta-pixel"
              value={pixel}
              onChange={(evento) => setPixel(evento.target.value)}
              placeholder="Só números"
              inputMode="numeric"
              className="h-10 font-mono"
              disabled={!podeGerenciar}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="meta-conta">Conta de anúncios</Label>
            <Input
              id="meta-conta"
              value={contaAnuncios}
              onChange={(evento) => setContaAnuncios(evento.target.value)}
              placeholder="act_1234567890"
              className="h-10 font-mono"
              disabled={!podeGerenciar}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="meta-waba">Conta do WhatsApp Business (WABA)</Label>
            <Input
              id="meta-waba"
              value={waba}
              onChange={(evento) => setWaba(evento.target.value)}
              placeholder="Só números"
              inputMode="numeric"
              className="h-10 font-mono"
              disabled={!podeGerenciar}
            />
            <p className="text-[12px] text-text-tertiary">
              Necessária para casar a conversão com o clique do anúncio de
              WhatsApp. Fica no Gerenciador de Negócios, em contas do WhatsApp.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="meta-teste">Código de evento de teste</Label>
            <Input
              id="meta-teste"
              value={codigoTeste}
              onChange={(evento) => setCodigoTeste(evento.target.value)}
              placeholder="TEST12345"
              className="h-10 font-mono"
              disabled={!podeGerenciar}
            />
            <p className="text-[12px] text-text-tertiary">
              Com o código preenchido, os eventos aparecem na aba de teste do
              Gerenciador de Eventos, sem sujar o dado real. Apague depois de
              validar.
            </p>
          </div>
        </div>
        {podeGerenciar ? (
          <Button
            onClick={salvarConta}
            disabled={pendente}
            className="justify-self-start"
          >
            <Check className="size-4" />
            {pendente ? "Salvando..." : "Salvar conta"}
          </Button>
        ) : (
          <DisabledWithHint hint={dica}>
            <Button disabled className="justify-self-start">
              <Check className="size-4" />
              Salvar conta
            </Button>
          </DisabledWithHint>
        )}
      </article>

      <article className="grid gap-3 rounded-lg border bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4" aria-hidden />
          Token da API de conversões
        </p>
        <p className="text-sm text-text-secondary">
          {temToken
            ? "Token salvo. Cole um novo para substituir; por segurança, o valor atual nunca é mostrado."
            : "Gere o token no Gerenciador de Eventos (configurações do conjunto de dados, API de conversões)."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            type="password"
            value={token}
            onChange={(evento) => setToken(evento.target.value)}
            placeholder="Cole o token aqui"
            aria-label="Token da API de conversões"
            className="h-10 max-w-md font-mono"
            disabled={!podeGerenciar}
            autoComplete="off"
          />
          {podeGerenciar ? (
            <Button
              variant="outline"
              onClick={salvarToken}
              disabled={pendente || token.trim().length < 20}
            >
              Salvar token
            </Button>
          ) : (
            <DisabledWithHint hint={dica}>
              <Button variant="outline" disabled>
                Salvar token
              </Button>
            </DisabledWithHint>
          )}
        </div>
      </article>

      <article className="grid gap-4 rounded-lg border bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <SendHorizonal className="size-4" aria-hidden />
          Envio das conversões
        </p>

        <div className="grid gap-1.5">
          <Label htmlFor="meta-modo">Como os dados saem da clínica</Label>
          <DisabledWithHint
            hint={
              DECISAO_LGPD_TOMADA
                ? dica
                : "A escolha de como enviar dados pessoais depende de uma decisão de privacidade (LGPD) que ainda está em aberto."
            }
          >
            <Select
              value={modoEscolhido}
              onValueChange={setModoEscolhido}
              disabled={!DECISAO_LGPD_TOMADA || !controlesLiberados}
            >
              <SelectTrigger id="meta-modo" className="min-h-10 max-w-md">
                <SelectValue placeholder="Aguardando a decisão de privacidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ctwa_apenas">
                  Só o identificador do anúncio (sem dado pessoal)
                </SelectItem>
                <SelectItem value="telefone_hasheado">
                  Identificador do anúncio e telefone protegido (com autorização
                  do paciente)
                </SelectItem>
              </SelectContent>
            </Select>
          </DisabledWithHint>
        </div>

        <div className="flex items-center gap-2">
          <DisabledWithHint
            hint={
              !podeGerenciar
                ? dica
                : "Para ligar, cadastre o Pixel e o token e aguarde a definição de como os dados pessoais serão enviados (LGPD)."
            }
          >
            <Switch
              id="meta-envio"
              checked={atual.envio_ativado}
              onCheckedChange={alternarEnvio}
              disabled={
                !controlesLiberados ||
                (!atual.envio_ativado &&
                  (!DECISAO_LGPD_TOMADA || !atual.modo_user_data))
              }
            />
          </DisabledWithHint>
          <Label htmlFor="meta-envio">
            {atual.envio_ativado
              ? "Devolvendo conversões para a Meta"
              : "Devolver conversões para a Meta"}
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="meta-sem-id"
            checked={semIdentificador}
            onCheckedChange={setSemIdentificador}
            disabled={!controlesLiberados}
          />
          <div className="grid">
            <Label htmlFor="meta-sem-id">
              Enviar também conversões sem identificador do anúncio
            </Label>
            <span className="text-[12px] text-text-tertiary">
              Vale só quando o envio com telefone protegido estiver liberado.
              Salve a conta para guardar esta escolha.
            </span>
          </div>
        </div>

        <p className="text-[12.5px] text-text-tertiary">
          Enquanto o envio está desligado, a clínica já registra as conversões
          das etapas da Jornada. Ao ligar, os registros dos últimos 7 dias são
          enviados (a Meta não aceita mais antigos) e o painel de Resultados
          mostra cada situação.
        </p>
      </article>

      {erro ? (
        <p role="alert" className="text-sm [color:var(--alert-text)]">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
