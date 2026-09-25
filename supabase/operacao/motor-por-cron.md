# Motor de automação por pg_cron

Como o motor funciona hoje, como conferir que está vivo, como ser avisado quando ele para, e como desligar.

Ligado em 02/09/2026. **Não existe mais processo de worker em servidor nenhum.** O `npm run worker` é só ferramenta local de teste e ponte de emergência (ver "Desligar").

---

## O desenho

Três entradas no `pg_cron`, dentro do próprio Supabase:

| Entrada            | Cadência                          | O que faz                                                                               | Onde executa                  |
| ------------------ | --------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| `motor-manutencao` | 60 segundos                       | limpa reservas vencidas, fecha execuções órfãs, expira ofertas, planeja réguas, higiene | **dentro do banco**, SQL puro |
| `motor-fila`       | 20 segundos                       | chama a rota na Vercel, que processa a fila de tarefas                                  | Vercel, região de São Paulo   |
| `poda-do-cron`     | 1 vez por dia, 03:17 de Fortaleza | apaga de `cron.job_run_details` as execuções com mais de 7 dias                         | **dentro do banco**, SQL puro |

A manutenção não depende da rede: é só chamada de função. Só a fila precisa de Node, porque fala com o uazapi e com o Storage.

As duas primeiras são ligadas e desligadas pela operação (`motor_agendar()` e `motor_desagendar()`), nunca por migration: num banco de laptop elas virariam um segundo motor chamando a produção. A poda é agendada pela migration `20260924120000_poda_do_cron.sql`, porque não chama nada fora do banco.

A rota é `POST /api/webhooks/motor`. O nome tem `webhooks` de propósito: o matcher do `middleware.ts` já exclui esse prefixo, e uma rota fora dele seria redirecionada para o login com o segredo descartado, deixando o sistema idêntico a um sistema saudável enquanto nada sai.

---

## Conferir que está vivo

```sql
-- 1. as três entradas existem e estão ativas
select jobname, schedule, active, username from cron.job;

-- 2. as execuções recentes deram certo
select jobid, status, return_message, start_time
from cron.job_run_details order by start_time desc limit 10;

-- 3. a Vercel está respondendo 200
select status_code, content::jsonb->>'concluidos' as concluidos, created
from net._http_response order by created desc limit 5;

-- 4. os dois papéis batem ponto, e a fila não acumula
select saude_do_motor();
```

O que esperar de `saude_do_motor()`: `fila` batida há menos de 20 segundos, `planner` há menos de 60, `atrasados` em zero. A tolerância da faixa na tela é de 3 minutos.

Pela interface: a faixa "as mensagens automáticas estão paradas" **não** deve aparecer.

Por fora: `GET /api/webhooks/saude` responde 200 (ver a seção seguinte).

---

## Alerta externo (monitor)

A faixa só avisa quem estiver com a tela aberta. Se o motor parar num sábado à noite, as confirmações de domingo não saem e a clínica só descobre na segunda, pela falta do paciente. O alerta que resolve isso vem **de fora**: um monitor de disponibilidade (UptimeRobot, Better Stack ou similar) chama a rota de saúde a cada 5 minutos e manda e-mail quando ela deixa de responder 200.

Ele precisa ser externo. Um alerta disparado de dentro do banco sairia pelo `pg_net`, e morreria junto justamente quando o `pg_net` trava.

### O que a rota responde

`GET /api/webhooks/saude` chama `saude_do_motor()` com a service role e aplica a regra `alertasDoMotor()` de `lib/domain/motor.ts`:

| Resposta | Quando | O que fazer |
| --- | --- | --- |
| **200** | as duas batidas em dia, nada atrasado, planner sem erro | nada |
| **503** com `fila_parada` | a rota da fila não bate ponto há mais de 3 minutos | a corrente cron → Vercel quebrou: "A faixa apareceu na tela", abaixo |
| **503** com `planner_parado` | `motor-manutencao` não roda há mais de 3 minutos | `select * from cron.job` e `cron.job_run_details` |
| **503** com `fila_atrasada` | há tarefa pendente há mais de 5 minutos (`atrasados > 0`) | "A faixa não apareceu, mas nada sai", abaixo |
| **503** com `planner_com_erro` | a última passagem da manutenção falhou em alguma rotina | o código está em `planner_erro` (rotina e SQLSTATE) |
| **503** com `saude_ilegivel` | a rota não conseguiu ler a saúde no banco | banco fora do ar ou service role errada na Vercel |
| **401** | segredo errado, ou `MOTOR_SAUDE_SECRET` ausente na Vercel | o monitor está mal configurado; também precisa alertar |

