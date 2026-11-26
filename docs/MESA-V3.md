
# Mesa V3 — primeira implementação para validação
- Branch isolada da V2 publicada. Sem versão nova do instalador até aprovação dos testes.
- Escritório em SVG e sprites existentes, mesas individuais, supervisão por cargo, reuniões e transições por eventos reais. Ociosos ficam na estação; não fingimos trabalho.
- Navegação principal em português; painéis legados permanecem acessíveis e ainda requerem tradução completa.
- Configuração individual: identidade, modelo/API compatível, teste, instruções, agenda, ferramentas, carteira, tarefas e recursos.
- Mercado sintético local: seis ativos, tick de dois segundos, velas, spread, liquidez por ordem, taxa de 0,1%, carteira de R$100 mil fictícios, compra/venda à vista, histórico SQLite, idempotência por identificador. Sem conexão financeira externa.
- Ranking por retorno menos metade do drawdown observado (amostragem durante consultas e ordens). Taxa de acerto por venda realizada com lucro; não representa trades completos de ida e volta. Sem classificação para agentes sem ordem.
- GET /api/desk/market e GET /api/desk/market/agents/:id; PUT /api/desk/market/agents/:id/permission (enabled boolean); POST /api/desk/market/agents/:id/orders (symbol,side=buy/sell,quantity inteiro,order_id único). Mesma proteção de API do aplicativo. Permissão de carteira desligada por padrão. O operador manual pode testar a carteira; nenhum agente é ativado automaticamente.
- Limites atuais: não há roteador MCP operacional para modelos; referências externas ainda são catálogo, skills continuam no provedor. O mercado tem preço sintético e liquidez por ordem, não um livro de ofertas real com concorrência. Agenda mantém controles existentes. Tradução das telas legadas, atribuição exclusiva de skills, execução MCP e avaliação Windows seguem pendentes.

## Complemento
Skills textuais individuais persistem em SQLite e são incluídas nos prompts de execução manual e conversas diretas. Tarefas de API compatível com chamadas de função podem usar o simulador se a carteira estiver explicitamente habilitada, com identidade determinada pelo backend, máximo de cinco chamadas por tarefa e revalidação de permissão/estado. A resposta e as ferramentas são registradas. Modelos Anthropic/Google e CLI não usam esse caminho. MCP externo, tradução integral dos painéis legados e validação Windows continuam pendentes. Não iniciar agentes sem suas estratégias configuradas.
