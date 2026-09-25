# Mais de um número de WhatsApp por clínica: desenho técnico

Frente aberta em 25/09/2026 a pedido do dono do produto. Plano aprovado em fases publicáveis (ver docs/05, entrada da frente).
Este arquivo é a referência técnica para quem implementa: modelo, compatibilidade, fila, código e telas.

## Decisões do dono (25/09/2026)

1. **Uma conversa por número.** O mesmo paciente falando com dois números da clínica tem duas conversas, e cada uma responde
   pelo próprio número. O cartão e o cabeçalho mostram o número.
2. **Envio automático.** Confirmação, pós-falta, follow-up, lista de espera, aviso de remarcação e Cobrar agora saem por padrão
   pelo **último número para o qual o paciente escreveu**. Se ele nunca escreveu, saem pelo **principal**. Quem configura as
   automações pode escolher **"sempre pelo número X"**.
3. **Identificação.** Cada número tem **nome livre** e **unidade opcional**.
4. **Limite.** **Sem limite por enquanto**: `clinic.limite_de_numeros` nulo. Só o dono do produto altera. Os planos futuros
   (1, 2, 3 números) passam a definir esse campo.

Decisões assumidas pela recomendação (valem até o dono mudar):

- **D1.** O número existente vira "Número principal" (renomeável).
- **D2.** Resposta curta sem citação só vale para toque enviado pelo **mesmo** número.
- **D3.** Remover um número encerra as conversas abertas dele, com evento de sistema. O histórico fica.
- **D4.** O eco da resposta ao toque sai pelo número que recebeu, mesmo no modo fixo.
- **D5.** Unicidade de `wa_message_id` por número fica para a fase final, que depende do aval do dono e de um ajuste no
  CLAUDE.md 3.3.
- **D6.** A faixa de desconectado considera o principal e os números que já conectaram alguma vez (`connected_at not null`).
- **D7.** Na lista de espera, o paciente cujo número está desconectado fica fora desta onda, sem entrar em `offered_to`.
- **D8.** Remover número: só administrador. Adicionar, conectar, renomear, unidade e principal: administrador e gestor.
- **D9.** "Último usado" = `last_inbound_at`, depois `last_message_at`.
- **Número desconectado:** o envio espera a reconexão e **nunca troca de número sozinho**. A exceção é o número **removido**:
  os jobs pendentes dele são redistribuídos pela `conta_de_envio`.

### Como a espera funciona (detalhe de implementação, 25/09)

A revisão das Fases 3 e 4 achou que a espera não cumpria a regra acima: cada volta somava no teto de 20 devoluções da fila
(`reagendar_job`) e o toque morria em cerca de 95 minutos, antes de a clínica reconectar. A migration
`20260925141000_espera_do_canal.sql` e `lib/domain/espera-do-canal.ts` corrigem assim:

- Esperar o canal (motivos `desconectado` e `sem_numero`) **não conta no teto de 20**, que continua valendo para o "canal que
  não abre" (`canal_ocupado` e o resto). O contador próprio fica em `job_queue.payload.esperas_do_canal`, com teto de
  segurança de 400.
- A desistência é por **prazo fixo**: confirmação, até a hora da consulta; outras réguas, 12 horas depois da primeira
  abertura da janela de envio a partir do vencimento; envio avulso (aviso de remarcação, Cobrar agora), até a consulta do
  payload ou 12 horas depois de criado.
- A volta cresce de 5 até 30 minutos (a mesma regra da lista de espera).
- Com o número do job desconectado, a régua vai direto para a espera, sem baixar o anexo nem abrir conversa.

**Status `conectando` só existe em pareamento aberto** (clique em Conectar ou QR na tela). Um evento `connecting` de uma
sessão já pareada não rebaixa o número. Isso importa porque a entrada da ingestão segura (503) a mensagem de um número em
pareamento enquanto a trava do mesmo celular não decide, e o uazapi reenvia o webhook só cerca de 3 vezes.

## Estado de produção em 25/09 (Fase 0)

| Item | Valor |
|---|---|
| Números | 3 (todos uazapi): 2 conectados, 1 desconectado |
| Conversas de clínica sem conta | 0 |
| Segredos órfãos | 0 |
| `instance_id` duplicado | 0 |
| `display_phone` repetido | 0 |
| Volume | 168 conversas e 5.364 mensagens |
| Servidor uazapi (compartilhado) | 32 instâncias: 3 do Conduzza, 21 desconectadas no total |

## Achados que mudam o desenho

