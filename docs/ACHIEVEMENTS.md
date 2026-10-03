# Conquistas — implementação

Status: implementado localmente na branch `codex/achievements-plan`. As migrations `003_achievements.sql` e `004_king_cron.sql` ainda precisam ser executadas no projeto Supabase antes de publicar o frontend. Nenhuma migration foi aplicada ao banco remoto por esta tarefa.

## Regras do produto

- Conquistas pertencem ao usuário autenticado. Partidas como convidado continuam locais e não são convertidas em conquistas ao entrar depois.
- Uma conquista permanente aparece uma vez por usuário, com data de obtenção. O perfil mostra apelido, nome, e-mail e inicial como avatar, recorde do ranking, total de conquistas e grade de insígnias obtidas e bloqueadas. E-mail e demais dados da conta só aparecem para o próprio usuário.
- Nomes e descrições são textos traduzíveis; a chave estável (`slug`) é usada no banco e no código. Ícones SVG originais, feitos com formas geométricas neon, são a primeira opção: pequenos, leves e nítidos em qualquer tela. `badge_key` aponta para um ícone conhecido pelo frontend, sem aceitar SVG/HTML arbitrário vindo do banco.
- Conquistas exclusivas têm **um titular por vez**. A primeira qualificação recebida e validada pelo servidor ganha. Outros qualificados entram em lista de espera; se o titular tiver a conta removida, o próximo candidato mais antigo recebe a insígnia. Uma simples saída do ranking não remove a conquista.
- Nada é concedido retroativamente na primeira versão: os contadores começam quando a funcionalidade entrar em produção. Isso evita inferir mortes, uso de túneis ou combos a partir da tabela `scores`, que só guarda o melhor resultado.

## Catálogo revisado — 18 conquistas

As metas formam famílias de dificuldade e somam 18 insígnias. Cada nível tem seu próprio `slug` e prêmio, para que seja possível ampliar uma família no futuro sem alterar conquistas já obtidas.

| # | Nome / slug | Como obter | Tipo | Insígnia sugerida |
| --- | --- | --- | --- | --- |
| 1 | **Ace Spirit** / `ace_spirit` | Concluir uma tela sem nenhuma morte durante aquela tela. Pode haver mortes em telas anteriores da mesma partida. | Permanente | Halo de quatro pontas em ciano |
| 2 | **Noob** / `noob` | Ter Game Over em **três partidas autenticadas distintas** sem concluir a primeira tela. | Permanente | Faísca pequena quebrada em coral |
| 3 | **Neon Maze King** / `neon_maze_king` | Ficar em primeiro lugar no ranking por **30 dias UTC consecutivos**, conforme o registro diário do servidor. | Permanente | Coroa com três barras neon |
| 4 | **First Light** / `first_light` | Ser a primeira pessoa a concluir **50 telas em uma partida sem morrer**. | Exclusiva | Prisma aceso sobre o número 50 |
| 5 | **Light Bringer** / `light_bringer` | Ser a primeira pessoa a concluir **500 telas em uma partida sem morrer**. | Exclusiva | Farol neon de cinco feixes |
| 6 | **Neon Pioneer** / `neon_pioneer` | Ser a primeira pessoa a concluir **50 telas em uma partida**; mortes são permitidas. | Exclusiva | Bandeira em forma de raio |
| 7 | **Spark Starter** / `spark_starter` | Alcançar **1.000 pontos de saldo** em uma partida antes da primeira morte. | Permanente | Constelação de faíscas |
| 8 | **Spark Keeper** / `spark_keeper` | Alcançar **100.000 pontos de saldo de pico** em uma partida. | Permanente | Prisma carregado |
| 9 | **Still Standing** / `still_standing` | Perder uma vida com **desconto efetivo superior a 100.000 pontos**. | Permanente | Escudo rachado com pulso aceso |
| 10 | **Tunnel Loop** / `tunnel_loop` | Atravessar túneis laterais **mais de 100 vezes** na mesma partida (101 travessias ou mais). | Permanente | Dois portais ligados por 101 pulsos |
| 11 | **Amazind Circuit** / `amazind_circuit` | Concluir **25 telas na mesma partida sem nenhuma morte**. | Permanente | Circuito de um anel |
| 12 | **Perfect Circuit** / `perfect_circuit` | Concluir **100 telas na mesma partida sem nenhuma morte**. | Permanente | Circuito de dois anéis |
| 13 | **Ominius Circuit** / `ominius_circuit` | Concluir **250 telas na mesma partida sem nenhuma morte**. | Permanente | Circuito de três anéis |
| 14 | **Phantom Quartet** / `phantom_quartet` | Capturar **4 ecos** sob uma única bola de energia. | Permanente | Quatro losangos convergentes |
| 15 | **Phantom Quintuplets** / `phantom_quintuplets` | Capturar **5 ecos** sob uma única bola de energia. | Permanente | Cinco losangos convergentes |
| 16 | **Phantom Sextuplets** / `phantom_sextuplets` | Capturar **6 ecos** sob uma única bola de energia. | Permanente | Seis losangos convergentes |
| 17 | **Phantom Septuplets** / `phantom_septuplets` | Capturar **7 ecos** sob uma única bola de energia. | Permanente | Sete losangos convergentes |
| 18 | **Phantom Octuplets** / `phantom_octuplets` | Capturar **8 ecos** sob uma única bola de energia. | Permanente | Oito losangos convergentes |

