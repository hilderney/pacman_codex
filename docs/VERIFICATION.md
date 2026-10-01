# Verificação da entrega

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
