# Mesa de Operações V2 — aplicativo Windows

A versão desktop mantém a interface React, o backend Node.js e o SQLite existentes. O Electron abre uma janela própria e inicia o backend empacotado, sem CMD visível, Docker ou instalação manual de Node.js. O instalador x64 é gerado pelo workflow Mesa V2 - Windows desktop.

- Abrir pelo ícone da área de trabalho ou menu Iniciar.
- Minimizar mantém o backend ativo; fechar encerra o backend e aplica a recuperação local. O menu Mesa permite optar por iniciar com o Windows.
- A primeira inicialização cria oito agentes sem configuração; agendamentos ficam desabilitados globalmente. A configuração local desktop-settings.json permite habilitar o motor de agendamento após validação; ainda não há seletor visual para isso.
- Banco, logs e chave de criptografia ficam no diretório userData/runtime do aplicativo, separados dos binários. Guarde backups do banco e da chave juntos; não compartilhe a chave.
- As APIs externas podem ter custos próprios. Nenhuma credencial é necessária para o teste inicial.
- O instalador experimental não tem assinatura comercial; o Windows pode exibir aviso de reputação. Não desative as proteções do sistema.
- O workflow testa compilação, recuperação unitária e abertura do executável empacotado no Windows. Ainda não substitui a instalação real, teste de oito agentes ativos, calendário de mercado, medição de recursos e recuperação de desligamento forçado no notebook.
- O pacote inclui dependências de desenvolvimento por enquanto, para evitar perda de dependências do servidor. A redução do tamanho e os testes de integrações específicas são etapas posteriores.

## Atualizações automáticas

O desktop consulta a última release estável do repositório público a cada hora e na abertura, baixa em segundo plano e instala no fechamento normal somente após o backend confirmar ausência de tarefas ativas e encerrar com sucesso. Não reinicia a Mesa durante operações. A publicação automática exige uma versão incrementada e aprovação dos testes gerais e do teste de atualização do instalador no Windows. Commits intermediários não chegam ao notebook. A primeira versão continua experimental e sem certificado comercial; a distribuição usa GitHub Releases e verificação de integridade do updater, não uma assinatura de editor Windows. O workflow instala uma versão anterior de teste, atualiza pelo mecanismo real do Electron a partir de um feed local isolado e verifica o banco, a chave de criptografia e a abertura da nova versão. O teste usa dados fictícios e não publica a versão anterior de teste. O feed público do GitHub ainda precisa ser confirmado na primeira atualização real. Um backup local do banco e da chave é feito antes de cada instalação de atualização.

A partir da versão 2.0.8, a instalação utiliza o modo direto (one-click), por usuário, sem configuração manual de diretório e sem iniciar automaticamente ao terminar o instalador. O teste de instalação silenciosa em CI dispõe de até dez minutos e registra o progresso do processo.

A partir da versão 2.0.9, o workflow inclui validação pós-publicação em um runner Windows separado. O teste baixa a versão pública 2.0.8, verifica o checksum, instala e abre a janela normal (sem substituir o feed do updater), espera o download da release pública, fecha normalmente e verifica a versão instalada, a impressão digital do aplicativo, o banco, a chave e o backup. A publicação já terá ocorrido antes desta verificação; um resultado negativo exige investigação e impede afirmar que o caminho público foi validado. Nenhuma API de IA real é utilizada.
