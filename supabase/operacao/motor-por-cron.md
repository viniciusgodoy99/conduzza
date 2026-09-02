# Motor de automação por pg_cron

Como o motor funciona hoje, como conferir que está vivo, e como desligar.

Ligado em 02/09/2026. **Não existe mais processo de worker em servidor nenhum.**

---

## O desenho

Duas entradas no `pg_cron`, dentro do próprio Supabase:

| Entrada            | Cadência    | O que faz                                                               | Onde executa                  |
| ------------------ | ----------- | ----------------------------------------------------------------------- | ----------------------------- |
| `motor-manutencao` | 60 segundos | limpa reservas vencidas, fecha execuções órfãs, planeja réguas, higiene | **dentro do banco**, SQL puro |
| `motor-fila`       | 20 segundos | chama a rota na Vercel, que processa a fila de tarefas                  | Vercel, região de São Paulo   |

A manutenção não depende da rede: é só chamada de função. Só a fila precisa de Node, porque fala com o uazapi e com o Storage.

A rota é `POST /api/webhooks/motor`. O nome tem `webhooks` de propósito: o matcher do `middleware.ts` já exclui esse prefixo, e uma rota fora dele seria redirecionada para o login com o segredo descartado, deixando o sistema idêntico a um sistema saudável enquanto nada sai.

---

## Conferir que está vivo

```sql
-- 1. as duas entradas existem e estão ativas
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

---

## Diagnóstico quando algo não sai

Comece perguntando **o que está quebrado**, porque os sintomas são parecidos e as causas não:

**A faixa apareceu na tela.** Um dos dois papéis parou. `select saude_do_motor()` diz qual. Se for `planner`, o problema é no banco (veja `ultimo_erro`). Se for `fila`, a corrente entre o cron e a Vercel quebrou: confira `cron.job_run_details` e `net._http_response`.

**A faixa não apareceu, mas nada sai.** É o caso mais traiçoeiro: a corrente está viva e o trabalho não acontece. Olhe `atrasados` em `saude_do_motor()` e a fila:

```sql
select kind, status, count(*), max(devolucoes) as max_devolucoes,
       max(ultimo_motivo_devolucao) as motivo
from job_queue group by 1,2 order by 3 desc;
```

`ultimo_motivo_devolucao = 'canal_ocupado'` com `devolucoes` crescendo significa que o número da clínica está com fila longa, não que o motor quebrou.

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

Depois, se precisar do motor rodando enquanto conserta, o laço local ainda existe:

```bash
npm run worker   # numa máquina com o .env.local de produção
```

Ele usa o mesmo código (`executarPassagemDoMotor`) e bate ponto como `motor-fila`, então a faixa some. Não é solução permanente: é a ponte enquanto o problema é resolvido.

Para religar: `select motor_agendar();`

---

## Segredos

A URL e o segredo do tick vivem no **Vault**, não no comando do agendador (que fica gravado em `cron.job_run_details` a cada execução, onde nenhuma poda alcança):

```sql
select name from vault.secrets where name like 'motor_%';
```

Para rotacionar: atualize `motor_tick_secret` no Vault **e** a variável `MOTOR_TICK_SECRET` na Vercel. As duas precisam bater.

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
