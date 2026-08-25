"use client";

import { ShieldCheck, ShieldOff, ShieldX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  concederConsentimentoAction,
  revogarConsentimentoAction,
} from "@/app/(app)/leads/actions";
import { BotaoProtegido } from "@/components/cadastros/comum";
import { dataLocal } from "@/components/leads/rotulos";
import {
  BlocoFicha,
  LinhaDaFicha,
  rotuloDaFonte,
} from "@/components/pacientes/comum";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConsentimentoVigente } from "@/lib/queries/pacientes";

// Autorizacao para receber mensagens (regra 3.3: sem ela a clinica nao
// dispara nada). Tres situacoes, cada uma com icone de forma propria, rotulo
// em texto e cor: nunca autorizou, autorizada e revogada. Revogacao e
// definitiva: so volta se a pessoa autorizar de novo e alguem registrar como
// foi, com evidencia (o gatilho do banco confere de novo).

const FONTES = [
  { value: "recepcao", label: "Recepção" },
  { value: "conversa", label: "Conversa no WhatsApp" },
  { value: "formulario_site", label: "Formulário do site" },
  { value: "anuncio_ctwa", label: "Anúncio no WhatsApp" },
  { value: "importacao_planilha", label: "Planilha importada" },
];

type Situacao = "sem_autorizacao" | "autorizado" | "revogado";

function situacaoDe(consentimento: ConsentimentoVigente): Situacao {
  if (!consentimento) {
    return "sem_autorizacao";
  }
  return consentimento.revoked_at === null ? "autorizado" : "revogado";
}

function Selo({ situacao }: { situacao: Situacao }) {
  if (situacao === "autorizado") {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium [color:var(--success-text)]">
        <ShieldCheck
          strokeWidth={1.5}
          className="size-4 shrink-0"
          aria-hidden
        />
        Autorizado a receber mensagens
      </span>
    );
  }
  if (situacao === "revogado") {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium [color:var(--alert-text)]">
        <ShieldX strokeWidth={1.5} className="size-4 shrink-0" aria-hidden />
        Pediu para não receber mensagens
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-text-secondary">
      <ShieldOff strokeWidth={1.5} className="size-4 shrink-0" aria-hidden />
      Sem autorização registrada
    </span>
  );
}

