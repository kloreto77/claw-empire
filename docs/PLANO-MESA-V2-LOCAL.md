# Mesa V2 — plano de execução local (Windows)

## Decisão de arquitetura

Executar a Mesa V2 diretamente no Windows, com Node.js e pnpm, sem Docker obrigatório, sem VPS adicional e sem modificar o Hermes. Modelos de IA são consumidos por APIs externas; a inferência não roda no notebook. A infraestrutura local não implica gratuidade dos provedores de IA.

Os oito agentes existentes devem poder trabalhar simultaneamente, desde que individualmente configurados e autorizados. Não haverá teto arbitrário de dois agentes. Um eventual limite global deverá ser opcional e configurável, aplicado de forma consistente aos caminhos de execução manual, agendada e de retomada; não deve cancelar trabalhos em andamento. Medir CPU, RAM, latência e limites dos provedores antes de recomendar uma restrição. Ferramentas locais pesadas podem demandar recursos adicionais.

## Etapas de implementação

1. Preparar instalação nativa com Node.js 22 e pnpm, build de produção e acesso somente em loopback. Manter banco SQLite, logs e segredos em diretório persistente, separado de builds e atualizações.
2. Preparar inicialização opcional pelo Agendador de Tarefas do Windows no login, sem abrir serviços públicos, sem iniciar agentes automaticamente na primeira instalação, sem matar processos alheios e sem duplicar instâncias.
3. Preservar tarefas interrompidas e registrar a causa. O watchdog existente recupera tarefas órfãs, mas não garante continuidade exata; o desligamento normal atualmente cancela determinadas tarefas. Implementar estado recuperável e revisão antes de reexecutar ações externas. Nunca repetir ordens ou efeitos externos automaticamente quando o resultado anterior for desconhecido. Verificar consistência do SQLite e criar backups recuperáveis.
4. Ampliar agendamento individual por dias, janelas de horário e fuso horário. Calendários de mercado, feriados e sessões especiais devem ser validados antes de uso financeiro. Não acumular disparos perdidos durante desligamentos; reavaliar janela e dados atuais ao retornar. Cripto e outros mercados podem usar janelas diferentes.
5. Medir recursos locais e validar oito agentes em paralelo com provedores simulados, sem credenciais reais. Só depois avaliar ferramentas reais, limites de APIs e eventual ajuste de concorrência. Monitoramento não significa garantia de capacidade antes do teste.

## Critérios de aceite

- Build e testes existentes aprovados, mais validação nativa em Windows.
- Oito agentes neutros na primeira inicialização; nenhum disparo ou chamada paga sem configuração e autorização explícitas.
- Oito agentes configurados em teste simulado podem executar tarefas simultâneas, sem execução duplicada do mesmo agente.
- Reinício normal e interrupção forçada preservam dados confirmados e identificam tarefas interrompidas; ações ambíguas não são repetidas automaticamente.
- Agenda respeita dias, horários, fuso e política de disparos perdidos; fora da janela não inicia nova tarefa.
- Registro de consumo de CPU e RAM com oito agentes simulados; teste de ferramentas pesadas separado.
- Instalação, inicialização opcional, atualização e backup documentados. Hermes, V1 e branch principal permanecem intactos.

## Estado

Plano aprovado para preparação da V2 local. O agendador por intervalos, armazenamento SQLite e proteção contra tarefas órfãs já existem; as adaptações acima ainda requerem implementação e validação. Nenhum agente real ativado, nenhuma ordem real enviada e nenhuma chamada paga necessária para esta etapa.
