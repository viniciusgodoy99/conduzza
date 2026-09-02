# Publicar o Conduzza numa VPS

Roteiro para colocar o sistema no ar em servidor próprio, com domínio e HTTPS.

Escrito para a VPS **KVM 1 da Hostinger (1 núcleo, 4 GB de memória, 50 GB de disco, Ubuntu 24.04)**.

---

## O que já existe nesta máquina

A VPS **não está vazia**. Levantamento de 02/09/2026:

- **Supabase auto-hospedado inteiro**: 14 contêineres (banco, autenticação, tempo real, armazenamento, Kong, Studio, análises, MinIO)
- **n8n**: editor, worker e webhook (3 contêineres, ~790 MB somados)
- **Evolution API** (outro canal de WhatsApp), **Redis**, **Portainer**, **Excalidraw**
- **Postgres separado** consumindo perto de 48% do único núcleo
- **Traefik**, que já é dono das portas **80 e 443**

Situação: **3,4 GB de 3,8 GB em uso, 395 MB disponíveis, sem swap.** Disco em 24 GB de 48 GB.

Três consequências práticas:

1. **Não instale nginx nem Caddy, e não ligue o firewall agora.** O Traefik já publica os outros serviços nas portas 80 e 443, e o Conduzza entra como serviço do Swarm, publicado por ele (`conduzza-stack.yml` nesta pasta). Ligar o `ufw` numa máquina com Docker Swarm em produção derruba a rede entre os contêineres se as portas do Swarm (2377, 7946 e 4789) não forem liberadas antes. O `Caddyfile` e os arquivos de systemd desta pasta só servem para o dia de uma VPS dedicada.
2. **Swap é obrigatório antes do build.** Compilar o Next pede de 2 a 4 GB e há 395 MB livres. Sem swap o build morre por falta de memória.
3. **Operar vai ficar apertado até o plano subir.** O Conduzza pede ~450 MB no pico, e é exatamente o que resta. O KVM 2 (2 núcleos, 8 GB) resolve build e operação de uma vez.

### Ressalva que precisa ser dita

A `docs/01_spec_funcional_conduzza_clinicas.md` (linhas 571-582) recomenda **VPS dedicada** para este sistema, por causa da LGPD: conversa de paciente é dado de saúde, dado sensível. Nesta máquina, quem tiver acesso ao Portainer consegue ler o arquivo de ambiente do Conduzza, inclusive a chave de serviço do banco, que passa por cima de toda a RLS. Isso não impede o piloto, mas precisa ser uma decisão consciente, e o caminho natural é o Conduzza ganhar máquina própria antes de entrar em produção de verdade.

---

## 1. Preparar a máquina

Como `root`, uma vez só.

Um comando por vez: o `apt` lê da mesma entrada do teclado e engole o que estiver na fila.

```bash
apt update
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs git
node --version    # precisa responder v24.x

# Relógio sincronizado: a faixa de "motor parado" compara o horário da
# máquina com o do banco, com tolerância de 3 minutos
timedatectl set-ntp true
```

**Não ligue o `ufw` nesta máquina.** Ela roda Docker Swarm em produção, e o firewall sem as portas 2377, 7946 e 4789 liberadas corta a comunicação entre os contêineres que já estão no ar.

## 2. Código e segredos

```bash
cd /opt && git clone https://github.com/viniciusgodoy99/conduzza.git && cd conduzza
```

Crie `/opt/conduzza/.env.local`. **Este arquivo único serve aos dois processos**: o Next lê `.env.local` por convenção, e o worker tem leitor próprio que lê **apenas** esse nome, a partir da pasta do projeto. Um `.env.production` seria ignorado pelo worker.

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
WHATSAPP_PROVIDER=uazapi
UAZAPI_SERVER_URL=...
UAZAPI_ADMIN_TOKEN=...
PUBLIC_APP_URL=https://SEU-DOMINIO.com.br
```

O jeito menos sujeito a erro de digitação é copiar o arquivo da sua máquina:

```bash
scp .env.local root@IP-DA-VPS:/opt/conduzza/.env.local
```

Depois, na VPS, ajuste `PUBLIC_APP_URL` para o domínio definitivo e confirme `WHATSAPP_PROVIDER=uazapi`:

```bash
chmod 600 /opt/conduzza/.env.local
```

Três avisos que evitam retrabalho:

- **`PUBLIC_APP_URL` precisa ser o domínio definitivo antes de qualquer clínica conectar o WhatsApp.** Esse endereço é gravado dentro do uazapi no momento da conexão; trocar a variável depois não conserta, é preciso reconectar o número.
- **`NEXT_DIST_DIR` não pode existir aqui.** Ela só serve ao modo de desenvolvimento e faria o servidor procurar o build na pasta errada.
- Se as duas variáveis `NEXT_PUBLIC_SUPABASE_*` faltarem, **o sistema sobe sem proteção de rota e sem avisar**. O passo 7 confere isso.

## 3. Swap, se a memória estiver apertada

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h
```

