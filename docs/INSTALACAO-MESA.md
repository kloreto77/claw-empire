# Mesa de Operações — instalação independente

A interface React/PixiJS e a API Express/WebSocket são servidas pelo mesmo processo HTTP. A configuração abaixo mantém a aplicação isolada do Hermes; nenhuma instalação do Hermes ou configuração existente é alterada. Não é necessário hospedar os modelos localmente.

## Pré-requisitos

- Docker com Compose v2, Git, espaço livre para imagens e dependências.
- Uma porta local disponível (8791 por padrão).
- Para acesso remoto, um túnel SSH ou proxy HTTPS com suporte a WebSocket.

## Primeira inicialização

Clone a branch `mesa-operacoes-v1` em um diretório novo:

```bash
git clone --branch mesa-operacoes-v1 --single-branch https://github.com/kloreto77/claw-empire.git mesa-operacoes
cd mesa-operacoes
umask 077
cp .env.example .env
```

Edite o arquivo privado `.env` e defina dois segredos distintos e aleatórios, de pelo menos 32 bytes. Gere cada valor localmente com `openssl rand -hex 32`. Não envie os valores pelo GitHub ou pelo chat.

```dotenv
API_AUTH_TOKEN=SUBSTITUA_POR_UM_SEGREDO_ALEATORIO
OAUTH_ENCRYPTION_SECRET=SUBSTITUA_POR_OUTRO_SEGREDO_ALEATORIO
MESA_HOST_PORT=8791
```

Configure `ALLOWED_ORIGINS` com a origem HTTPS exata caso use proxy remoto. Não use curingas de origem. O Compose mantém o serviço vinculado ao loopback do host; não abra a porta 8791 no firewall.

```bash
docker compose -p mesa-operacoes -f compose.mesa.yml up -d --build
docker compose -p mesa-operacoes -f compose.mesa.yml ps
curl --fail http://127.0.0.1:8791/api/health
```

Para acesso privado por túnel, execute no computador cliente, substituindo usuário e host reais:

```bash
ssh -N -L 8791:127.0.0.1:8791 usuario@host-da-vps
```

Acesse http://127.0.0.1:8791 no computador cliente. Para acesso por celular, use posteriormente um domínio HTTPS protegido com proxy WebSocket. Não compartilhe o token de acesso.

## Validação inicial

- Confirmar que o servidor está saudável.
- Confirmar oito agentes (Agente 01 a 08) no banco novo, sem instrução, provedor ou modelo, e nenhuma tarefa.
- Confirmar que os oito personagens aparecem no escritório e que seus detalhes podem ser abertos.
- Reiniciar o contêiner e conferir a persistência. Não usar `down -v`, pois isso elimina o volume.
- Configurar OpenRouter/OpenCode somente quando o operador estiver pronto; nenhuma chave ou estratégia foi incluída.
- Antes de conectar um provedor, testar criação, edição, exclusão e os controles reais de execução.

## Atualização e diagnóstico

```bash
git pull --ff-only origin mesa-operacoes-v1
docker compose -p mesa-operacoes -f compose.mesa.yml up -d --build
docker compose -p mesa-operacoes -f compose.mesa.yml logs --tail=100 mesa
```

O volume `mesa-operacoes_mesa_data` guarda banco e logs. Faça backup consistente do SQLite antes de atualizar. A aplicação mantém o front-end e o back-end juntos para preservar a autenticação e o WebSocket do projeto original. Uma implantação separada na Vercel exige integração adicional e não faz parte deste procedimento.

Status: configuração preparada em código, ainda não validada em uma VPS real. Não representa uma instalação concluída.