Os nomes, descrições e ícones são dados de catálogo; os limites fazem parte das regras SQL versionadas. Alterar o texto não muda o `slug` nem apaga conquistas já concedidas. Novas regras exigem migration e teste, embora novas definições e famílias possam ser cadastradas sem alterar os prêmios existentes. Os nomes **Amazind** e **Ominius** foram mantidos como escritos no pedido; a grafia de exibição pode ser revisada antes do lançamento sem trocar os `slugs` depois de publicados.

### Detalhes que evitam interpretações diferentes

- **Ace Spirit**: comparar o contador de mortes no início e no fim de cada tela; não exigir uma partida inteira sem mortes.
- **Noob**: contar apenas Game Over verdadeiro, não abandono pela opção “End run”, recarga da página ou queda de conexão. Uma partida conta uma vez pelo seu `run_id`.
- **King**: o desempate usa exatamente a ordenação do leaderboard (`best_score` decrescente, `updated_at` crescente, `user_id` crescente). Um job diário registra o primeiro colocado de cada dia UTC; 30 registros consecutivos concedem a conquista. Dia sem registro por falha do job não deve inventar um vencedor: o sistema precisa executar uma recuperação baseada em histórico confiável ou marcar o período como indisponível.
- **Exclusivas**: a ordem é a hora em que o banco aceitou o evento de qualificação, não o relógio do navegador. Empates são resolvidos por um ID sequencial do banco. Uma conta apagada remove seu título e sua candidatura; a realocação do título ocorre numa transação. Se não houver candidato restante, a conquista fica vaga.
- **Família Circuit e First Light/Light Bringer**: a contagem começa na tela 1 de uma única partida autenticada. Qualquer morte invalida a tentativa sem mortes dessa partida, mesmo que o jogador continue e volte a completar telas. `cleared` conta telas concluídas, não a tela atual.
- **First Light e Neon Pioneer** podem ser obtidas pela mesma pessoa no mesmo evento de 50 telas sem mortes; são disputas independentes. **Light Bringer** é outra disputa, com alvo de 500.
- **Spark Starter** usa o saldo de pico antes da primeira morte, contando qualquer fonte de pontos. **Spark Keeper** usa o saldo de pico, mesmo com mortes anteriores; 100.000 não são pontos acumulados brutos.
- **Still Standing** mede `lastPenalty` realmente subtraído, e não apenas a penalidade nominal. Pela progressão 10, 20, 40…, o primeiro desconto nominal acima de 100.000 é 163.840 na 15ª morte; o saldo antes dela precisa ser maior que 100.000 para a conquista. Sobreviver à morte não é requisito adicional.
- **Tunnel Loop** conta uma travessia quando o jogador cruza a borda `x=0 ↔ x=27` em qualquer uma das duas linhas de túnel. Ir e voltar são duas travessias. Movimentos dos ecos não contam. O contador zera ao começar outra partida.
- **Família Phantom**: cada captura de eco conta uma vez, inclusive se o mesmo eco voltar da casa e for capturado novamente. Um segundo orbe inicia uma nova janela e zera o contador; capturas não se somam entre orbes. Alcançar 8 libera também os níveis 4–7 ainda não obtidos.
- **Phantom 5–8**: existem quatro ecos, mas um eco que volta da casa pode ficar assustado novamente enquanto o mesmo orbe ainda está ativo. A energia dura 14 segundos e a espera de reentrada é 0,35 segundo, para permitir capturas repetidas. O multiplicador de pontos dos ecos continua com seu teto atual; os níveis Phantom contam capturas, não pontos.

