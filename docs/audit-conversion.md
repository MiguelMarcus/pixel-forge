# Auditoria da conversão — 23/10/2026

## Correções implementadas após a auditoria

- clean e structure votam por RGB exato, equivalente ao índice para entradas de paleta distintas, sem fundir tons em buckets de 5 bits.
- Empates usam ordenação RGB estável, com tolerância numérica para pesos de cobertura. O modo dominante legado também ganhou desempate estável.
- A análise usa distância RGB média e limite máximo por canal, protegendo bordas fortes de todos os canais. Não foi introduzida uma métrica perceptual nova.
- O agrupamento preserva RGB de pixels parcialmente transparentes, sem usar o limiar de alpha do quantizador intermediário.
- Componentes de oito vizinhos permitem identificar ilhas completas de 2×2 pixels. Somente ilhas de baixo contraste cercadas por uma única cor opaca são limpas. Pares, formas em L, conexões diagonais e brilhos fortes são mantidos.
- Regressões cobrem cores próximas, espelhamento, bordas dos três canais e limpeza/proteção de componentes. Avaliação visual nos arquivos originais continua necessária; Web Worker e seleção entre candidatos permanecem propostas futuras.

Escopo: revisão dos modos clean e structure, amostragem, paleta e execução da interface. Nenhuma mudança no algoritmo foi aplicada nesta auditoria. Os resultados abaixo foram reproduzidos no núcleo local com imagens sintéticas, sem usar capturas de tela como se fossem os arquivos originais.

## Falhas reproduzidas

### P1 — Cores da paleta voltam a ser misturadas após o agrupamento

Em src/core.js, resample usa um histograma de 5 bits por canal inclusive nos modos clean e structure. Duas entradas diferentes da paleta podem cair no mesmo bucket; o algoritmo calcula a média RGB desse bucket e quantiza novamente.

Reprodução: imagem 2×1 com cinzas 96 e 103; paleta com cinzas 96, 100 e 103; conform para 1×1 em clean. Saída: cinza 100, embora essa cor não exista na origem. A votação agrupada deixa de ser uma votação por entrada da paleta.

Correção proposta: votação por índice exato da paleta com peso de cobertura, mantendo transparência separada. Manter a aproximação de 5 bits apenas no modo legado, se necessário. Testar também paletas com cores próximas e alpha parcial.

### P1 — Proteção de bordas subestima diferenças cromáticas azuis

Em analyzeRegions, a distância quadrática usa pesos .2126, .7152 e .0722 para RGB. Uma diferença de 100 no azul tem distância efetiva próxima de 27 e passa pelo filtro, apesar de ser uma mudança cromática grande.

Reprodução: imagem 12×8 dividida entre RGB(100,100,50) e RGB(100,100,150). Na fronteira, o canal azul muda de 50/150 para 68/132 após a análise. Portanto, a afirmação de preservar bordas fortes depende da cor da borda.

Correção proposta: comparar uma métrica perceptual com proteção adicional por diferença máxima de canal. Validar bordas vermelhas, verdes e azuis, inclusive de luminosidade próxima; não ajustar somente para um exemplo.

### P2 — Empates favorecem o primeiro pixel lido

resample escolhe o primeiro bucket cujo peso supera o máximo; pesos iguais mantêm o primeiro candidato. Uma imagem vermelha/azul de 2×1 reduzida para 1×1 escolhe vermelho; ao espelhar a origem, escolhe azul. A célula de saída é a mesma, mas a escolha muda com a ordem.

Correção proposta: critério estável baseado no erro de reconstrução e suporte espacial. Testar equivalência por espelhamento. Em empate perfeitamente simétrico, documentar um desempate determinístico que não dependa da varredura.

## Limitações que impedem ganho maior de qualidade

- A análise atual é um filtro de vizinhança, seguido por votação em células. Não detecta peças do objeto nem reconstrói contornos.
- cleanRegionSpecks remove apenas um pixel isolado, de baixo contraste, com pelo menos seis vizinhos da mesma cor. Manchas de dois ou mais pixels e sequências de degraus irregulares ficam intactas. Aumentar indiscriminadamente a força pode remover detalhes legítimos.
- A escolha de paleta precede a simplificação. Uma paleta inadequada pode fundir materiais e sombras antes que a etapa espacial consiga distingui-los.
- PF.conform roda sincronamente no fluxo da interface. Tornar a análise muito mais pesada sem mudar sua execução pode congelar os controles. O limite de resolução intermediária controla custo, mas não resolve esse desenho de execução.

## Ordem recomendada de evolução

1. Corrigir votação por índice, distância cromática e desempate; adicionar regressões dos casos acima.
2. Criar um conjunto visual de referência com arquivos originais, tamanhos de saída e recortes esperados: luva, joia, personagem, linhas finas e transparência. Comparar os modos com a mesma paleta e escala.
3. Experimentar análise de componentes de cor: considerar tamanho, contraste e continuidade antes de fundir uma pequena mancha. Proteger linhas, pontas, aberturas e destaques.
4. Experimentar escolha entre candidatos de redução usando erro de cor, contorno e fragmentação. Preservar a dimensão final; não prometer reconstrução semântica.
5. Para uma opção realmente demorada, mover a análise para Web Worker, com cancelamento e descarte de resultados antigos. Comparar variantes antes/depois na interface.

Critérios de aceitação: menos componentes de ruído sem perda de conectividade importante; cores dentro da paleta; silhueta e transparência preservadas; contornos comparáveis por espelhamento; ganho visual revisado em fontes reais. Contagem menor de cores ou pixels isolados, sozinha, não prova maior fidelidade.