O corpo é curto e não tem dado de paciente: `ok`, `alertas`, `fila_ha_s` e `planner_ha_s` (segundos desde cada batida), `atrasados` e `planner_erro`.

A rota mora em `/api/webhooks/` pelo mesmo motivo da rota do motor: o matcher do `middleware.ts` exclui esse prefixo. Fora dele o monitor receberia um redirecionamento para o login, que muitos monitores seguem até um 200, e o alerta ficaria verde para sempre.

A regra do monitor é mais rigorosa que a da faixa, de propósito: ela também pega a corrente viva com o trabalho parado (`fila_atrasada`, `planner_com_erro`). Um soluço isolado do planner some na passagem seguinte, porque `motor_manutencao()` grava o erro como nulo quando sai limpa.

### Configurar (uma vez, pelo dono)

1. **Gere o segredo do monitor**, só dele. Não reuse o `MOTOR_TICK_SECRET`: o do monitor pode acabar numa URL, em log de requisição e na tela do monitor, e ele só lê um diagnóstico; o do tick dispara o motor.

   ```bash
   openssl rand -hex 32
   ```

2. **Na Vercel**, em Settings, Environment Variables, crie `MOTOR_SAUDE_SECRET` com esse valor no ambiente Production e faça um redeploy (variável nova só vale a partir do próximo deploy). Sem ela a rota responde 401 sempre.

3. **Descubra a URL.** É o mesmo endereço que o cron chama, trocando `motor` por `saude`:

   ```sql
   select replace(decrypted_secret, '/api/webhooks/motor', '/api/webhooks/saude')
   from vault.decrypted_secrets where name = 'motor_tick_url';
   ```

4. **Teste antes de ligar o monitor:**

   ```bash
   curl -i -H "Authorization: Bearer <segredo>" https://<domínio>/api/webhooks/saude
   ```

   Esperado: `HTTP/2 200` e `"ok":true`. Com o segredo errado, 401.

5. **Crie o monitor** no serviço escolhido:
   - Tipo: HTTP(s), método GET (HEAD também funciona e devolve o mesmo código).
   - URL: a do passo 3. Se o serviço deixa mandar cabeçalho, use `Authorization: Bearer <segredo>`. Se não deixa (é o caso de vários planos gratuitos), ponha o segredo na própria URL: `https://<domínio>/api/webhooks/saude?token=<segredo>`.
   - Intervalo: **5 minutos**. Tempo limite: 30 segundos.
   - Sucesso: só código 2xx. Qualquer outro (503, 401, tempo esgotado) é "fora do ar".
   - Alerta: **e-mail** do dono (e WhatsApp ou SMS, se o plano oferecer). Se o serviço permitir, alerte só depois de 2 falhas seguidas: evita e-mail por um minuto ruim do planner e ainda avisa em cerca de 10 minutos.
   - Peça também o aviso de volta ao normal, para saber quando o incidente acabou.

6. **Prove que o alerta chega.** Troque o segredo no monitor por um errado, espere o e-mail do 401, e desfaça.

Para rotacionar: gere outro valor, atualize `MOTOR_SAUDE_SECRET` na Vercel, faça o redeploy e troque no monitor. Um segredo de monitor vazado só expõe esse diagnóstico, mas rotacione mesmo assim.

**Cuidado com suíte de teste:** `atrasados` conta a fila inteira, inclusive clínicas `e_de_teste`, que o motor de produção ignora. Se uma suíte de integração for interrompida no meio e deixar job pendente de clínica de teste, o monitor acusa `fila_atrasada` até a limpeza. Confira com:

```sql
select c.e_de_teste, j.kind, count(*)
from job_queue j join clinic c on c.id = j.clinic_id
where j.status = 'pendente' and j.run_at < now() - interval '5 minutes'
group by 1, 2;
```

---

## Diagnóstico quando algo não sai

Comece perguntando **o que está quebrado**, porque os sintomas são parecidos e as causas não:

**A faixa apareceu na tela.** Um dos dois papéis parou. `select saude_do_motor()` diz qual. Se for `planner`, o problema é no banco (veja `ultimo_erro`). Se for `fila`, a corrente entre o cron e a Vercel quebrou: confira `cron.job_run_details` e `net._http_response`.

