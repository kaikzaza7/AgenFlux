---
name: nextjs
description: Orientações para projetos Next.js com App Router: componentes de servidor e cliente, rotas, dados, metadados e build. Use ao trabalhar em aplicações Next.js.
license: MIT
compatibility: opencode
metadata:
  keywords: next.js, nextjs, next, app router, server components, rota, rotas, ssr, frontend
  agents: developer,reviewer
  origem: agenflux
---

# Next.js (App Router)

- **Servidor por padrão**: só adicione `"use client"` em componentes que usam estado, efeitos ou APIs do navegador, e o mais abaixo possível na árvore.
- **Fronteira cliente/servidor**: props passadas a componentes cliente precisam ser serializáveis. Nunca importe código exclusivo de servidor (fs, segredos) em um componente cliente.
- **Variáveis de ambiente**: somente as iniciadas por `NEXT_PUBLIC_` chegam ao navegador. Segredos ficam em rotas e ações de servidor.
- **Rotas de API** (`route.ts`): valide entrada, método e origem; devolva códigos HTTP corretos.
- **Dados**: defina cache/revalidação de forma explícita; use `dynamic = "force-dynamic"` quando a resposta depende da requisição.
- **Metadados**: use `metadata`/`generateMetadata` em vez de tags manuais.
- **Imagens e fontes**: `next/image` e `next/font` evitam mudança de layout.
- **Antes de entregar**: rode `npm run build` e o verificador de tipos; erros de hidratação indicam diferença entre o HTML do servidor e do cliente.