1. **`message.wa_message_id` é unique global.** O envio grava o `messageid` cru, e o webhook de quem recebe entrega o mesmo id.
   Por isso, uma mensagem do número A da clínica para o número B se perde (`on conflict do nothing`).
   Mitigação na Fase 1B: filtro de número próprio no ingest. A correção completa é a Fase 5.
2. **O claim de jobs trava a LINHA DA CLÍNICA** (`for update skip locked` em `clinic`). A fila por raia precisa de uma trava por
   raia, com um CTE por ramo, porque `FOR UPDATE` não aceita `UNION`.
3. **Muitos testes inserem conversa em clínica SEM conta.** Por isso o NOT NULL só entra na fase de contrato, depois que os
   testes passarem a usar o helper `criarNumeroDeTeste`.
4. **`loadAccount` faz upsert com `onConflict: "clinic_id"`**, e as fixtures inserem o segredo só com `clinic_id`. O unique
   temporário `(clinic_id)` e o gatilho de preenchimento do segredo ficam até o contrato.
5. **`instance_id` guarda o NOME da instância.** `nomeDaInstancia` precisa gerar nomes únicos por número. O fake gera
   `fake-${clinicId.slice(0,8)}`, que colide com dois números.
6. **Toda reserva de slot faz UPDATE em `whatsapp_account`**, que está no Realtime, e o Inbox faz `router.refresh()` a cada
   UPDATE. Hoje cada envio recarrega todas as abas. A partir da Fase 2, recarregar só quando o status mudar.
7. **Reabrir trata 23505 com `.maybeSingle()` sem `limit`**, o que quebra com duas conversas abertas. Filtrar por número.
8. **O interceptador junta o contexto de TODAS as conversas do contato.** Precisa filtrar pelo número (D2).
9. **`MOTOR_MAX_CLINICAS = 4`** dá cerca de 12 envios por minuto no produto inteiro. Subir e medir na Fase 3.
10. **O mesmo celular pareado em duas instâncias** duplica a entrada, inclusive entre clínicas (risco LGPD). Bloquear no
    `persistStatus`.
11. **A v1 de `reservar_slot_envio(uuid, integer)` está viva e sem chamador.** Sai na Fase 3.
12. **Não há embed PostgREST de `whatsapp_account` em lugar nenhum.** A troca de PK não quebra select aninhado.

## Modelo de dados

### `whatsapp_account` (um número)

- `id uuid not null default gen_random_uuid()` vira a **PK**. `clinic_id` vira FK comum (NOT NULL, cascade).
- `nome text not null default 'Número principal'`, com check de 1 a 40 caracteres e unique
  `(clinic_id, lower(nome)) where removido_em is null`.
- `unit_id uuid null references unit(id) on delete set null`, com ramo novo em `exigir_cadastro_da_mesma_clinica()`.
- `principal boolean not null default false`:
  - índice único parcial `(clinic_id) where principal and removido_em is null`;
  - `check (not (principal and removido_em is not null))`.
- `removido_em timestamptz null` e `removido_por uuid null`: remoção lógica.
- Unique `(provider, instance_id) where instance_id is not null and removido_em is null`.
- **Temporário:** `constraint whatsapp_account_uma_por_clinica unique (clinic_id)`. Nasce na 1A e sai na Fase 3.
- Gatilho `antes_de_criar_numero` (BEFORE INSERT, e UPDATE de `removido_em` para nulo):
  - `pg_advisory_xact_lock` por clínica;
  - limite (erro `23514`, "Esta clínica atingiu o limite de números do plano.");
  - sem principal ativo, `new.principal := true`.
- Gatilho `adotar_conversas_orfas` (AFTER INSERT, quando `new.principal`): conversas e mensagens da clínica com número nulo
  passam a este número.
- RLS: SELECT para membro ativo, como hoje. Escrita só pelo service role, nas Server Actions.

### `whatsapp_account_secret`

- `account_id uuid not null references whatsapp_account(id) on delete cascade`, com backfill. Vira a **PK**.
- `clinic_id` continua (tenant), com gatilho de coerência com a conta.
- Gatilho temporário `preencher_conta_do_segredo` (BEFORE INSERT com `account_id` nulo): usa o principal ativo. Sai na Fase 3.
- Unique temporário `(clinic_id)`. Sai na Fase 3.
- RLS sem policy (só o service role).

### `conversation.whatsapp_account_id`

- FK **NO ACTION**, para o cascade de apagar clínica continuar funcionando. Nulável na 1B, com backfill.
- Gatilho `conversa_ganha_numero` (BEFORE INSERT): nulo vira o principal; exige mesma clínica. No UPDATE, só pode ir de nulo
  para valor.
