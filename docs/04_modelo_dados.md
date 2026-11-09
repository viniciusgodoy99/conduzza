

## 46. Os documentos do paciente pelo WhatsApp (decisão do dono de 09/11/2026, migration `20261109100000_documentos_do_paciente.sql`; **aplicada na produção em 09/11/2026**, em 309 ms, com ENSAIO OK e nenhuma sessão esperando trava)

- **Tabela nova `documento_do_contato`:** `id`, `clinic_id`, `contact_id`, `conversation_id`, `message_id` (único), `tipo` (`documento_com_foto` ou `carteirinha`) e `created_at`; índice por clínica, contato, tipo e data. **Sem FK**, como `ai_turno` e `ia_janela_da_conversa`: não trava `contact`, `message`, `conversation` nem `clinic`.
- **RLS:** ligada; ninguém grava pela API (`revoke` de tudo, `grant select` para a sessão e a service role). Leitura: a regra de `message` (membro ativo da clínica; o profissional só a conversa atribuída a ele) mais a mensagem não apagada.
- **`gravar_leitura_da_midia`:** igual à da `20261106140000`, mais o passo que grava o documento na primeira leitura da mensagem: o tipo `documento_de_identidade` vira `documento_com_foto` e a `carteirinha` vira `carteirinha`, só com confiança alta ou média (`on conflict (message_id) do nothing`). Nada do documento é guardado: o tipo e a mensagem. Corpo novo md5 `509a2ab193bbe13617f8551e255bfdae`; o de antes, `0ab0639ca252ebb7eeac638a07bdf79c`.
- **Rollback:** `supabase/operacao/rollback/20261109100000-documentos.sql` (volta o corpo de antes e tira a tabela), depois de voltar o código.
- **Tipos:** o bloco da tabela gerado pelo `supabase gen types` foi para `lib/supabase/database.types.ts`; as diferenças com o gerado continuam as 26 + 2 antigas.
