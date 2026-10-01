# Neon Maze

Arcade web original, com TypeScript, Vite e Canvas 2D. Personagem em forma de seta, inimigos cristalinos (Trace, Veil, Flux e Drift), paleta neon e áudio sintetizado. Sem engine, fontes externas, imagens de terceiros ou downloads durante a partida.

## Rodar localmente

Requisitos: **Node.js 24** e **pnpm 11.19.0**. O lockfile está versionado.

```sh
npm install -g pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm dev
```

Abra `http://127.0.0.1:5173`. Não é necessário configurar Supabase para jogar como convidado. Para habilitar contas, copie `.env.example` para `.env` e preencha as duas variáveis públicas. Reinicie o servidor depois de alterar o arquivo.

```sh
pnpm check                 # TypeScript + Vitest (inclui 1.200 seeds e PostgreSQL)
pnpm build                 # dist/ + manifest + service worker
pnpm preview               # versão de produção em http://127.0.0.1:4173
pnpm exec playwright install chromium
pnpm test:browser          # usa o build existente; inclui reload sem rede
```

No ambiente Windows do Codex, se os shims de pnpm não forem encontrados, os equivalentes são `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vitest/vitest.mjs run` e `node node_modules/vite/bin/vite.js build`.

## Jogar

- Setas ou WASD; uma curva antecipada fica no buffer até uma interseção válida. Teclas remapeáveis em Settings, com dois bindings por direção e detecção de conflito. P/Escape pausam.
- Controle padrão da Gamepad API: direcional ou analógico esquerdo, Start para pausar; deadzone de 0,35. Ativação e status em Settings. Pressione um botão do controle para o navegador disponibilizá-lo.
- Swipe sobre o Canvas com `@use-gesture/vanilla`; botão de pausa no rodapé do tabuleiro.
- Três vidas. Centelhas: 10 pontos; energia: 50; capturas consecutivas: 200, 400, 800, 1.600. Frutas aos 70 e 170 itens coletados: `min(100 × fase, 1.000)`, disponíveis por 12 segundos.
- A velocidade cresce até um limite. A energia dura menos nas fases avançadas. Perseguição/dispersão alternam; o ciclo pausa durante o modo assustado. Olhos voltam à casa antes de o inimigo sair novamente.
- Ao perder foco ou ocultar a aba, a partida pausa. O tempo submetido é tempo ativo de simulação, sem pausa, introduções ou tela de morte.

## Arquitetura

| Arquivo | Responsabilidade |
| --- | --- |
| `src/game/maze.ts` | Gerador simétrico 28×31, flood fill e validações |
| `src/game/engine.ts` | Simulação independente do DOM, passo fixo de 1/60 s |
| `src/game/pathfinding.ts` | BFS e alvos das quatro personalidades |
| `src/game/renderer.ts` | Canvas, geometria original e cache de paredes |
| `src/services/controls.ts` | Teclado, Gamepad API e swipe |
| `src/services/audio.ts` | Web Audio, envelopes e sirene |
| `src/services/storage.ts` | Configurações, recorde e fallback em memória |
| `src/services/network.ts` | Google Auth, perfil, ranking e fila por usuário |
| `src/i18n/en.ts` | Textos da interface em inglês, centralizados |
| `supabase/migrations/001_neon_maze.sql` | Tabelas, índices, RLS e RPCs |
| `.github/workflows/deploy.yml` | Testes, build e publicação no Cloudflare Pages |
| `.github/workflows/supabase-keepalive.yml` | Leitura semanal do banco |

### Geração de labirintos

O algoritmo cria uma malha apenas na metade esquerda, embaralha arestas com um PRNG determinístico e remove arestas preservando grau mínimo dois e conectividade. Corredores de um tile conectam as duas metades; a metade direita é o espelho exato. Duas linhas de túnel têm wrap horizontal e quatro aberturas. A casa central é uma galeria de um tile com duas portas; **nem mesmo seu interior contém um bloco livre 2×2**. Somente inimigos saindo da casa ou voltando como olhos atravessam as portas.

Depois de cada geração, uma validação em tiles verifica conectividade dos corredores e da casa, ausência de 2×2, ausência de becos com profundidade maior que um, simetria, túneis, pontos alcançáveis e quatro energias distantes da casa, uma por quadrante. Se falhar, tenta outra seed até 64 vezes. Os becos curtos são permitidos pelo validador; o gerador atual tende a produzir circuitos sem becos. As fases usam `seedInicial + (fase - 1) × 7919`.

O teste de 1.200 seeds faz também suas próprias verificações de tiles, cobertura integral de pickups, limites fechados, portas e variedade de layouts. Os testes de simulação cobrem túneis, movimento, buffer, pausa, energia, morte, frutas, BFS e progressão.

### Offline e dados

