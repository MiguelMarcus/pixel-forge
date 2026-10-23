# Pixel Forge

Conformador de assets 2D. Recebe **qualquer** imagem (arte de IA, render, screenshot, PNG com
antialias) e devolve um sprite de pixel art que respeita um contrato verificável por máquina:
grade discreta, paleta fechada, alpha binário, outline na silhueta, zero cores fantasma.

Roda 100% local, no navegador. Não instala nada, não usa servidor, não manda nada pra fora.

---

## Como abrir

Também pode ser servido como site estático pelo GitHub Pages. A publicação usa apenas
`index.html`, `styles.css` e `src/`; fontes importadas e backups continuam no navegador.

1. Duplo clique em `index.html` (ou em `abrir.cmd`).
2. Arraste uma imagem, cole com `Ctrl`+`V`, ou clique em um dos exemplos.

Não precisa de servidor: o app usa scripts clássicos (não módulos ES) justamente pra funcionar
em `file://`. Imagens entram por `FileReader` + data URL, então o canvas nunca fica "tainted".

Atalho de demonstração: `index.html?demo=pocao` ou `index.html?demo=slime`.

---

## O pipeline

Nada do modelo vai direto pro jogo. A ordem importa:

| # | etapa | por quê |
|---|-------|---------|
| 1 | remoção de fundo (opcional) | flood fill **a partir das bordas**, então um olho branco dentro do sprite sobrevive |
| 2 | recorte ao conteúdo | o sprite passa a preencher o quadro |
| 3 | reamostragem pra grade | `dominante` / `box` / `nearest` (ver abaixo) |
| 4 | limiar de alpha | alpha vira 0 ou 255; sem semitransparência |
| 5 | quantização + dither | toda cor passa a ser um índice da paleta |
| 6 | limpeza de órfãos | remove pixels isolados que sobraram da quantização |
| 7 | outline | dilatação da silhueta na cor mais escura da paleta |
| 8 | validação | 9 checagens contra o contrato |

### Borda e limpeza

A **borda** aceita largura de **1 a 8 px** e **cor própria** — se a cor não estiver na paleta, ela
é acrescentada (e passa a contar no contrato). Com “cor auto” usa a cor mais escura da paleta.
A margem do encaixe acompanha a largura, então a borda não é cortada na beirada do quadro.

**“Apagar pretos e brancos”** zera o alfa de tudo que estiver a menos de *tolerância* do preto
ou do branco, antes do recorte — útil quando o gerador deixa contorno escuro ou fundo branco
incrustado no sprite. Com tolerância 0 só o preto/branco exatos somem.

**Borda para dentro** pinta as N camadas externas da própria silhueta, em vez de crescer pra
fora. O sprite mantém o tamanho — o contorno é “comido” por dentro.

**Silhueta (sombra)** achata o sprite num tom só — preto ou branco — mantendo o alfa, antes da
borda. Serve para sombra projetada, silhueta de cutscene e para testar se a **forma** lê sozinha.
Nesse modo a borda automática usa o tom oposto (branca numa silhueta preta), senão ficaria
invisível. Como tudo entra na receita, dá para salvar o sprite e a sombra como dois assets do
mesmo acervo.

### Âncora e score

Marque um asset aprovado como **âncora** (botão no card da Biblioteca). Todo outro asset do
mesmo perfil passa a mostrar um score 0–100 contra ele:

| score | veredito | o que fazer |
|---|---|---|
| **≥ 85** | aceitar | entra no acervo |
| **70–84** | ajustar | vale um retoque ou re-conformar |
| **< 70** | re-gerar | volta pro gerador com o âncora como referência |

O score soma sete distâncias normalizadas: paleta (30%), distribuição de valor (25%), peso de
linha (15%), outline (10%), preenchimento e proporção da silhueta (15%) e escala (5%). O
tooltip do badge diz **qual eixo** puxou o score pra baixo — então "re-gerar" não é palpite.

O score não conserta nada: ele **tria**. É o que deixa rodar 20 variações e escolher 3 sem
olhar uma por uma.

