import { FileImage } from "lucide-react";

import { dataLocal } from "@/components/leads/rotulos";
import {
  BlocoFicha,
  LinhaDaFicha,
  SemDado,
} from "@/components/pacientes/comum";
import {
  TIPOS_DE_DOCUMENTO_DO_CONTATO,
  type DocumentoDoContato,
} from "@/lib/queries/pacientes";

// Os documentos que a pessoa mandou pelo WhatsApp e o assistente reconheceu
// (decisao do dono de 09/11/2026): o documento com foto e a foto da
// carteirinha, o mais novo de cada. O link abre o arquivo pela rota de midia,
// que assina a URL com a sessao: a RLS da mensagem decide quem abre, e a
// mensagem apagada some daqui. So leitura.

const ROTULO_DO_DOCUMENTO = {
  documento_com_foto: "Documento com foto",
  carteirinha: "Foto da carteirinha",
} as const;

export function DocumentosDoPaciente({
  documentos,
  timezone,
}: {
  /** null: a leitura falhou (a ficha continua de pe). */
  documentos: readonly DocumentoDoContato[] | null;
  timezone: string;
}) {
  return (
    <BlocoFicha titulo="Documentos pelo WhatsApp">
      {documentos === null ? (
        <SemDado texto="Não foi possível carregar os documentos. Atualize a página para tentar de novo." />
      ) : (
        <div className="grid gap-2">
          {TIPOS_DE_DOCUMENTO_DO_CONTATO.map((tipo) => {
            const documento = documentos.find((d) => d.tipo === tipo);
            return (
              <LinhaDaFicha key={tipo} rotulo={ROTULO_DO_DOCUMENTO[tipo]}>
                {documento ? (
                  <span className="inline-flex flex-wrap items-center gap-x-2">
                    <a
                      href={`/api/atendimento/midia/${documento.messageId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Ver ${ROTULO_DO_DOCUMENTO[tipo].toLowerCase()}, abre em outra aba`}
                      className="inline-flex h-10 items-center gap-1.5 rounded-md font-semibold text-text-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                    >
                      <FileImage className="size-4" aria-hidden="true" />
                      Ver arquivo
                    </a>
                    <span className="text-text-secondary">
                      enviado em{" "}
                      <span className="cz-num">
                        {dataLocal(documento.enviadoEm, timezone)}
                      </span>
                    </span>
                  </span>
                ) : (
                  <SemDado texto="Ainda não enviado" />
                )}
              </LinhaDaFicha>
            );
          })}
        </div>
      )}
    </BlocoFicha>
  );
}
