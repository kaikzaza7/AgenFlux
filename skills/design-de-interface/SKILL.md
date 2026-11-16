---
name: design-de-interface
description: Diretrizes para criar e melhorar interfaces: hierarquia visual, espaçamento, tipografia, cores e estados dos componentes. Use ao alterar telas, layouts ou a aparência de um sistema.
license: MIT
compatibility: opencode
metadata:
  keywords: interface, ui, ux, design, visual, layout, tela, moderna, moderno, estilo, frontend
  agents: analyst,planner,developer,reviewer
  origem: agenflux
---

# Design de interface

## Antes de alterar
1. Liste as telas e componentes afetados e o que cada um precisa comunicar.
2. Identifique os tokens existentes (cores, espaçamentos, raios, fontes). Reutilize-os; não crie valores soltos.
3. Preserve a identidade visual do projeto. Melhorar não é trocar de estilo.

## Princípios
- **Hierarquia**: um elemento principal por tela; títulos, textos e ações secundárias em níveis claros.
- **Espaçamento**: use uma escala (4/8/12/16/24/32). Mais espaço entre grupos do que dentro deles.
- **Tipografia**: no máximo dois pesos por bloco; linhas de 45–75 caracteres; nada abaixo de 12px.
- **Cor**: contraste mínimo 4.5:1 para texto; cor nunca é o único indicador de estado.
- **Estados**: todo controle precisa de hover, foco visível, ativo, desabilitado e carregando.
- **Densidade**: prefira remover elementos a encolhê-los.

## Ao entregar
- Descreva o antes e o depois de cada mudança e o motivo.
- Confirme que nenhuma funcionalidade foi removida ou teve o comportamento alterado.
- Verifique em largura estreita (≈380px) e larga (≥1280px).