### Lote

Arraste **2 ou mais imagens** (ou selecione várias no seletor): elas são conformadas com o
perfil e o contrato atuais e vão direto pra Biblioteca, com progresso no aviso. **1 arquivo**
continua abrindo no editor, para ajuste fino.

### Dither

Três modos, e a diferença aparece em gradiente:

- **ordenado (Bayer 4×4)** — padrão xadrez previsível. Clássico, mas salta aos olhos num céu grande.
- **blue noise** — máscara 64×64 gerada por void-and-cluster e embutida no `core.js`. Mesma
  função do Bayer, com grão irregular: resolve o céu sem o xadrez.
- **Floyd–Steinberg** — difusão de erro, orgânico, mas deixa ruído solto.

A paleta extraída sai **ordenada em rampas** (família de matiz, do escuro pro claro). Reordenar
não muda a quantização — a busca é por proximidade —, mas faz o `.gpl` e o painel do Aseprite
lerem como rampa em vez de ordem aleatória.

### Por que "dominante" é o padrão

Média (`box`) de uma célula que contém borda azul e fundo branco produz **cinza** — uma cor que
não existe em nenhum dos dois. É daí que vem aquele aspecto "lavado" de pixel art gerada por IA.
A amostragem `dominante` agrupa os pixels da célula por cor e escolhe a cor mais frequente, então
a célula herda uma cor que realmente existia ali.

---

## Perfis de aplicação

O mesmo pipeline serve para coisas com regras **opostas**. O perfil escolhe os padrões, o
contrato e quais regras extras rodam.

| perfil | grade | encaixe | outline | validação extra |
|---|---|---|---|---|
| **Personagem** | 16 / 32 / 48 / 64 | conter, alinhado à base | sim, fechado | pé na linha de base · centralizado na horizontal |
| **Objeto / prop** | 16 / 32 / 48 / 64 | conter, centralizado | sim | centralizado nos dois eixos |
| **Fundo / parallax** | 320×180 até 640×360 | cobrir (corta o excesso) | não | opaco · preenche o quadro · emenda horizontal · **32+ cores, sem dither por padrão** |

Trocar de perfil aplica os padrões dele — depois você ajusta à vontade.

O **pivô** vai no manifesto: personagem `(w/2, h-1)` (pé), prop `(w/2, h/2)`, fundo nenhum.
O fundo também leva `parallax: { scrollFactor, tileX: true, tileY: false }`.

### Emenda de fundo

A checagem compara a distância entre a **última e a primeira coluna** (que ficam vizinhas
quando o tile repete) com a distância média entre colunas vizinhas dentro da própria imagem.
Se a emenda for um outlier, o fundo não tileia:

- gradiente cíclico → passa
- metade escura / metade clara → falha (`borda 366 vs interna 6`)

É heurística, não prova matemática, mas pega o caso que importa: a emenda visível.

### Uma sutileza que mudou o pipeline

O limiar de alpha precisa rodar **antes** do encaixe. Se ele roda depois, um glow
semi-transparente entra no cálculo do bounding box, a silhueta "infla" e o alinhamento de pé
na base sai errado — o sprite flutua. Foi exatamente o que o teste de perfil pegou.

---

## Biblioteca e folha

Cinco abas:

- **Sprite** — conforma um asset contra o contrato do perfil.
- **Biblioteca** — o acervo do projeto.
- **Folha** — monta o conjunto e valida o conjunto.
- **Sombra** — projeta sombra automática nos sprites.
- **Relevo e luz** — gera bump e normal map, com iluminação de teste.

### A biblioteca guarda a receita, não o bolo

Cada item guarda `{ fonte original, parâmetros, contrato }`. O sprite é sempre
re-derivável, então:

- **"reconformar em 24px"** é mudar um número e rodar o pipeline de novo — não é escalar pixel;
- **"reaplicar contrato"** re-deriva todos os assets do perfil atual com o contrato de agora,
  então mudar o padrão do projeto não deixa metade do acervo congelada no contrato antigo;