## 4. Instalar e compilar

```bash
cd /opt/conduzza
npm ci          # instalação COMPLETA: o build precisa das ferramentas
npm run build
```

Com 1 núcleo e a memória no limite, o build usa swap e demora: espere de 15 a 30 minutos. Se a sessão do terminal cair no meio, o build morre junto; use `screen` ou `tmux` se a sua conexão for instável.

A máquina que compila precisa de saída para `fonts.googleapis.com`: o Next baixa as fontes e as guarda junto no build. Em operação isso não é mais necessário.

## 5. Subir os dois processos (Docker Swarm)

**Este sistema tem dois processos, e o segundo não é opcional.** Não existe `pg_cron` neste projeto Supabase: o worker é o único executor de confirmação de consulta, lembrete, pós falta, reoferta e disparo em massa. Com ele parado, as telas continuam funcionando e nenhuma mensagem sai.

Eles sobem como serviços do Swarm porque **o Traefik desta VPS só faz descoberta por Docker** (`--providers.docker.swarmMode=true`, sem provedor de arquivo). Um processo solto no servidor seria invisível para ele, e ligar o provedor de arquivo exigiria reiniciar o Traefik, derrubando o n8n e os outros por alguns segundos.

Antes, troque `SEU-DOMINIO` dentro de `deploy/conduzza-stack.yml`.

```bash
docker stack deploy -c /opt/conduzza/deploy/conduzza-stack.yml conduzza
docker service ls | grep conduzza
docker service logs conduzza_worker -f
```

Os arquivos `conduzza-app.service` e `conduzza-worker.service` (systemd) desta pasta ficam guardados para o dia em que o Conduzza tiver VPS própria, junto com o `Caddyfile`.

## 6. Domínio e HTTPS

Crie um registro **A** do seu domínio apontando para o IP da VPS e espere propagar (`dig +short SEU-DOMINIO.com.br`).

O resto é automático: o Traefik já tem o resolvedor `letsencryptresolver` configurado por desafio HTTP, e os rótulos do stack pedem o certificado sozinhos. Acompanhe com `docker service logs traefik_traefik --tail 50`.

### Risco conhecido: o segredo do webhook vai para o log

O Traefik desta VPS está com `--accesslog=true` gravando em `/var/log/traefik/access-log`, e o segredo do webhook do WhatsApp viaja na query string da rota `/api/webhooks/whatsapp`. Ou seja, **ele será gravado em texto puro nesse arquivo**, e quem o ler pode forjar evento de mensagem para qualquer clínica.

O Traefik v2 não desliga o log de acesso por rota. Mitigações, da mais simples à mais correta:

1. Restringir a leitura de `/var/log/traefik/` e apagar o histórico já existente.
2. Baixar o `--log.level` de `DEBUG` para `INFO` (reduz o volume e o que é registrado; exige atualizar o serviço do Traefik).
3. **Correção de raiz**: mover o segredo da URL para um cabeçalho na rota do webhook. É mudança de código, e precisa ser feita junto com a reconexão dos números, porque a URL fica gravada dentro do uazapi.

## 7. Conferência

| O que | Como | Esperado |
|---|---|---|
| HTTPS | abrir o domínio | cadeado válido |
| Proteção de rota | abrir `/agenda` em janela anônima | redireciona para o login |
| Motor vivo | olhar o topo da tela | faixa "as mensagens automáticas estão paradas" **ausente** |
| Aviso funciona | `docker service scale conduzza_worker=0`, esperar 3 min | faixa **aparece**; voltar para 1 e ela some |
| Sobrevive a reinício | `reboot` | o Swarm sobe os dois sozinhos |
| Ponta a ponta | mandar WhatsApp para o número da clínica | mensagem aparece no Atendimento |
| Privacidade | `docker service logs conduzza_app` procurando um trecho de mensagem | nada de conteúdo de paciente nos logs |

## Atualizar depois

```bash
cd /opt/conduzza
git pull && npm ci && npm run build
docker service update --force conduzza_app
docker service update --force conduzza_worker
```

Se a atualização trouxer migration nova, aplique-a no banco **antes** de reiniciar os serviços.

## Acompanhar

```bash
docker service logs conduzza_app -f
docker service logs conduzza_worker -f
docker service ls | grep conduzza
docker stats --no-stream
```
