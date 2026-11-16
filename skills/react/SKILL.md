---
name: react
description: Boas práticas de React moderno: componentes, estado, efeitos, listas, desempenho e erros comuns. Use ao criar, alterar ou revisar componentes React.
license: MIT
compatibility: opencode
metadata:
  keywords: react, jsx, tsx, hooks, componente, componentes, usestate, useeffect, frontend, typescript/react, javascript/react
  agents: developer,reviewer
  origem: agenflux
---

# React

- **Componentes pequenos** e com uma responsabilidade; extraia quando um trecho ganha estado próprio.
- **Estado mínimo**: não guarde no estado o que pode ser calculado a partir de props ou de outro estado.
- **Efeitos**: `useEffect` é para sincronizar com sistemas externos (rede, DOM, timers). Sempre devolva a limpeza. Não use efeito para derivar dados.
- **Dependências**: liste todas; se o efeito dispara demais, o problema está no desenho, não no array.
- **Listas**: `key` estável e única (nunca o índice quando a lista muda de ordem).
- **Eventos**: prefira manipuladores a efeitos para reagir a ações do usuário.
- **Desempenho**: meça antes de aplicar `memo`, `useMemo` ou `useCallback`. Evite recriar objetos grandes a cada render.
- **Refs** guardam valores que não afetam a renderização (timers, elementos, instâncias).
- **Acesso a `window`/`document`** somente dentro de efeitos ou manipuladores.
- **Erros comuns**: mutar estado diretamente; condicionar hooks; buscar dados sem cancelar requisições antigas.
