# Verificação da entrega

## Revisão das regras — 2 de outubro de 2026

- **37 testes Vitest passaram**, além de TypeScript e build PWA.
- **1.200 seeds** passam pelas regras novas: toda parede interna toca um caminho; componentes de parede, incluindo curvas/ramificações e a casa, têm no máximo 8 tiles; nenhum beco nem região ligada por uma ponte; simetria, túneis, conectividade, pickups e ausência de caminhos 2×2 preservados.
- Casos específicos reproduzem os três problemas marcados na imagem: massa de parede, parede em L longa e volta com uma única entrada.
- Simulação: penalidades 10/20/40/80, sobrevivência além de três mortes, Game Over somente ao zerar em uma morte, preservação do pico, reinício de contadores, mortes mantidas entre telas, contador de telas vencidas e avanço além de 999.
- Velocidade: curva linear, 2× na tela 100, continuação sem teto artificial e coleta/colisões corretas em velocidades altas por subpassos adaptativos.
- A migration `002_endless_runs.sql` foi aplicada sobre `001` no PostgreSQL embarcado dos testes; remove os antigos tetos de 999 telas/sete dias e ajusta os limites de duração à velocidade. Nenhuma migration foi aplicada a um Supabase remoto.
- Build de produção atualizado e nova interface conferida no navegador. A PWA antiga foi substituída no cache da prévia.
- Partida no navegador encerrou com saldo zero, três mortes e pico de 50; voltar ao início reiniciou os contadores e a próxima penalidade em 10. Console sem erros. Evidência visual em `maze-rules-v2.png`.
- Interpretações adotadas: vizinhança pelos quatro lados; moldura externa isenta dos limites de paredes; recorde/ranking usam o maior saldo da partida, porque seu saldo final é zero.

## Verificação inicial — 1 de outubro de 2026

Verificado localmente em 1 de outubro de 2026.

- TypeScript: `tsc --noEmit` passou.
- Vitest: 22 testes de labirinto, simulação, storage e PostgreSQL passaram; em seguida passaram os 6 testes adicionais de sincronização (28 no total).
- Labirinto: 1.200 seeds, mais seeds de borda, verificados com invariantes independentes; teste de determinismo e rejeição de topologias inválidas.
- Banco: migration real executada em PostgreSQL embarcado via PGlite; autenticação/roles do Supabase simuladas. Leitura pública, proibição de escrita direta, unicidade de apelido, plausibilidade, idempotência, preservação do recorde e rate limit testados.
- Rede: convidado não envia, conta não recebe fila de outra conta, falha mantém pendência, sincronizações concorrentes se agrupam e uma partida melhor não é apagada por resposta anterior.
- Build de produção: passou; `dist/sw.js` e manifesto gerados, 11 entradas no precache.
- Navegador: início de partida, pontuação, morte, Game Over, pausa por teclado, configurações, remapeamento persistido após reload e ranking indisponível conferidos.
- PWA: aguardou “READY TO PLAY OFFLINE”, desligou o servidor de produção, recarregou pelo service worker e iniciou partida que pontuou sem o servidor. O servidor foi reiniciado ao terminar o teste. Isso verifica o cache do app; não altera a conexão global do computador.
- Responsividade: visual conferido a 390×844, inclusive tela de Game Over. Evidência em `mobile.png` e `desktop.png`.
- Os três testes Playwright de CI foram escritos e descobertos com `playwright test --list`. Sua execução automatizada completa fica para `pnpm test:browser`/GitHub Actions; a inspeção local do navegador foi realizada pelas ferramentas do app.

## Dependências externas pendentes

OAuth Google real, envio ao Supabase hospedado, execução do GitHub Actions e deploy Cloudflare não foram executados: o projeto/destino e seus secrets ainda não foram fornecidos. O README contém o procedimento completo. A presença de uma sessão do GitHub CLI não configura automaticamente Supabase ou Cloudflare.

O status da Gamepad API foi observado na interface, mas não houve teste físico dirigido de todos os botões. O teste de swipe por eventos de toque está no teste de navegador do CI; recomenda-se também confirmar o gesto em um aparelho alvo.
