# Segunda auditoria e refinamentos — 1.5.1

Escopo: backup e restauração, exportação imediata, armazenamento, montagem de folhas,
manifesto, iluminação e layout. As correções foram aplicadas ao projeto e cobertas por
regressões; a primeira auditoria continua registrada no histórico da versão 1.4.1.

## Problemas corrigidos

| Prioridade | Problema e reprodução | Correção |
|---|---|---|
| P1 | Abrir uma imagem, trabalhar na aba Relevo e salvar `.pfset` sem adicionar à Biblioteca gerava um backup sem a fonte do sprite. | O backup inclui fonte, parâmetros e contrato do editor. A importação prepara e valida o editor junto aos assets antes da substituição atômica. |
| P2 | Alterar tamanho e exportar antes dos 80 ms de reprocessamento usava pixels anteriores com configurações novas. | Exportações e snapshots executam o reprocessamento pendente antes de capturar os dados. Inclui normal map e backup. |
| P2 | Em modo memória, mudar uma receita após `put()` ou editar o resultado de `all()` alterava registros sem uma nova gravação. | Escritas capturam uma cópia imediatamente; leituras de memória devolvem cópias. Também vale para metadados e substituição do projeto. |
| P2 | Ao encher a grade e clicar novamente em “folha”, o próximo sprite voltava para 0,0 e sobrepunha o anterior. A grade não verificava sobreposição. | A colocação procura espaço para o tamanho real do sprite e informa quando a folha está cheia. A validação verifica sobreposição e alinhamento à grade. |
| P2 | O manifesto não registrava contorno interno, cor de borda, silhueta e remoção de preto/branco; a paleta em hex perdia alpha. | Esses parâmetros, paleta base, margem efetiva, paleta RGBA e índice transparente são exportados. |
| P2 | A abertura assíncrona aceitava edições antes de restaurar o projeto; a origem da iluminação podia ser escolhida antes do editor estar disponível. | A interface aguarda o carregamento e a ordem passa a ser projeto → editor → iluminação. |
| P2 | Exceções dentro do callback de leitura de pixels do canvas não rejeitavam a promessa de importação, deixando a interface bloqueada. | As exceções são rejeitadas, a interface é liberada e o projeto anterior é preservado. Dimensões de entrada são limitadas antes da leitura de pixels. |
| P2 | Em telas médias, o painel direito era fixo e cobria a prévia; em telas pequenas o recorte da aba impedia acessar o conteúdo inteiro. | Layout em três colunas sem sobreposição nas telas médias, fluxo vertical nas pequenas e abas roláveis. A rolagem da prévia parte do canto quando a imagem excede a área. |

## Refinamentos

- Presets **suave**, **marcado** e **plano**, com redefinição sem perder a origem.
- Cor da luz reage durante a edição, em vez de aguardar a confirmação do seletor.
- Arquivos de mapa usam o nome do sprite, normalizando acentos e removendo o rótulo do seletor.
- Fechar um editor ao abrir um projeto antigo limpa a prévia e a validação anteriores.
- A publicação atribui uma versão por conteúdo aos scripts e ao CSS, evitando carregar partes de versões diferentes do aplicativo.

## Evidências automatizadas

- `tests/test-ui.mjs`: 126 verificações, incluindo exportação imediata, backup só do editor,
  editor corrompido, falha do canvas, inicialização, folha cheia, presets e manifesto.
- `tests/test-regressions.cjs`: 14 cenários, incluindo isolamento das referências no armazenamento,
  captura antes da escrita assíncrona, sobreposição e alinhamento da grade.
- `tests/test-lighting.cjs`: 9 cenários de mapas e iluminação.
- `tests/test-build.cjs`: integridade e versão de todos os scripts e CSS publicados.
- Núcleo: 104 verificações; PNG indexado: 25; Aseprite: 18; arquivos RGBA: 3.

Total: **300 verificações/cenários aprovados**. Os testes de interface usam DOM simulado;
o layout também deve ser conferido em navegador nas larguras desktop e móvel ao publicar.

## Limites preservados

O relevo continua sendo uma estimativa da imagem. O aplicativo não apaga iluminação já
pintada, e a autossombra da prévia não substitui sombras projetadas pelo motor do jogo.
Em modo memória, o `.pfset` continua sendo necessário para guardar o trabalho entre sessões.
