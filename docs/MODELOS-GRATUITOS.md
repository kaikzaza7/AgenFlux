# Modelos gratuitos: o que foi verificado e como o AgenFlux decide

**Data da verificação: 16/11/2026.** Ofertas gratuitas mudam com frequência. Por isso o AgenFlux **não usa uma lista fixa**: ele lê, a cada conexão, o preço que o próprio provedor informa ao OpenCode e classifica a partir daí.

## Verificado diretamente (OpenCode 1.19.5 real, sem chave)

O provedor `opencode` (Zen) respondeu com 9 modelos de preço zero, todos com uso de ferramentas:

| Modelo | ID no OpenCode | Contexto |
|---|---|---|
| Nemotron 3 Ultra Free | `opencode/nemotron-3-ultra-free` | 1.000k |
| Nemotron 3.5 Lightning Free | `opencode/nemotron-3.5-lightning-free` | 262k |
| Nemotron 3.5 Super VL Free | `opencode/nemotron-3.5-super-vl-free` | 1.049k |
| GLM-5.3-Flash Free | `opencode/glm-5.3-flash-free` | 200k |
| DeepSeek V4.1 Flash Free | `opencode/deepseek-v4.1-flash-free` | 200k |
| Flint 40B Free | `opencode/flint-40b-free` | 262k |
| MiMo-V2.6-Flash Free | `opencode/mimo-v2.6-flash-free` | 200k |
| Beam Free | `opencode/beam-free` | 1.049k |
| Big Pickle | `opencode/big-pickle` | 200k |

O AgenFlux os classifica como **Gratuito temporariamente**.

## Informações de terceiros (pesquisa na web, não confirmadas na página oficial)

A página oficial `opencode.ai` estava inacessível no ambiente em que esta versão foi construída. Segundo resultados de busca:

- os modelos gratuitos do Zen são ofertas **por tempo limitado**;
- eles funcionam **dentro do OpenCode**; outros clientes recebem erro 403 — mais um motivo para o AgenFlux usar o OpenCode como motor;
- os Nemotron hospedados pela NVIDIA são de **uso de avaliação**: não envie dados pessoais ou confidenciais.

**Confirme em https://opencode.ai/docs/zen antes de depender deles.**

## Outras opções (exigem cadastro e chave gratuita)

| Provedor | Categoria no AgenFlux | Observação |
|---|---|---|
| OpenRouter — variantes `:free` | Gratuito com limite | limite diário de requisições por conta |
| NVIDIA build (NIM) | Gratuito com limite | uso de avaliação, limite por minuto |
| Google AI Studio | Gratuito com limite | cota diária; nem todo modelo é gratuito |
| Groq | Gratuito com limite | limites por minuto e por dia |
| Ollama | Local | sem cota; depende do seu hardware |

Os limites exatos **não foram verificados** nesta data: consulte a página de cada provedor (links na aba Modelos e Provedores).

## Como a classificação funciona (`server/catalog.ts`)

1. Preço de entrada ou saída > 0 → **Pago**, mesmo que o nome contenha “free”.
2. Provedor local (Ollama, LM Studio, endereço `127.0.0.1`) → **Local**.
3. Preço zero em plano por assinatura (GitHub Copilot, “coding plans”, Codex/ChatGPT) → **Pago (assinatura)**.
4. Preço zero no Zen → **Gratuito temporariamente**; nos demais → **Gratuito com limite**.
5. Provedor desconectado ou modelo descontinuado → **Indisponível**.

A categoria **Gratuito** (sem ressalvas) existe, mas nenhum provedor verificado se enquadra nela hoje.

## Política “Somente modelos gratuitos” (ligada por padrão)

- Modelos pagos nunca são escolhidos, nem como alternativa.
- Sem modelo gratuito compatível, a missão **não começa** e explica o motivo.
- Limite atingido: tenta outro modelo permitido; se não houver, a etapa para e você escolhe.
- Se um modelo classificado como gratuito **reportar custo**, a etapa é interrompida na hora.
- ChatGPT Plus **não** dá créditos de API. O Codex usa os limites da assinatura e só entra se você ligar “Permitir assinatura já contratada”.
- O AgenFlux nunca ativa cobrança ou recarga automática.