- Fase 3: NOT NULL e o novo índice `conversation_aberta_por_numero (clinic_id, contact_id, whatsapp_account_id) where status
  <> 'resolvida'`, criado ANTES de derrubar `conversation_aberta_por_contato`.

### `message.whatsapp_account_id`

- Desnormalizada. Gatilho `mensagem_herda_numero` (BEFORE INSERT, security definer) SEMPRE sobrescreve com o número da
  conversa. É imutável.
- Índice `(whatsapp_account_id, wa_message_id) where wa_message_id is not null`. NOT NULL na Fase 3.

### `job_queue.whatsapp_account_id`

- Nulável, com gatilho de mesma clínica e índice `(whatsapp_account_id, prioridade, run_at) where status = 'pendente' and
  whatsapp_account_id is not null`.
- Gatilho `job_ganha_numero` (BEFORE INSERT): quando o número vem nulo e o kind é `enviar_mensagem_ativa` ou
  `executar_passo_de_regua`, resolve pela `conta_de_envio`. O contato vem de `payload->>'contact_id'`, ou de `cadence_run` via
  `payload->>'cadence_run_id'`.
- Motivo novo de pulo: `'numero_removido'` no `cadence_run_skipped_reason_check`.

### `clinic.limite_de_numeros`

- `integer null check (> 0)`. Nulo significa sem limite, que é o padrão de todas as clínicas.
- Gatilho `proteger_limite_de_numeros`: com `auth.uid()` presente e sem `is_product_admin()`, uma mudança do valor recebe erro
  `42501`.

### `whatsapp_envio_automatico` (política)

- `clinic_id` PK; `modo 'ultimo_usado' | 'fixo'` (padrão `ultimo_usado`); `conta_fixa_id`.
- Check `(modo = 'fixo') = (conta_fixa_id is not null)`, mais gatilho de mesma clínica e número ativo.
- Sem linha, vale `ultimo_usado`.
- RLS: SELECT para membro ativo; INSERT e UPDATE para `user_has_role(clinic_id, array['admin','gestor'])`.

### `conta_de_envio(p_clinic_id, p_contact_id) returns uuid`

- Stable, security definer, `search_path = public`.
- Com `auth.uid()` presente, confere que a clínica é do usuário (senão erro 42501).
- Ordem de escolha:
  1. modo fixo com número ativo;
  2. a conversa do contato cujo número está ativo, ordenada por `last_inbound_at desc nulls last, last_message_at desc nulls last`;
  3. o principal ativo.
- Versão em lote `contas_de_envio(p_clinic_id, p_contact_ids uuid[]) returns table(contact_id, whatsapp_account_id, nome,
  connection_status)`.

## Compatibilidade

Toda RPC ganha o parâmetro de número com padrão nulo, na mesma transação (drop e create). Nulo significa principal (entrada) ou
`conta_de_envio` (envio). Grants só para `service_role`, como hoje.

| RPC | Mudança |
|---|---|
| `reservar_slot_envio_v2` | Ganha `p_whatsapp_account_id uuid default null` (nulo = principal) e trava `where id = v_conta for update` |
| `ingest_inbound_message` | Ganha o 11º argumento `p_whatsapp_account_id default null` (nulo = principal). A conversa usa `on conflict do nothing` SEM alvo. A busca aceita número nulo com adoção. Inclui o filtro de número próprio |
| `garantir_conversa_aberta` | Ganha `p_whatsapp_account_id default null` (nulo = `conta_de_envio`) e usa `on conflict do nothing` sem alvo |
| `registrar_apagamento_do_whatsapp` | Ganha `p_whatsapp_account_id default null` (com valor, filtra) |
| `planejar_reguas` e `criar_oferta_de_espera` | Só o corpo muda: carimbam o número |

**Webhook:**
- URL nova: `?clinic=<clinic>&account=<account>&secret=<secret>`.
- A URL antiga `?clinic=&secret=` continua valendo: acha, entre os segredos da clínica, o que bate (comparação em tempo
  constante) e registra `log.info("webhook_url_legada")`.
- Número removido recebe 401 (a remoção gira o `webhook_secret`).

**Prova de compatibilidade:** a suíte inteira (RLS, integração, e2e) passa **sem mudança de código** depois das migrations 1A e 1B.

## Fila por raia (Fase 3)

A raia é `coalesce(whatsapp_account_id, clinic_id)`, com trava por raia:

