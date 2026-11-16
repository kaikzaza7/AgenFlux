# Origem e licença dos assets visuais

## Decisão

Todo o pixel art do escritório (personagens, piso, paredes, móveis, balões) é **original do AgenFlux e desenhado por código** em `src/lib/pixel/sprites.ts`. Não há imagens externas no escritório.

| Item | Origem | Licença |
|---|---|---|
| 12 personagens (4 direções × 4 quadros) | código próprio, `drawCharacter` | a mesma do projeto |
| Cenário (pisos, paredes, portas, 20+ móveis) | código próprio, `drawProp` | a mesma do projeto |
| Balões de status e envelope | código próprio | a mesma do projeto |
| Ícones da interface | [lucide-react](https://lucide.dev) | ISC |
| Logo | arquivos em `public/` (já existentes no projeto) | do autor do projeto |

Nenhum sprite, mapa ou recurso de Pokémon ou de outro jogo comercial foi usado; a referência é apenas de **estilo** (RPG 16-bit visto de cima).

## Por que sprites originais

Você pediu que a licença de cada pacote fosse **verificada individualmente**. No ambiente em que esta versão foi construída, `itch.io`, `opengameart.org` e `kenney.nl` estavam bloqueados pela rede, então **não foi possível abrir as páginas de licença**. Em vez de usar assets com licença não conferida, optei por arte original, que também traz vantagens práticas: zero downloads, zero dependências, aparência consistente e troca de cores por agente.

## Pacotes pesquisados (licenças NÃO verificadas — confira antes de usar)

| Pacote | O que lembro da licença | Situação |
|---|---|---|
| Kenney (kenney.nl), ex.: “Tiny Town”, “RPG Urban Pack” | CC0 | não conferido nesta data |
| Pipoya Free RPG Character Sprites 32x32 (itch.io) | uso livre com restrições à redistribuição dos arquivos | não conferido; ler a página |
| 5yvalia “RPG type retro top-down NPC sprites” (itch.io) | desconhecida | não conferido |
| OpenGameArt | varia por autor (CC0, CC-BY, GPL…) | conferir item a item |

## Como trocar por um pacote externo

1. Confirme a licença e registre-a nesta tabela (autor, link, licença, data).
2. Coloque as imagens em `public/sprites/`.
3. Em `src/lib/pixel/sprites.ts`, faça `spriteSheet()` carregar a imagem em vez de desenhar. O contrato é uma folha com **4 linhas** (baixo, cima, direita, esquerda) e **4 quadros** de 16×20 px.
4. O restante (mapa, A*, estados) não muda.
