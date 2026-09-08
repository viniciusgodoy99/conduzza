# R0: a uazapi entrega o `ctwa_clid`? (runbook)

### Conduzza Clínicas, verificação que destrava o Caminho B

Decisão tomada: **replicar e largar o Tintim** (Caminho B, ver `docs/06`). Para isso, o Conduzza precisa capturar sozinho, pela uazapi, o `ctwa_clid` (o identificador do clique no anúncio Click-to-WhatsApp). O Tintim faz isso hoje quase certamente pela **API oficial da Meta**; a uazapi é **não oficial** e pode não entregar. **Este teste responde de vez.**

> **Não desligue o Tintim antes deste teste dar positivo.** Se a uazapi não entregar o `ctwa_clid`, largar o Tintim custa a atribuição em nível de clique, e o retorno à Meta cai para o casamento por telefone (mais fraco).

> **Decisão do dono (08/09/2026): o teste com anúncio de laboratório foi dispensado.** Em vez dele, a estrutura de captura nasceu pronta e defensiva (migration `20260908150000_captura_ctwa.sql` + `extrairAnuncio` em `lib/integrations/whatsapp/inbound.ts` + escrita de primeiro clique em `ingest.ts`): se a uazapi entregar qualquer vestígio de anúncio, ele é gravado em `contact`. **A produção é o próprio teste.** A tabela de leitura abaixo continua valendo, agora aplicada às colunas: enquanto `ctwa_clid` não encher com anúncio real rodando, vale a linha "não aparece nada". O laboratório deste runbook (`scripts/dev/r0-laboratorio.mts`) fica disponível se um dia o teste controlado for desejado; a instância criada em 08/09 foi apagada.

---

## Método A (recomendado): webhook de laboratório, sem tocar em produção

Zero risco de dado de paciente, porque roda num número de teste.

1. Suba uma **instância uazapi de laboratório** e pareie um **número de teste** (não o da clínica).
2. Configure o webhook dessa instância apontando para um coletor descartável: **webhook.site** (abra o site, copie a URL única) ou um RequestBin.
3. Suba um **anúncio Click-to-WhatsApp** de teste, com orçamento mínimo, apontando para esse número de teste. (Ou, se tiver um anúncio CTWA já ativo, use o número dele por um instante.)
4. Do celular, **clique no anúncio** e mande a primeira mensagem.
5. Abra o webhook.site e leia o corpo do POST que chegou. Procure, dentro de `message` (e de `message.content` / `contextInfo`), por qualquer um destes:
   - `ctwa_clid`, `ctwaClid`
   - `referral`, `externalAdReply`, `external_ad_reply`
   - `sourceId`, `source_id`, `sourceUrl`, `source_url`, `sourceType`
   - `conversionSource`, `entryPointConversion`, `conversionData`

## Método B: captura guardada em staging (se não der para usar lab)

Só em **staging/homologação**, nunca em produção com paciente real. Adicione um bloco **temporário** no início do handler, **antes** do `parseInboundEvent`, em `app/api/webhooks/whatsapp/route.ts`, e **remova depois** (a regra "nenhum dado de paciente em log" continua valendo, por isso o bloco só registra as CHAVES e os campos de anúncio, nunca o texto da mensagem):

```ts
// R0 TEMPORARIO (remover apos o teste). Guardado por env, so em staging.
// Registra apenas nomes de campos e o objeto de anuncio, nunca o corpo.
if (process.env.CAPTURA_R0 === "1") {
  const p = payload as Record<string, unknown>;
  const m = (p?.message ?? {}) as Record<string, unknown>;
  const content = m?.content;
  console.log(
    "[R0]",
    JSON.stringify({
      keys_topo: Object.keys(p ?? {}),
      keys_message: Object.keys(m ?? {}),
      referral: m?.referral ?? null,
      externalAdReply: (m?.contextInfo as Record<string, unknown>)?.externalAdReply ?? null,
      ctwa: m?.ctwa_clid ?? m?.ctwaClid ?? null,
      content_keys:
        content && typeof content === "object"
          ? Object.keys(content as Record<string, unknown>)
          : typeof content,
    }),
  );
}
```

Rode `CAPTURA_R0=1` no processo de staging, clique num anúncio CTWA que aponte para o número de staging, e leia a linha `[R0]` no log. **Apague o bloco antes de qualquer merge.**

---

## Como ler o resultado

| Resultado | Significado | O que fazer |
|---|---|---|
| Aparece `ctwa_clid` (ou `referral`/`externalAdReply` com o id do anúncio) | A uazapi entrega. Caminho B viável com qualidade máxima. | Seguir para R1 (persistir), depois R3/R4 (CAPI). |
| Aparece o anúncio (campanha/anúncio) mas **sem** `ctwa_clid` | Dá para atribuir a campanha, mas o retorno à Meta terá que casar por telefone. | Caminho B parcial: atribuição sim, CAPI por PII. |
| Não aparece nada de anúncio | A uazapi não repassa o referral. | Não largar o Tintim, ou migrar para a Cloud API oficial (o adaptador do projeto já prevê `cloud_api`). |

## Depois do R0

- **Positivo:** implementar R1 (estender `inbound.ts` e `ingest.ts` para gravar `ctwa_clid` e ids do anúncio no `contact`), depois o CAPI (R3/R4).
- **Negativo:** reabrir a decisão D0 com o dado na mão. A ponte com o n8n/Tintim continua sendo o backfill enquanto isso.

> Observação de migração: Tintim (oficial) e Conduzza (uazapi) dificilmente ficam no mesmo número ao mesmo tempo. Planeje a troca do número, e faça o R0 num número de teste antes de mover o número da clínica.
