# Worker de pesquisa AXIOM
O arquivo axiom_runtime.py reúne coleta exportada pela Mesa, agregação/treinamento, memória e supervisor em comandos explícitos.
Com Python 3.11 e dependências instaladas:
python axiom_runtime.py --data PATH_TO_LOGS/axiom-01 --state PATH_TO_SCIENCE scan
python axiom_runtime.py --data PATH_TO_LOGS/axiom-01 --state PATH_TO_SCIENCE train --start-ms UTC_MS --output NEW_CANDIDATE_DIR
python axiom_runtime.py --data PATH_TO_LOGS/axiom-01 --state PATH_TO_SCIENCE review --id UNIQUE_ID
A revisão requer OPENROUTER_API_KEY configurada externamente e consome chamadas; nenhum segredo no código.
Treinamento exige dados reais suficientes, congela somente registros de minuto e liquidez anteriores ao cutoff, registra hash e salva candidatos em diretório novo. Não promove versões.
A interface Windows 3.1.1 é de coleta; este worker ainda não está empacotado, não é iniciado pelo desktop, e não possui autorização de ordens. Faltam a ligação transacional IOC/ledger, motor completo de sizing, watchdog, benchmark de recursos, validação prospectiva, agendamento e instalação.