- o PNG/`.aseprite` exportado nunca é a única cópia de nada.

Escalar sprite na folha seria o erro clássico: 32px × 1,5 dá pixels de meio tom e o
manifesto deixa de descrever o que está na tela. Por isso a folha **não redimensiona** —
ela oferece *reconformar*, que roda o pipeline na fonte original.

### Persistência

- **IndexedDB** quando o navegador deixa (em `file://` o Chrome costuma bloquear);
- **memória** como queda silenciosa — a UI avisa "memória (salve o .pfset)";
- **salvar/abrir `.pfset`** é o backup de verdade: um JSON com fontes + receitas + layout.

### Folha: dois modos

| modo | posição | valida |
|---|---|---|
| **Grade** | célula uniforme | tamanho da célula · linha de base na célula · drift de altura entre frames · frames vazios · duplicatas · paleta união |
| **Régua** | livre, sobre uma linha de base | sobreposição · linha de base comum · limites do quadro · duplicatas · paleta união |

A folha compõe numa **paleta única** (união das paletas) e exporta PNG indexado,
JSON de frames (com bbox e pivô por frame) e `.aseprite`.

Duplicata é comparada por **arte**, não por índice: dois sprites idênticos com paletas
diferentes têm índices diferentes e ainda assim são o mesmo desenho.

## Sombra

Aba dedicada a projetar sombra nos sprites já desenhados, sem desenhar à mão. Escolhe um asset
da Biblioteca e gera a projeção:

- **elipse (chão)** — a sombra clássica sob os pés;
- **silhueta achatada** — a própria forma do sprite comprimida, para projeção lateral.

Controles: largura, achatamento, deslocamento X/Y, cor, opacidade e **folga abaixo**. A folga
importa: sprite alinhado à base não tem espaço embaixo, e sem ela a sombra fica escondida atrás
do próprio sprite — só apareceria nas beiradas.

Exporta **PNG com sombra** (bitmap pronto), **PNG só da sombra** (para o engine desenhar atrás
do personagem) e **.aseprite** do composto.

A sombra é o único asset com **alfa parcial** neste app — ela precisa se misturar com o chão. Sai
como PNG indexado com `tRNS` de alfa variável; o sprite continua com alfa binário e o contrato
dele não muda.

---

## Relevo e luz · bump e normal map

Use o sprite atual do editor ou um asset da Biblioteca. A nova aba gera mapas separados,
sem alterar a receita, a paleta ou as cores originais do sprite:

- **Volume pela silhueta** estima uma superfície arredondada pela distância até a borda.
  Funciona com cores chapadas; “detalhes da cor” mistura a luminosidade à altura estimada.
- **Luminosidade da imagem** usa claro como alto e escuro como baixo. Pode interpretar
  uma cor escura como cavidade, então use esse modo quando isso representar o material.
- **Força, suavização e inversão** controlam o relevo e as normais. O padrão exporta Y+
  (OpenGL); a opção de inverter verde exporta Y− (DirectX). A prévia não muda ao trocar
  essa convenção: ela representa a mesma superfície.
- **Luz de teste** tem direção, elevação, ambiente, intensidade, cor e brilho especular.
  Clique e arraste na prévia para mudar a direção. A autossombra faz uma busca limitada
  no mapa de altura; é uma aproximação da superfície, não uma simulação completa do cenário.

Exporte **PNG normal map**, **PNG bump / altura** e **PNG cor base** para usar no motor.
Os arquivos mantêm dimensões e alpha e usam PNG RGBA de 8 bits por canal, sem paleta
reduzida: quantizar as cores do normal map distorceria as direções. A força controla as
normais e a prévia; o bump guarda a altura normalizada, para ajustar a escala no motor.
**PNG com a luz atual** grava a prévia iluminada, caso queira um bitmap já pronto.

No Godot, use um `CanvasTexture` com a cor base em Diffuse e o mapa em Normal Map,
uma `Light2D` e filtro nearest. Veja a
[documentação de iluminação 2D](https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html).
Outros motores precisam de um material ou shader que leia normal maps em sprites.