O service worker do `vite-plugin-pwa` faz precache do HTML, JS, CSS, ícones e manifesto. **A primeira visita deve ocorrer com internet**, até aparecer “READY TO PLAY OFFLINE”. Depois o app instalado ou a URL já visitada pode ser reaberto sem rede. O modo de desenvolvimento não instala service worker; valide offline com o build de produção. Atualizações aguardam o fechamento das abas para não interromper partidas. Não há cache de respostas de autenticação ou banco.

O localStorage mantém configurações, recorde local, sessão do Supabase, apelido, último top 20 e uma melhor partida pendente por conta. Se storage estiver indisponível, o jogo funciona com memória temporária e avisa sobre a falta de persistência.

**Convidados nunca enfileiram nem submetem pontos**, mesmo se fizerem login depois. “Play as guest” continua sendo local mesmo quando há uma sessão. O dono de uma partida autenticada é capturado ao iniciá-la; trocar de conta não transfere sua fila. A fila pendente só é enviada com a mesma conta autenticada.

Envios ocorrem somente no fim da partida, abertura do ranking, login/restauração de sessão e evento `online`. Falhas de rede, rate limit e falta de apelido preservam a fila; rejeições permanentes de plausibilidade não são reenviadas, mas o recorde local fica salvo. Reenvios da mesma partida são idempotentes por até 30 dias. Não há polling, Realtime ou envio por ponto coletado. O SDK pode renovar tokens de sessão independentemente desses eventos; isso não envia pontuações.

## Configurar Supabase e Google OAuth

1. Crie um projeto no Supabase, escolha a região e guarde a senha do banco fora do repositório.
2. Em **SQL Editor**, execute todo o arquivo `supabase/migrations/001_neon_maze.sql` uma vez. Alternativamente, use migrations pela CLI do Supabase. Ele cria `profiles`, `scores` e uma tabela privada de recibos para idempotência/rate limit.
3. Em **Project Settings → API**, copie a URL `https://SEU_PROJECT_REF.supabase.co` e a **publishable key** (ou chave legada `anon`). Nunca use `service_role`, secret key, senha do banco ou segredo do Google no frontend.
4. No Google Cloud Console, selecione/crie um projeto. Configure a tela de consentimento OAuth (nome, contatos e público); enquanto estiver em Testing, adicione os usuários de teste.
5. Crie um **OAuth client ID → Web application**. Em *Authorized JavaScript origins*, adicione a origem de produção, por exemplo `https://neon-maze.pages.dev`, e a origem local usada (`http://127.0.0.1:5173`). Em *Authorized redirect URIs*, adicione **exatamente** `https://SEU_PROJECT_REF.supabase.co/auth/v1/callback`.
6. Em **Supabase → Authentication → Sign In / Providers → Google**, habilite o provider e cole o Client ID e Client Secret do Google. O Client Secret fica somente no Supabase.
7. Em **Authentication → URL Configuration**, defina a Site URL de produção. Adicione as Redirect URLs `https://neon-maze.pages.dev/`, `http://127.0.0.1:5173/` e `http://127.0.0.1:4173/`. Se usar `localhost`, cadastre também essa origem separadamente. Inclua seu domínio customizado se houver.
8. Preencha `.env` localmente. No GitHub, salve os mesmos valores como secrets `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Ambos entram no bundle e são públicos por definição; a segurança está na RLS/RPC.
9. Teste “Sign in with Google”. O retorno OAuth usa PKCE gerenciado pelo SDK. No primeiro login, escolha um apelido único de 3–12 caracteres ASCII: letras, números ou `_`. A unicidade ignora maiúsculas/minúsculas. O apelido é imutável nesta versão.
10. Termine uma partida autenticada, abra o ranking e verifique uma única linha em `scores`. Uma partida pior não substitui o recorde. Teste outra conta e uma sessão de convidado.

Referências oficiais: [Google no Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google), [OAuth no SDK JavaScript](https://supabase.com/docs/reference/javascript/auth-signinwithoauth), [funções de banco e security definer](https://supabase.com/docs/guides/database/functions).

### Regras do backend

`profiles(user_id, nickname UNIQUE)` e `scores(user_id, best_score, level_reached, updated_at)` aceitam SELECT público via RLS. INSERT, UPDATE e DELETE diretos são revogados. `claim_nickname` é a única escrita de perfil. `submit_score` é a única escrita de ranking; ambas são `SECURITY DEFINER`, têm `search_path = ''` e execução limitada a `authenticated`.

`submit_score` deriva a identidade de `auth.uid()` (não recebe user_id), exige perfil, números válidos, múltiplos de 10, fase 1–999 e score ≤ 25.000 × fase. A duração ativa mínima é `max(1.000 ms, score ms, (fase−1) × 8.000 ms)` e a máxima é sete dias. Até cinco partidas novas por minuto por usuário; um advisory lock serializa chamadas simultâneas. Recibos duplicados retornam o recorde sem consumir nova cota. Pontuações menores preservam tanto o melhor score quanto a fase associada. No empate, a maior fase vence.

**Limite de segurança:** o cliente offline informa score e duração. Esses limites barram valores absurdos e abuso simples, mas não provam uma partida legítima contra um cliente adulterado. Um ranking competitivo com garantia forte exigiria replay verificável ou servidor autoritativo. Não há segredo no navegador que resolva isso. Os testes usam PostgreSQL embarcado (PGlite) e simulam apenas `auth.users`, `auth.uid()` e as roles; o fluxo OAuth real exige as contas configuradas.

## Publicar no Cloudflare Pages por GitHub Actions

1. Crie um repositório GitHub e envie esta pasta para a branch `main` (incluindo `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `public/` e `.github/`; exclua `.env`, `node_modules/` e `dist/`). Se usar token pessoal para enviar workflows, conceda o escopo/permissão de workflows apropriado.
2. No Cloudflare, crie um projeto **Pages → Direct Upload** com nome, por exemplo, `neon-maze`. O upload será feito pela Action; não é preciso conectar também o Git Integration do Pages.
3. Crie um API token Cloudflare com **Account → Cloudflare Pages → Edit**, restrito à conta correta. Copie também o Account ID.
4. No GitHub, abra **Settings → Secrets and variables → Actions** e crie:

   | Tipo | Nome | Valor |
   | --- | --- | --- |
   | Secret | `CLOUDFLARE_API_TOKEN` | Token de publicação Pages |
   | Secret | `CLOUDFLARE_ACCOUNT_ID` | ID da conta Cloudflare |
   | Secret | `VITE_SUPABASE_URL` | URL pública do projeto Supabase |
   | Secret | `VITE_SUPABASE_ANON_KEY` | Publishable key ou chave anon |
   | Variable | `CLOUDFLARE_PAGES_PROJECT` | Nome exato do projeto Pages |

