# AXIOM na Mesa de Operações

O desktop empacota o worker Python. Depois de iniciar a coleta pelo painel AXIOM, a Mesa mantém a manutenção periódica e executa experimentos em processo de prioridade reduzida quando existe histórico elegível. A coleta requer início explícito. O painel mostra qualidade, tarefas científicas, falhas e retenção.

- O supervisor Qwen requer a variável `OPENROUTER_API_KEY` no ambiente que inicia a Mesa. Revisões ocorrem diariamente às 00h10, às segundas às 00h30 e no primeiro dia do mês às 00h50, em São Paulo. A agenda usa janelas de cinco minutos e registra falhas e interrupções. O Qwen só recebe evidências selecionadas e emite pareceres.
- A coleta usa segmentos horários UTC. Arquivos fechados são comprimidos sem perda após 30 dias ou antes sob pressão de disco. A cópia bruta só é removida após validação SHA-256. O replay lê os dois formatos. O limite local de 2 GiB inclui os arquivos comprimidos e bloqueia a coleta se o acervo alcançar o teto.
- A fila persistente de pesquisa avalia ablações predefinidas em 30/7/7 dias, com embargo temporal e conjuntos comparáveis. É preciso ter 44 dias de dados elegíveis e 12 ativos antes de iniciar. O replay IOC usa decisões congeladas, livro L2, FX e filtros registrados para comparar custos.
- A carteira oficial continua em `COLLECT_ONLY`. A liquidação IOC transacional exige política interna aprovada. A Mesa ainda não fornece essa autorização ao adaptador. Holdout prospectivo, custos e estresse, amostra efetiva e aprovação humana continuam obrigatórios.

## Comandos locais de pesquisa

Com Python 3.11 e `requirements.txt`, use o prefixo `python axiom_runtime.py --data LOGS/axiom-01 --state SCIENCE` seguido de:

- `scan` para consultar a qualidade.
- `tick` para manutenção e revisão na agenda.
- `experiment` para processar a fila de ablações.
- `replay --decisions FILE.json` para simular custos de uma lista de decisões congeladas.
- `train --start-ms UTC_MS --output NEW_CANDIDATE_DIR` para ajustar candidatos isolados.
- `review --id UNIQUE_ID` para uma revisão manual do Qwen.