Os controles de relevo e luz são persistidos no navegador e no `.pfset`; backups anteriores
continuam abrindo com os padrões da nova aba. A cor base deve preferencialmente ter cores
chapadas: o algoritmo estima o relevo e não remove iluminação já pintada na imagem.
Sombras projetadas nos outros objetos dependem do sistema de luz do motor.

Os presets **suave**, **marcado** e **plano** são pontos de partida para o relevo.
**Redefinir relevo e luz** volta aos padrões sem trocar o sprite selecionado.

---

## Contrato (o juiz)

O contrato é o que separa "ficou bonito" de "está padronizado". Cada checagem pode falhar e
quebrar o build:

1. **Resolução na grade** — dimensões válidas, não gigantes pra sprite
2. **Índices válidos** — toda célula aponta pra uma entrada da paleta
3. **Máximo de cores** — `cores em uso ≤ máximo`
4. **Alpha binário** — nenhuma entrada com alpha parcial
5. **Separação de cores** — nenhum par de cores em uso mais próximo que o limiar (pega "antialias disfarçado de cor")
6. **Outline na silhueta** — todo pixel opaco na borda é da cor de outline
7. **Margem transparente** — opcional, exige folga na borda
8. **Pixels órfãos** — pixels sem nenhum vizinho da mesma cor (8 direções)
9. **Cobertura do quadro** — evita sprite quase vazio ou quadro inteiro pintado

O painel mostra ✓ / ✕ com o número exato, não um "ok" genérico. São 9 checagens base mais as
regras extras que o perfil ligar.

---

## Paleta

- **Presets**: PICO-8, Game Boy, DawnBringer 16, Sweetie 16, Ash 4.
- **Extrair da imagem**, dois modos:
  - **dominante** — median cut clássico; gasta a paleta proporcionalmente à área. Bom para
    personagem/prop de uma família de cor só.
  - **distribuída** — bins de cor + farthest point ponderado + k-means. Uma cor minoritária mas
    distante (tronco, contorno) também entra. Numa árvore com 8 cores: dominante devolve
    7 verdes + 1 claro; distribuída devolve 6 verdes + 1 marrom + 1 claro, e o erro máximo de
    cobertura cai de 67 para 18.
- **Custom**: cole hex (`#1a1c2c #b13e53 ...`).
- **Conta-gotas**: o botão “+ cor da imagem” ativa o conta-gotas; clique na metade original
  do preview e a cor exata entra na paleta — o quantizador passa a considerá-la de fato.

A paleta é a alavanca mais barata de padronização: unifica arte de IA, arte humana e procedural
sem depender de prompt nenhum.

---

## Exportar

- **PNG indexado 1×** — `colorType 3`, com `PLTE` + `tRNS`. Por construção o arquivo **não
  consegue** conter uma cor fora da paleta. É o formato que Aseprite, Godot e Tiled entendem.
- **`.aseprite`** — sai em **RGB (color depth 32)**, que é o modo dos arquivos do próprio
  Aseprite: dá pra pintar com qualquer cor, sem a trava da paleta. A paleta vai junto no
  arquivo (chunk `0x0004`) só como referência, e o cel é comprimido em zlib. O modo indexado
  (`0x2019`) segue disponível no encoder para quando você quiser a paleta travada.
  Escrito contra a
  [spec oficial](https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md).
- **PNG 8×** — ampliação nearest-neighbor exata, pra preview e documentação.
- **`.gpl`** — paleta pro Aseprite/GIMP.
- **`manifesto .asset.json`** — fonte, parâmetros, contrato, paleta, checagens e timestamp.
  É a proveniência: dá pra re-rodar a biblioteca inteira quando o contrato mudar.

### Se o arquivo não aparecer

O download é feito por **âncora + blob**, com a URL viva por 45s (revogar cedo trunca o
arquivo). Depois de cada export aparece uma barra no canto com o link direto — se o download
automático não vier, clique no link (ou botão direito → *salvar link como*).

