# Alterações

## 1.5.1

- Backups incluem fonte e receita do sprite em edição, mesmo sem assets na biblioteca; importação valida esse sprite antes de substituir o projeto.
- PNG, normal map, manifesto e backup usam a última alteração dos controles, mesmo quando exportados antes do reprocessamento programado.
- Armazenamento copia receitas na entrada e na leitura, impedindo alterações não gravadas por compartilhamento de referências.
- Folha cheia deixa de empilhar sprites em 0,0; validação de sobreposição e alinhamento também roda no modo grade.
- Manifesto inclui os controles de contorno interno, cor, silhueta e remoção de preto/branco, paleta base, margem efetiva e alpha da paleta final.
- Abertura do projeto protege contra edição durante o carregamento e restaura o editor antes da origem da iluminação. Falhas de leitura do canvas liberam a interface e preservam o projeto anterior.
- Presets suave/marcado/plano, botão para redefinir relevo e luz, atualização contínua da cor e nomes de exportação sem texto do seletor.
- Layout sem painel sobreposto em telas médias; abas roláveis e painéis acessíveis em telas pequenas. Imagens grandes podem ser percorridas desde o canto superior esquerdo.
- Scripts e CSS publicados recebem versão pelo conteúdo para evitar mistura de arquivos antigos e novos no navegador.
- Segunda auditoria documentada em `docs/audit-1.5.1.md`, com novos testes de regressão.

## 1.5.0

- Nova aba Relevo e luz: sprite do editor ou da biblioteca, bump por silhueta ou luminosidade, mistura de detalhes, suavização, inversão de altura e força do relevo.
- Normal maps Y+ / OpenGL e Y− / DirectX, exportados em PNG RGBA sem reduzir as cores dos vetores.
- Prévia com direção e elevação da luz, ambiente, intensidade, cor, brilho e autossombra aproximada no mapa de altura. Clique e arraste para mover a luz.
- Exportação de bump, normal map, cor base e prévia iluminada, preservando resolução e transparência.
- Configurações da nova aba persistidas no navegador e em backups `.pfset`, com compatibilidade com backups anteriores.
- Testes de geometria, iluminação, exportação RGBA, interface, persistência e verificação independente dos arquivos com Pillow.

## 1.4.1

- Importar um `.pfset` inválido preserva o projeto anterior. As fontes e receitas são preparadas antes da substituição atômica de itens e metadados.
- Falhas e abortos de IndexedDB são informados; a interface deixa de afirmar que alterações com erro estão salvas.
- Exportação RGBA para Aseprite preserva a opacidade da sombra.
- Quantização rejeita paletas que ultrapassam 256 entradas, incluindo transparência. Contorno e sombra também verificam a capacidade antes de escrever índices.
- Contorno interno respeita a largura quando a silhueta toca a borda do quadro.
- Validação de resolução aceita os presets de fundo, incluindo 640×360.
- A régua verifica a distância dos pés até a linha de base configurada.
- Abrir projeto restaura perfil, contrato global e âncora persistida.
- Alterações de âncora e sombra ativam o aviso de backup pendente; abrir o preview não altera o projeto.
- Testes de regressão, referências de formato incluídas no repositório e publicação no GitHub Pages após os testes.
