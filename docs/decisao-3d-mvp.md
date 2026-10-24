# Decisão técnica — bancada 3D MVP

Auditoria em 2026-10-24: o checkout contém a aplicação em scripts clássicos, pipeline em `src/core.js`, biblioteca 2D em IndexedDB/`.pfset` versão 1 e build estático que copia `index.html`, `styles.css` e `src/`. Não há diretório `lowpoly-forge/`, cópia local de Three.js, dependências npm ou servidor de aplicação. A interface suporta `file://` e isso é parte do produto.

Decisão: manter scripts clássicos e implementar o viewport com WebGL nativo, sem CDN, mantendo a inicialização do 2D independente. Usar o asset já derivado pelo pipeline 2D como textura RGBA; não criar outro quantizador. Exportar formas paramétricas próprias para GLB 2.0 com PNG incorporado, e reabrir por leitura estrutural do GLB antes de habilitar download. Não modificar o formato `.pfset` nesta fase; salvar receita JSON independente para evitar migração da persistência. Os presets só alteram filtro/material/forma visual disponível. Sem biblioteca de terceiros a reutilizar, portanto não há licença externa a incorporar.

Limites assumidos: o módulo requer WebGL; se indisponível, a aba mostra erro e as abas 2D seguem operacionais. GLB MVP contém mesh, UV, material PBR simples e textura PNG embutida; não cobre animação, rigging ou reconstrução fotogramétrica. A construção/reabertura será limitada às formas desta bancada.