Duas coisas também bloqueiam download e não dão erro:

- rodar dentro de **iframe/pré-visualização** — abra o `index.html` direto no navegador;
- política de downloads do navegador (Chrome bloqueia várias descargas automáticas seguidas;
  o ícone de bloqueio aparece na barra de endereço).

Toda falha vira um aviso na tela, e o detalhe vai pro console. Se aparecer "O encoder
.aseprite não carregou", o `src/aseprite.js` não foi carregado — confira se a pasta `src/`
inteira veio junto do `index.html`.

---

## Testes

```bash
node tests/test-core.mjs        # pipeline, encoder PNG e .aseprite, dither, idempotência
node tests/test-ui.mjs          # app.js rodando num shim de DOM (ids, render, controles)
python tests/make_fixture.py    # fixture de pixel art real (opcional)
python tests/verify_png.py      # abre o PNG gerado com Pillow e checa os chunks na mão
python tests/verify_aseprite.py # lê o .aseprite só com a spec e compara com o PNG
node --test tests/test-regressions.cjs # casos de regressão da auditoria

# antes/depois com uma entrada realista (pixel art "degradada" em estilo IA)
python tests/make_roundtrip_input.py
node tests/roundtrip.mjs        # -> tests/out/rt-*.png
```

O `verify_png.py` existe pra não confiar no próprio encoder: ele abre o arquivo com Pillow e
confirma `mode == P`, `colorType 3`, `tRNS`, zero alpha parcial e upscale nearest exato.

O `verify_aseprite.py` é um leitor independente escrito só a partir da spec. Antes de validar o
arquivo gerado, ele lê um `.aseprite` salvo pelo próprio Aseprite
(`tests/fixtures/cavaleiro-64.aseprite`) e reconstrói o PNG original com **100%** dos pixels
iguais. Se o parser entende o arquivo do Aseprite, o entendimento do container está certo;
depois disso, comparar o gerado com o PNG exportado é verificação real.

Estado atual: **104/104** no core, **126/126** na UI, **14/14** cenários de regressão,
**9/9** cenários de relevo/iluminação, **25/25** na verificação do PNG indexado,
**18/18** na do `.aseprite`, **3/3** arquivos RGBA verificados com Pillow e **1/1** teste
do pacote de publicação.

`npm test` executa núcleo, UI e regressões com Node 22 ou superior. Para os verificadores
independentes, instale Pillow (`python -m pip install Pillow`) e rode `npm run test:formats`
depois de `npm test`. O aplicativo não precisa dessas ferramentas para funcionar.

### Publicação

O workflow `.github/workflows/pages.yml` testa o projeto antes de publicar a branch `main`.
No repositório, configure **Settings → Pages → Source → GitHub Actions**. O pacote estático
é gerado com `npm run build` em `_site/`. Pull requests executam os testes sem publicar.

### Segurança dos backups

Importar `.pfset` valida a estrutura, decodifica as fontes e prepara as receitas antes de
substituir o acervo. Itens e metadados são gravados juntos; uma falha preserva o projeto
anterior. Erros de IndexedDB aparecem na interface: salve um `.pfset` para preservar o
trabalho da sessão. As correções da auditoria estão descritas em `CHANGELOG.md`.

O `.pfset` inclui também o **sprite em edição**, mesmo sem salvá-lo na Biblioteca.
Editar esse sprite marca o backup como pendente. Fontes acima de 16 megapixels ou
8192 px por lado são recusadas antes da leitura de pixels para evitar travar o canvas.
O manifesto registra a receita, a margem efetiva e a paleta RGBA, além dos índices de
transparência. Veja a [segunda auditoria](docs/audit-1.5.1.md).

---

## Limitações (honestas)

- **É um conformador, não um gerador.** Ele não inventa o sujeito; ele normaliza o que existe.
  Se a silhueta não lê em 16px, nenhum quantizador salva.
- **Fundo complexo** (foto, gradiente) não sai com flood fill simples. Use tolerância maior ou
  entre com uma máscara já recortada.