**A faixa não apareceu, mas nada sai.** É o caso mais traiçoeiro: a corrente está viva e o trabalho não acontece. A faixa não pega isso; o monitor externo pega, com `fila_atrasada`. Olhe `atrasados` em `saude_do_motor()` e a fila:

```sql
select kind, status, count(*), max(devolucoes) as max_devolucoes,
       max(ultimo_motivo_devolucao) as motivo
from job_queue group by 1,2 order by 3 desc;
```

`ultimo_motivo_devolucao = 'canal_ocupado'` com `devolucoes` crescendo significa que o número da clínica está com fila longa, não que o motor quebrou.

`ultimo_motivo_devolucao = 'desconectado'` (ou `'sem_numero'`) com `devolucoes` crescendo é o envio **esperando a reconexão** do número (ou a clínica ter número): não é defeito do motor, e a solução é reconectar o WhatsApp da clínica. Desde a migration `20260925141000_espera_do_canal.sql` essas esperas **não contam no teto de 20** devoluções do `reagendar_job` (que vale só para `canal_ocupado`, janela e `numero_removido`): cada uma soma em `payload->>'esperas_do_canal'`, a espera cresce de 5 até 30 minutos e quem desiste é o executor, pelo prazo (confirmação até a hora da consulta; demais réguas, e a confirmação sem consulta, até 12 horas depois da primeira abertura da janela de envio a partir de `scheduled_for` (ou do próprio `scheduled_for` no toque manual e no que já vence dentro da janela); envio ativo até a consulta do payload ou `created_at` mais 12 horas), fechando a run como `'desconectado'`. O banco só encerra sozinho na 400ª espera, como rede de segurança (cerca de 8 dias com janela de 24h: um passo de confirmação acima disso, com o celular caído o tempo todo, fecha como `'falha_envio'`, e isso foi aceito). Leitura do banco que falha durante o toque vira retry com o código em `last_error` (`run_ilegivel`, `consulta_ilegivel`, `consentimento_ilegivel`, `remarcacao_ilegivel`), nunca decisão definitiva.

Desde 25/09/2026 a fila é reivindicada por **raia**: cada número de WhatsApp é uma raia (`coalesce(whatsapp_account_id, clinic_id)`), então dois números da mesma clínica enviam em paralelo e o mesmo número serializa. `MOTOR_MAX_CLINICAS` conta **raias** por passagem (padrão 8; o nome ficou por compatibilidade). Job com `last_error = 'numero_removido'` é o eco de uma resposta ao toque cujo número foi removido: foi cancelado de propósito, não é defeito do motor.

**`cron.job_run_details` diz `succeeded` mas nada chegou na Vercel.** O worker de fundo do `pg_net` travou. Ele é um processo à parte do agendador, e o cron considera sucesso só por ter enfileirado:

```sql
select net.worker_restart();
```

**Nada disso explica.** Os logs da rota estão na Vercel, em Functions, filtrando por `/api/webhooks/motor`. Eles trazem só contadores e códigos, nunca conteúdo de mensagem de paciente.

---

## Desligar (rollback)

**A ordem importa.** Desagende primeiro: reverter a Vercel com o cron ligado deixa o agendador chamando uma rota que não existe mais, e o único sintoma aparece três minutos depois, na faixa.

```sql
select motor_desagendar();
```

Depois, se precisar do motor rodando enquanto conserta, o laço local serve de ponte:

```bash
npm run worker   # numa máquina com o .env.local de produção
```

Ele roda o **mesmo motor** das duas entradas do cron, na mesma cadência: a cada 20 segundos uma passagem de `executarPassagemDoMotor` como `motor-fila` (o que a rota da Vercel faz) e a cada 60 segundos `motor_manutencao()` (o que a entrada `motor-manutencao` faz, e que bate ponto como `motor-planner`). Com as duas batidas em dia, a faixa some e o monitor externo volta a responder 200. Clínicas `e_de_teste` ficam de fora, como no motor de produção.

O `.env.local` da máquina precisa da mesma configuração da Vercel de produção: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, as variáveis do uazapi e, se tiver sido mudado, `MOTOR_MAX_CLINICAS`. A máquina precisa ficar ligada e com rede enquanto a ponte for necessária. Não é solução permanente: é a ponte enquanto o problema é resolvido.