```sql
with raia_numero as (
  select e.id, e.prioridade, e.run_at
  from whatsapp_account a join clinic c on c.id = a.clinic_id
  cross join lateral (
    select q.id, q.prioridade, q.run_at from job_queue q
    where q.whatsapp_account_id = a.id and q.kind = any(p_kinds)
      and ((q.status = 'pendente' and q.run_at <= now())
        or (q.status = 'executando' and q.locked_at < now() - interval '180 seconds'
            and q.attempts < q.max_attempts))
    order by q.prioridade, q.run_at limit 1) e
  where (p_incluir_teste or not c.e_de_teste)
  order by e.prioridade, e.run_at limit p_max_clinicas
  for update of a skip locked
),
raia_clinica as ( /* a de hoje, com q.whatsapp_account_id is null, for update of c skip locked */ ),
escolhidos as (
  select id from (select * from raia_numero union all select * from raia_clinica) t
  order by prioridade, run_at limit p_max_clinicas)
update job_queue j set status = 'executando', locked_by = p_worker, locked_at = now(), attempts = j.attempts + 1
where j.id in (select id from escolhidos) returning j.*;
```

- O ramo que enterra jobs travados fica igual.
- O anti-ban por número é garantido pelo `for update` do slot na linha do número. O claim só evita trabalho perdido.
- `lib/jobs/motor.ts`: `agruparPorRaia` (`job.whatsapp_account_id ?? job.clinic_id`); `MOTOR_MAX_CLINICAS` passa a contar raias,
  com padrão 8.

**Onde o job ganha o número:**
- no enfileiramento: o planner via `conta_de_envio`; a oferta de espera no JSON; o eco com o número que recebeu; Cobrar agora e
  aviso de remarcação via `contas_de_envio`; `baixar_midia` com o número do webhook; o resto pelo gatilho;
- na execução: `numero_do_job(p_job_id, p_worker)`, guardada pela posse, resolve e carimba;
- número removido: se já existe `message` com esse `job_id`, falha definitiva `'numero_removido'`; se não, recarimba;
- `redistribuir_jobs_do_numero(p_account_id)` roda na remoção, e na troca de política recarimba os pendentes sem `message`.

## Código (Fase 2)

- `send.ts`:
  - o número vem da conversa (uma leitura), e `input.whatsappAccountId` serve só como asserção (`conta_divergente`);
  - número removido: `reason "desconectado"`, `code "numero_removido"`;
  - slot e segredo por número;
  - `carregarInstancia(supabase, clinicId, accountId)`.
- `ingest.ts`: `ingerirMensagemRecebida(admin, clinicId, accountId, event)`.
- `route.ts`:
  - resolução do número, com o caminho legado;
  - `baixar_midia` com o número;
  - eco do celular filtrado por número, recibos filtrados por número, apagamento com o número;
  - status gravado por `id`.
- `whatsapp-connect.ts`:
  - ações por `accountId`;
  - `adicionarNumeroAction`, `atualizarNumeroAction`, `definirNumeroPrincipalAction` (RPC `definir_numero_principal`),
    `removerNumeroAction` (desconecta, `excluirInstancia`, RPC `remover_numero`, audit);
  - trava contra o mesmo celular em duas instâncias.
- `uazapi.ts`: `nomeDaInstancia(slug, clinicId, accountId)` gera `conduzza_<slug>_<8 do accountId>` para número novo (o principal
  atual não é renomeado); `excluirInstancia`.
- `fake.ts`: registra o `accountId` em cada envio e gera `instanceId` por número.
- `regua.ts` e `worker.ts`: usam o número do job.
- `lista-espera.ts`, `cobranca-manual.ts` e aviso de remarcação: `contas_de_envio`.
- `interceptar-resposta.ts`: contexto por número (D2) e eco pelo mesmo número (D4).
- `atendimento/actions.ts`: apagar pelo número de envio; reabrir e citação por número.
- `use-inbox-channel.ts`: refresh só quando o status muda.
- `log.ts`: `whatsapp_account_id` na lista fechada.
- `database.types.ts`.
- Testes: helper `criarNumeroDeTeste`.

## Telas (Fase 4)

- **Configurações > WhatsApp:**
  - cartões por número: nome, unidade, telefone em mono, status em 3 camadas (nunca só o ponto), etiquetas "Principal" e
    "Mensagens automáticas";
  - ações de 40px e menu (Renomear, Unidade, Tornar principal, Remover);
  - "Adicionar número", que mostra "N de M números do plano" quando há limite.
- **Automações:** cartão "Número das mensagens automáticas", só com mais de um número ativo.
- **Inbox:** selo, cabeçalho, filtro por número e compositor desabilitado com o motivo, tudo só com mais de um número.
- **Faixa:** nomeia o número e diz quantas automáticas esperam por ele.
- **Início:** conta como feito se houver ao menos um número conectado.

Depois da Fase 4 não há rollback de código para clínica com dois números.
