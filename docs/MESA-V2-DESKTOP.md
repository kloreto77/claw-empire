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