Para parar a ponte, Ctrl+C: ela termina a passagem em andamento (abandonar um job no meio deixaria uma mensagem saindo sem ninguém para gravar o resultado) e sai.

Para religar: `select motor_agendar();`. Rodar a ponte ao lado do cron religado não duplica envio (o claim usa `FOR UPDATE SKIP LOCKED` e o espaçamento anti-banimento vive no banco), mas as batidas se misturam, e com a ponte de pé nem a faixa nem o monitor enxergariam o cron parado. Então: religue, confira em `cron.job_run_details` e `net._http_response` que a Vercel responde 200, e **só depois** pare a ponte.

---

## Segredos

A URL e o segredo do tick vivem no **Vault**, não no comando do agendador (que é copiado para `cron.job_run_details` a cada execução e fica ali 7 dias, até a poda, legível por quem consulta o histórico):

```sql
select name from vault.secrets where name like 'motor_%';
```

Para rotacionar: atualize `motor_tick_secret` no Vault **e** a variável `MOTOR_TICK_SECRET` na Vercel. As duas precisam bater.

O segredo do monitor externo, `MOTOR_SAUDE_SECRET`, vive só na Vercel e no serviço de monitor. Ele é outro, de propósito: ver "Alerta externo".

---

## Espaço em disco

O plano Free do Supabase põe o projeto em **modo somente leitura acima de 500 MB de banco**: o webhook deixa de gravar a mensagem do paciente e a agenda não marca. Duas fontes de inchaço ligadas ao motor e aos testes:

**Histórico do cron.** São 5.760 execuções por dia. A entrada `poda-do-cron` apaga todo dia as que têm mais de 7 dias. Conferir:

```sql
select count(*), min(start_time), pg_size_pretty(pg_total_relation_size('cron.job_run_details'))
from cron.job_run_details;
```

Esperado: perto de 40 mil linhas e a mais antiga com cerca de 7 dias. O arquivo da tabela não encolhe depois da poda (o espaço é reaproveitado pelas linhas novas, e só para de crescer); `vacuum full` nela não é possível com o usuário `postgres`, porque a tabela é do `supabase_admin`.

**Índices de `message`.** Em 24/09 eram 60 MB de índice para cerca de 5 mil linhas, efeito das centenas de milhares de inserts e deletes das suítes de teste contra o banco. `REINDEX CONCURRENTLY` reconstrói sem travar a escrita, mas **não roda dentro de transação**, e toda migration roda numa: por isso é passo manual. Rode sozinho, um comando por vez, no SQL Editor do Supabase ou no `psql` (se o editor reclamar de "transaction block", ele juntou comandos: execute só esta linha):

```sql
reindex table concurrently public.message;
```

Antes e depois, para medir:

```sql
select pg_size_pretty(pg_indexes_size('public.message'));
```

Se o comando for interrompido no meio, sobra índice inválido com sufixo `_ccnew`. Ache e apague:

```sql
select indexrelid::regclass from pg_index
where indrelid = 'public.message'::regclass and not indisvalid;
-- para cada um: drop index concurrently <nome>;
```

Repita depois de rodadas grandes de teste contra o banco de produção.

---

## Risco conhecido, aceito e registrado

Instalar o `pg_net` traz uma permissão padrão do Supabase que **não é possível revogar** com o usuário `postgres`: as tabelas internas do schema `net` (que carregam o cabeçalho da requisição, ou seja, o segredo do tick) e as funções `net.http_*` ficam acessíveis a qualquer papel do banco, incluindo `anon` e `authenticated`. Os objetos pertencem a `supabase_admin`, e `postgres` não consegue assumir esse papel.

**Por que isso não é uma porta aberta hoje:** o schema `net` não está entre os schemas expostos pela API (só `public` está). Um usuário do aplicativo, mesmo com conta criada por código de acesso, recebe 404 ao tentar chamar `net.http_get` pela API. Foi conferido na prática.

**O que isso torna urgente:** o risco só se materializa com **conexão direta ao banco**. Portanto a senha do banco vira o único guarda dessa porta, e ela precisa ser rotacionada e tratada como segredo de primeira ordem.

Se um dia o Supabase permitir revogar, os comandos são:

```sql
revoke usage on schema net from public, anon, authenticated;
revoke all on all tables in schema net from public, anon, authenticated;
revoke execute on all functions in schema net from public, anon, authenticated;
```