- **Animação** é quadro a quadro; a ferramenta garante formato por frame, não continuidade entre
  frames. Pra isso, gere um frame base e deforme/rig.
- **Lote usa os controles atuais.** Ajustes individuais continuam sendo feitos na aba Sprite.
- **Os testes de UI usam DOM simulado.** Eles cobrem fluxos e estado; a aparência deve ser
  conferida no navegador ao alterar o layout.

---

## Estrutura

```
pixel-forge/
  index.html          shell + aba Sprite + abas Biblioteca/Folha
  styles.css
  src/core.js         núcleo determinístico (roda no browser e no Node)
  src/aseprite.js     encoder .aseprite (indexado, zlib)
  src/profiles.js     perfis: personagem, prop, fundo/parallax
  src/score.js        score contra a âncora (paleta, valor, linha, silhueta)
  src/sheet.js        composição e validação de folha
  src/shadow.js       sombra automática (elipse e silhueta achatada)
  src/lighting.js     altura, normais, iluminação e autossombra no relevo
  src/lighting-tab.js interface da aba Relevo e luz
  src/library.js      armazenamento (IndexedDB/memória) e arquivo .pfset
  src/tabs.js         UI das abas Biblioteca e Folha
  src/app.js          aba Sprite e shell
  tools/              gerador da máscara blue noise (build, não roda no app)
  tests/              núcleo, UI, folha e verificação de PNG/.aseprite
```

O `core.js` não toca no DOM — é o mesmo arquivo no navegador (`window.PF`) e no Node
(`module.exports`). É por isso que o pipeline é testável de verdade.
# Redução para pixel art limpa

**Processamento em segundo plano:** abra com `abrir.cmd` (Python 3.10 ou superior)
para usar o servidor local em `http://127.0.0.1:7867`. O modo de análise de regiões
roda em um Worker, pode ser cancelado e descarta resultados de edições antigas.
Exportações e backup aguardam a edição atual. No HTML aberto diretamente como
arquivo, ou sem suporte a Worker, o processamento usa o modo síncrono anterior.
O servidor só oferece os arquivos estáticos do aplicativo, no próprio computador.
O endereço local tem armazenamento separado do HTML direto e do Pages: para
transferir sua biblioteca, salve e importe o backup `.pfset`.

Para uma análise adicional, escolha **análise de regiões (mais lenta)** em
**Amostragem**. Antes da redução, um filtro de vizinhança atenua variações pequenas
de cor e limita a mistura através de bordas de alto contraste. Depois de agrupar
os tons na paleta, ele remove apenas pontos isolados de baixo contraste cercados
por uma região opaca quase uniforme (com dithering desligado). Linhas conectadas,
brilhos fortes e pixels junto à transparência não passam por essa limpeza final.
A limpeza também considera ilhas completas de 2×2 pixels de baixo contraste,
somente quando cercadas por uma única cor opaca e sem conexões diagonais.
A votação mantém cores exatas da paleta e desempata de forma estável.
A análise usa uma resolução intermediária limitada e não é aplicada em tamanho
nativo. Trata-se de processamento local de cores e vizinhança, sem IA semântica.
Pode suavizar pequenos detalhes de baixo contraste: compare os dois modos.

Em **Amostragem**, escolha **pixel art limpa** para reduzir ilustrações grandes.
Esse modo reúne os tons na paleta escolhida antes de selecionar a cor dominante
de cada pixel de saída. Assim, variações próximas da mesma cor não dividem seus
votos e não favorecem pequenos pontos de outra cor. É o padrão de novos perfis
de personagem e objeto; receitas salvas mantêm sua opção anterior.

Use dithering **nenhum** para áreas de cor uniformes. A paleta continua importante:
cores ausentes nela serão substituídas. A redução não redesenha contornos nem
recupera detalhes menores que um pixel de saída; compare também um tamanho maior.
Os modos média e dominante agora ponderam a área exata de cada pixel de origem,
inclusive em reduções com proporções fracionárias.