## Dados e segurança no Supabase

Implementado em `003_achievements.sql`:

1. `achievement_definitions(slug PRIMARY KEY, family_key, tier, badge_key, exclusive, active, sort_order)` define o catálogo. `family_key` agrupa Phantom, Circuit e Spark; `tier` ordena os níveis. Nome e descrição ficam nos arquivos de idioma do app por `slug`. As regras de concessão são código SQL revisado e versionado.
2. `player_achievements(user_id, slug, awarded_at)` guarda os títulos comuns, com chave única `(user_id, slug)`. `exclusive_holders(slug PRIMARY KEY, user_id, awarded_at)` guarda o titular exclusivo, com uma única linha possível por conquista. A função de concessão consulta `achievement_definitions.exclusive`. A leitura do perfil combina as duas tabelas.
3. `achievement_events(user_id, run_id, sequence, kind, payload, received_at)` recebe eventos com chave única `(user_id, run_id, sequence)`. `achievement_runs` mantém contadores por partida de telas, mortes, pico, túneis e capturas da energia atual. `noob_runs` guarda os Game Overs elegíveis de partidas distintas. A RPC aceita até 32 eventos por chamada e até 1.000 eventos por minuto por usuário; uma sequência com lacuna ou conteúdo conflitante é rejeitada.
4. `achievement_candidates(candidate_id, slug, user_id, qualified_at)` registra todos os qualificados às exclusivas, inclusive os que não ganharam. A ordenação estável por `candidate_id` permite transferir o título após exclusão de conta.
5. `leaderboard_daily_leaders(day_utc PRIMARY KEY, user_id, score, captured_at)` guarda o histórico necessário para King. A função `private.capture_daily_leader` lê o ranking e é idempotente por data. A migration `004_king_cron.sql` instala o job de banco para 23:59 UTC; requer a extensão Supabase Cron habilitada no projeto.
6. RLS permite ler catálogo ativo e as conquistas concedidas; dados privados de progresso e eventos não são acessíveis por tabelas REST. O cliente não faz `INSERT` direto em títulos, candidatos nem snapshots. `submit_achievement_events` deduplica, valida, atualiza contadores e concede títulos sob lock/transação. `my_achievement_candidates` mostra apenas a posição da conta autenticada. Um trigger realoca exclusivas após exclusão de usuário.

**Limite de confiança:** o jogo é Canvas 2D e funciona offline. Um navegador modificado pode fabricar eventos; validação de faixa, ordem, duração e limite de taxa reduz abuso simples, mas não comprova conquistas competitivas. Para exclusivas e King com valor competitivo, definir antes do lançamento se aceitamos essa confiança parcial ou se usaremos replay verificável/servidor autoritativo. O cliente nunca recebe a chave de serviço.

### Identidade dos checkpoints

