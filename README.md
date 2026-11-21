# Tabbed Foundry

> **EMERGENCY SAFE MODE (v1.2.4):** automatic tab grouping is temporarily disabled. This build deliberately does not override `ApplicationV2.detachWindow()` so Foundry can use its native application and Journal lifecycle while the reattachment issue is investigated. Fully quit and restart the Foundry desktop process before testing this build; reloading only the world does not clear an older in-memory prototype override.

Módulo experimental para Foundry VTT v14 que pretende reunir aplicações `ApplicationV2` destacadas em uma única janela externa. A funcionalidade de agrupamento está temporariamente suspensa nesta versão de segurança.

## Estado da versão de segurança

- Não instala interceptação em `ApplicationV2.prototype.detachWindow`.
- Não captura novas aplicações para a janela Tabbed.
- Mantém o botão de destaque nativo do Foundry.
- Desativa e redefine a preferência de agrupamento automático para falso.
- A implementação de abas e Split View permanece no código para revisão, mas não é ativada nesta versão.

## Recuperação

1. Encerre o Foundry Desktop usando **Application → Quit**.
2. Confirme no Gerenciador de Tarefas que todos os processos `Foundry.exe` foram encerrados.
3. Se a abertura de Journals continuar quebrada, renomeie ou remova `Data/modules/tabbed-foundry` e inicie o Foundry sem o módulo.
4. Se o problema persistir com o módulo removido após um encerramento completo, desative temporariamente os demais módulos e verifique o primeiro erro vermelho do Console (F12) ao abrir um Journal.

## Funcionalidades em desenvolvimento (não ativadas em v1.2.4)

A versão de desenvolvimento contém a arquitetura de Split View, abas independentes por painel, separadores redimensionáveis e uma integração opcional com Monk's Enhanced Journal. Esses recursos ainda precisam ser validados e não devem ser considerados disponíveis nesta versão de segurança.

## Compatibilidade

- Foundry VTT v14.
- O módulo não exige Monk's Enhanced Journal.
- Nenhum comportamento de destacamento é interceptado na versão de segurança.