5. Crie o GitHub Environment `production` (opcionalmente, configure aprovação humana de deploy). Deixe os dois secrets do Supabase no nível do repositório: o job `verify` e o keepalive também precisam deles.
6. Faça push para `main` ou execute **Actions → Verify and deploy Neon Maze → Run workflow**. Pull requests executam validação, mas não publicam nem recebem credenciais de produção em forks.
7. O CI instala com lockfile congelado, verifica TypeScript, roda Vitest (1.200 seeds + banco), compila, testa Chromium incluindo modo offline e publica **o mesmo artefato** com `wrangler pages deploy`. O URL de deploy aparece nos logs do Wrangler.
8. Abra `https://NOME_DO_PROJETO.pages.dev`, atualize os redirect URLs do Supabase/Google para esse domínio e teste o fluxo completo. Sem os secrets Supabase, o bundle continua funcionando no modo convidado.
9. Para reverter, promova um deploy anterior no painel Pages ou reverta o commit e rode o workflow novamente. O service worker mantém uma versão consistente até o usuário fechar as abas antigas.

Referência oficial: [Direct Upload por CI no Cloudflare Pages](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

### Atividade semanal do Supabase

`supabase-keepalive.yml` faz uma leitura real da tabela de scores toda segunda-feira às **09:17 UTC / 06:17 em São Paulo**, usando apenas a chave pública. Pode ser disparado manualmente e falha visivelmente se o projeto ou segredo estiver indisponível.

Isso é uma medida de atividade **best effort**, não uma garantia de que o plano Free nunca será pausado. O Supabase avalia baixa atividade em janelas de sete dias; o agendador do GitHub pode atrasar ou desativar schedules em repositórios inativos. Uma consulta semanal não constitui garantia de disponibilidade. Se o projeto pausar, restaure pelo painel; o jogo offline continua funcionando. [Política oficial de pausa do Supabase](https://supabase.com/docs/guides/platform/free-project-pausing).

## Checklist de aceitação

- [ ] `pnpm check`, `pnpm build` e `pnpm test:browser` passam na máquina/CI.
- [ ] As cinco telas abrem em desktop e celular; nenhum recurso de gameplay depende da rede.
- [ ] Remapeamento, volume, mudo e recorde sobrevivem ao reload.
- [ ] Após cache inicial, desconectar a rede e recarregar mantém uma partida jogável.
- [ ] Um convidado não gera linhas no banco, inclusive após login posterior.
- [ ] Apelido duplicado, escrita REST direta e score implausível são rejeitados.
- [ ] Melhor partida offline autenticada sincroniza ao voltar a ficar online com a mesma conta.
- [ ] OAuth funciona no domínio de produção e o ranking destaca a conta atual no top 20.
- [ ] Gamepad físico e gestos foram conferidos nos dispositivos alvo.

Os PNGs de instalação são originais e versionados. `scripts/create-icons.py` os reproduz com Pillow, apenas se quiser editar a marca; Python não faz parte do build ou runtime do jogo.