Cada melhoria de score recebe um `submissionId` próprio para a RPC existente, enquanto o `run_id` continua agrupando a partida no cliente. Eventos de conquista usam `(user_id, run_id, sequence)` e uma fila offline separada que preserva telas, mortes, túneis e capturas. O Game Over de uma run autenticada é enfileirado mesmo com score zero, para contar Noob.

## Perfil e experiência

- Adicionar **Profile** à navegação para contas autenticadas. Para convidados, mostrar uma chamada simples para entrar com Google; não mostrar dados privados nem simular conquistas salvas.
- Cabeçalho com inicial como avatar, apelido, nome da conta Google, e-mail apenas para o dono, recorde do ranking e fase correspondente àquele recorde. Estado de carregamento, falta de conexão e dados em cache são distintos.
- Grade das 18 insígnias, agrupada por família e nível: obtidas coloridas com data; bloqueadas discretas com requisito. Exclusivas mostram o titular atual e a posição de candidato do próprio usuário, se houver. Não divulgar e-mail de outros jogadores.
- Ao atingir a regra durante a partida, tocar a fanfarra e mostrar imediatamente o popup animado, sem esperar o envio. O evento continua pendente até a validação no banco; a confirmação posterior não repete a celebração. Offline, o Perfil exibe “pending verification”. Conquistas exclusivas usam feedback otimista no jogo, mas a titularidade exibida no Perfil continua sendo a decisão do banco.
- Centralizar novos textos em `src/i18n/en.ts` e `src/i18n/pt-BR.ts` para manter os dois idiomas atuais.

## TODO de feedback de pontuação

- [x] Ao atingir uma conquista no jogo, tocar imediatamente uma fanfarra sintetizada e mostrar no canto um popup com a insígnia, nome e animação de vitória; a confirmação posterior do servidor não repete o popup. Múltiplas conquistas entram em sequência e respeitam `prefers-reduced-motion`.
- [x] Ao coletar energia, fruta ou capturar um eco, mostrar `+valor` subindo sobre o personagem por cerca de um segundo. Centelhas pequenas de 10 pontos não geram texto para preservar a leitura do labirinto.
- [ ] Ajustar valores, duração e paleta dos popups com teste de usabilidade em telas pequenas.

## Arquivos e ativação

1. Execute `003_achievements.sql` no Supabase após as migrations 001/002. Em seguida, habilite Supabase Cron e execute `004_king_cron.sql`.
2. Publique o frontend. `src/game/engine.ts` emite eventos sem chamar rede; `src/services/network.ts` mantém fila local por usuário e confirma concessões após resposta do banco. `src/achievements/catalog.ts` contém textos e SVGs originais; `src/main.ts` exibe o Perfil.
3. Confirme uma partida autenticada, uma conquista simples, a fila offline, e a leitura do Perfil. Teste exclusivas com contas de teste antes da corrida oficial, pois o primeiro evento aceito define o titular.
4. Acompanhe o histórico do job no painel Supabase Cron. Um dia sem snapshot não avança a sequência do King.

## Decisões de produto adotadas

1. **King:** 30 dias UTC consecutivos na liderança, com posse permanente depois da conquista. Um vencedor por mês não é exigido.
2. **Exclusivas:** First Light, Light Bringer e Neon Pioneer; o próximo candidato qualificado herda quando a conta titular é apagada.
3. **Phantom:** o mesmo eco pode voltar assustado durante o orbe atual; a energia dura 14 segundos e a reentrada após voltar à casa usa espera de 0,35 segundo. A captura continua sujeita ao limite de tempo conferido pelo banco.
4. **Confiança:** os eventos são validados por ordem, limites e conta autenticada, mas um cliente alterado ainda pode forjá-los. A implementação atual é adequada a um jogo casual; exclusivas de valor competitivo exigiriam replay verificável ou servidor autoritativo.
5. **Retroatividade:** começar a contar na data de ativação, sem atribuição pelas partidas antigas.