export function AutorizacaoMensagens({
  contactId,
  consentimento,
  timezone,
  podeEditar,
  dica,
}: {
  contactId: string;
  consentimento: ConsentimentoVigente;
  timezone: string;
  podeEditar: boolean;
  dica: string;
}) {
  const router = useRouter();
  const situacao = situacaoDe(consentimento);
  const exigeEvidencia = situacao === "revogado";

  const [registrarAberto, setRegistrarAberto] = useState(false);
  const [descadastroAberto, setDescadastroAberto] = useState(false);
  const [fonte, setFonte] = useState("recepcao");
  const [evidencia, setEvidencia] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const registrar = async () => {
    if (exigeEvidencia && evidencia.trim().length < 2) {
      setErro("Descreva como a pessoa autorizou de novo.");
      return;
    }
    setSalvando(true);
    setErro(null);
    const resultado = await concederConsentimentoAction({
      contact_id: contactId,
      source: fonte,
      evidence: evidencia.trim() || undefined,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível registrar a autorização.");
      return;
    }
    toast.success("Autorização registrada");
    setRegistrarAberto(false);
    setEvidencia("");
    router.refresh();
  };

  const descadastrar = async () => {
    setSalvando(true);
    setErro(null);
    const resultado = await revogarConsentimentoAction({
      contact_id: contactId,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível descadastrar.");
      return;
    }
    toast.success("Paciente descadastrado das mensagens");
    setDescadastroAberto(false);
    router.refresh();
  };

  return (
    <BlocoFicha
      titulo="Autorização para receber mensagens"
      acao={
        situacao === "autorizado" ? (
          <BotaoProtegido
            podeEditar={podeEditar}
            dica={dica}
            variant="outline"
            size="sm"
            onClick={() => {
              setErro(null);
              setDescadastroAberto(true);
            }}
          >
            Descadastrar
          </BotaoProtegido>
        ) : (
          <BotaoProtegido
            podeEditar={podeEditar}
            dica={dica}
            variant="outline"
            size="sm"
            onClick={() => {
              setErro(null);
              setRegistrarAberto(true);
            }}
          >
            {situacao === "revogado"
              ? "Registrar nova autorização"
              : "Registrar autorização"}
          </BotaoProtegido>
        )
      }
    >
      <div className="grid gap-2">
        <Selo situacao={situacao} />
        {consentimento && situacao === "autorizado" ? (
          <>
            <LinhaDaFicha rotulo="Como autorizou">
              {rotuloDaFonte(consentimento.source)}
            </LinhaDaFicha>
            <LinhaDaFicha rotulo="Desde">
              {dataLocal(consentimento.granted_at, timezone)}
            </LinhaDaFicha>
          </>
        ) : null}
        {consentimento?.revoked_at ? (
          <>
            <LinhaDaFicha rotulo="Descadastrada em">
              {dataLocal(consentimento.revoked_at, timezone)}
            </LinhaDaFicha>
            <p className="text-sm text-text-secondary">
              A clínica não envia nada para este paciente, nem confirmação de
              consulta. Isso só volta se ele autorizar de novo e alguém
              registrar aqui.
            </p>
          </>
        ) : null}
        {situacao === "sem_autorizacao" ? (
          <p className="text-sm text-text-secondary">
            Sem autorização, a clínica não envia mensagem para este paciente.
          </p>
        ) : null}
      </div>

      <Dialog open={registrarAberto} onOpenChange={setRegistrarAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {exigeEvidencia
                ? "Registrar nova autorização"
                : "Registrar autorização"}
            </DialogTitle>
            <DialogDescription>
              {exigeEvidencia
                ? "Este paciente pediu para não receber mensagens. Só registre se ele autorizou de novo, e descreva como."
                : "Registre como o paciente autorizou a clínica a mandar mensagem no WhatsApp."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="consent-fonte">Como autorizou</Label>
              <Select value={fonte} onValueChange={setFonte}>
                <SelectTrigger id="consent-fonte" className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONTES.map((opcao) => (
                    <SelectItem key={opcao.value} value={opcao.value}>
                      {opcao.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="consent-evidencia">
                {exigeEvidencia
                  ? "Evidência (obrigatória)"
                  : "Evidência (opcional)"}
              </Label>
              <Input
                id="consent-evidencia"
                value={evidencia}
                onChange={(e) => setEvidencia(e.target.value)}
                className="h-10"
                maxLength={500}
                placeholder="Ex.: pediu no balcão em 25/08, na frente da recepção"
              />
            </div>
            {erro ? (
              <p role="alert" className="text-sm [color:var(--alert-text)]">
                {erro}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                className="h-10"
                onClick={() => setRegistrarAberto(false)}
              >
                Cancelar
              </Button>
              {/* sem a evidencia o botao nem fica disponivel; a checagem
                  continua na action e no gatilho, que sao a garantia */}
              <Button
                className="h-10"
                onClick={() => void registrar()}
                disabled={
                  salvando || (exigeEvidencia && evidencia.trim().length < 2)
                }
              >
                {salvando ? "Registrando..." : "Registrar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={descadastroAberto} onOpenChange={setDescadastroAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Descadastrar das mensagens</DialogTitle>
            <DialogDescription>
              O paciente para de receber tudo, inclusive confirmação de consulta
              e lembrete. Isso só volta se ele autorizar de novo e alguém
              registrar aqui, com a evidência de como foi.
            </DialogDescription>
          </DialogHeader>
          {erro ? (
            <p role="alert" className="text-sm [color:var(--alert-text)]">
              {erro}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="h-10"
              onClick={() => setDescadastroAberto(false)}
            >
              Cancelar
            </Button>
            <Button
              className="h-10 [color:var(--alert-text)]"
              variant="outline"
              onClick={() => void descadastrar()}
              disabled={salvando}
            >
              {salvando ? "Descadastrando..." : "Descadastrar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </BlocoFicha>
  );
}
