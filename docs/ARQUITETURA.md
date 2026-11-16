# Arquitetura do AgenFlux 3

```
Navegador (Next.js/React)                    Backend (Node, server/)
┌──────────────────────────┐  WebSocket   ┌────────────────────────────────────┐
│ Escritório Canvas 2D     │◄─snapshot────│ Headquarters (hq.ts)               │
│ 9 abas e painel do agente│──POST ação──►│  agenda, política de custo, eventos│
└──────────────────────────┘              │  ├ Orquestrador (orchestrator.ts)  │
                                          │  ├ Missões (missions.ts)           │
                                          │  ├ Skills (skills.ts)              │
                                          │  ├ Automações (automations.ts)     │
                                          │  └ Motores (engines/)              │
                                          │     opencode · ollama · claude · codex · local
                                          └──────────────┬─────────────────────┘
                                                SQLite (data/agent-hq.sqlite)
```

## Camadas

| Camada | Arquivos | Papel |
|---|---|---|
| Frontend | `src/components/*`, `src/lib/pixel/*` | escritório, abas, painel |
| Backend | `server/index.ts`, `server/hq.ts` | HTTP/WebSocket local, estado, agendador |
| Orquestrador | `server/orchestrator.ts`, `server/missions.ts` | plano, grafo de etapas, entregas, correções |
| Adaptadores | `server/engines/*` | OpenCode, Ollama, Claude (Claude Code CLI, somente leitura), Codex, ferramentas locais |
| Skills | `server/skills.ts`, `skills/` | descoberta, seleção, inspeção |
| Eventos | `EngineHost` em `server/engines/types.ts` | todo evento do escritório nasce de um motor |
| Persistência | `server/store.ts` | registros JSON em SQLite |

## O caminho de uma missão

1. **Você escreve.** A interface chama `mission.plan`.
2. **O Orquestrador analisa sem LLM** (`analyzeMission`): intenção por palavras-chave, complexidade, agentes, skills (até 3 por etapa) e modelo por etapa (`routeModel`). Cada escolha vem com o motivo. Você pode trocar agentes, modelos e skills.
   Se o Orquestrador tiver um modelo próprio (ex.: Claude), o plano ganha a etapa **briefing** — a orientação dele acompanha todas as etapas seguintes — e ele redige o relatório final.
3. **As etapas viram tarefas** com dependências. Etapas locais (inventário, varredura de segredos, relatório no perfil Econômico) não chamam IA.
4. **O agendador** inicia o que estiver liberado, respeitando: limite de execuções simultâneas, um agente por estação e **nunca duas etapas com escrita no mesmo workspace**.
5. **O motor executa** e devolve eventos reais: sessão criada, ferramenta usada, permissão pedida, conclusão.
6. **Entregas**: ao concluir, o resultado é registrado como mensagem (origem, destino, missão, etapa, conteúdo, horário, estado) para cada etapa dependente.
7. **Correções**: se Revisor, Segurança ou Testador marcarem `needsChanges` e a edição estiver autorizada, abre-se um ciclo Desenvolvedor → verificação (limite configurável).
8. **Relatório final** pelo Orquestrador.

## Escritório

- Canvas 2D puro (sem Phaser/PixiJS): 8 personagens em 46×26 tiles não justificam ~1 MB de biblioteca nem WebGL.
- Cenário desenhado uma vez em um canvas fora da tela; por quadro só os personagens são redesenhados. 20 quadros/s com movimento, 4 parado, zero com a aba oculta.
- Estado real → lugar: `running/queued/failed` = estação; `approval` = sala de aprovações; `waiting` = sala de reuniões; demais = área comum.
- O único movimento decorativo é o passeio de agentes ociosos.

## Segurança

- Servidor só em `127.0.0.1`; origem e `Content-Type` conferidos em toda ação.
- Credenciais de provedores ficam no OpenCode. A chave digitada na interface é repassada ao OpenCode local e descartada.
- A senha do servidor OpenCode gerenciado é aleatória e fica só em memória.
- Tudo o que vai ao banco ou ao navegador passa por `redact`.
- Edição, comandos e rede pedem aprovação; missões somente leitura negam edição no próprio motor.

## Recuperação

- Queda do fluxo de eventos do OpenCode: reconexão com espera crescente e reconciliação das sessões ativas.
- Reinício do AgenFlux: missões em andamento ficam bloqueadas com explicação; **Retomar missão** refaz só o que não concluiu.
- Banco: cópia automática antes da migração (`agent-hq.pre-v3.sqlite`).
