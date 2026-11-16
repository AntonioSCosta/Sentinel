# Viriato — instruções para uma sessão de playtest (30–45 min)

Versão testada: branch `feat/pr10-campaign-quality` (PR #11, aberto e por integrar), construída sobre o commit `a632dc7` mais a correção final do texto «Objetivo» e a atualização com `main`; o último commit da branch é a referência exata. O PR #10 já está integrado em `main`.

## Antes de a sessão começar (moderador, 5 min)

1. Computador com **teclado e rato** (o jogo 3D não tem controlo por toque) e Chrome atualizado. Resoluções verificadas no menu e no mapa (Chrome real, via Playwright): 1366×768, 1280×800, 1024×600 e 844×390 (o menu também a 1920×1080). Não há garantia para outros equipamentos ou navegadores; um ecrã maior é sempre preferível.
2. Abrir o jogo **por um servidor**, não por duplo clique no `index.html` (módulos ES não correm em `file://`):
   - Windows: duplo clique em `run_game.bat` (corre `python -m http.server 8000`), depois abrir `http://localhost:8000`.
   - Qualquer sistema: na pasta do projeto, `python3 -m http.server 8000`.
3. Experimentar 1 minuto antes: o menu deve mostrar «COMEÇAR» (deixa de dizer «A CARREGAR…»). Se o jogo andar aos soluços, escolher **GRÁFICOS: Baixa** no menu.
4. O `/favicon.ico` dá 404 na consola. É inofensivo.

## O que dizer ao jogador (e o que não dizer)

Dizer: «Vais jogar uma campanha curta sobre Viriato. Pensa em voz alta. Não te vou ajudar; se ficares preso, diz-me e eu só tomo nota.»
Não dizer: como se ganha, o que fazem os botões do mapa (o botão «Objetivo» explica-o; interessa ver se o encontram), nem os controlos (o menu tem a lista; interessa ver se a leem).

O menu tem dois botões grandes. **«COMEÇAR» inicia só o capítulo escolhido (por defeito o Prólogo, isolado). A experiência a testar é «CAMPANHA — Um Ano de Guerra».** Pedir ao jogador que a escolha sozinho e registar se hesitou.

## Roteiro da sessão

| Min | O que se espera | O que observar |
|---|---|---|
| 0–2 | Menu, controlos, **CAMPANHA** | Encontrou o botão? Leu os controlos? |
| 2–5 | Prólogo: diálogo (~17 s), fuga ao fumo (~10 s), epílogo (~14 s) | Percebeu o objetivo («Foge… até ao fumo»)? Morreu? |
| 5–15 | Mapa: marchar, acampar, esperar na estrada, reconhecer, Objetivo, Lugares, Relatos | Percebe o que fazer? Abre «Objetivo»? Percebe Homens/Comida/Armas/Fama? |
| 15–35 | Encontros e batalhas em 3D (a 1.ª costuma ser «Os Cativos», por volta do dia 10) | Controlos de combate, escudo, G (retirada), clareza do painel de batalha |
| 35–45 | Mais dias/batalhas, ou fim do ano | Voltou ao mapa depois da batalha? Percebeu o resultado? |

A campanha completa (um ano, 245 dias) pode não caber em 45 min. Não é preciso acabá-la.

## Voltar ao início da campanha

- **Pelo menu:** ESC no mapa abre o menu; clicar **«CAMPANHA — Um Ano de Guerra»**; como há uma campanha a meio, aparece «Há uma campanha a meio…»; **«Começar de novo»** apaga-a e recomeça no prólogo. «Voltar» não apaga nada.
- **Limpeza total (entre jogadores):** na consola do Chrome (F12), `localStorage.removeItem('viriato.campaign')` e recarregar. Para limpar também os gráficos escolhidos: `localStorage.clear()`.
- **Retomar:** «Continuar campanha» no menu volta ao mapa onde ficou; recarregar a página a meio de uma batalha devolve o painel dessa batalha (a batalha recomeça).
- Cada campanha nova repete o prólogo (~1 min). Em abertura/epílogo, ENTER salta (indicação do próprio jogo).

## Atalhos só para o moderador

- `http://localhost:8000/?scene=emboscada` (ou `cativos`, `acampamento`, `prologo`) abre direto um capítulo isolado.
- Capítulos isolados também se escolhem no menu (CAPÍTULO) + COMEÇAR.

## Estado conhecido (não corrigir durante a sessão; só anotar)

Já resolvido nesta versão: «COMEÇAR» e «CAMPANHA» ficam sempre à vista, sem rolar, nas resoluções acima (rodapé fixo do menu); o «ENTER para saltar» não fica no mapa; o botão «Objetivo» do mapa explica vitória, derrota, recursos e primeiros dias; a barra de baixo do mapa cabe em ecrãs estreitos.

1. Capítulo III (Acampamento): começa dentro do campo inimigo e, parado e de pé, Viriato morre em ~20 s. É intencional (infiltração). O texto do painel de batalha diz para agachar (C) e avançar pelo mato. Anotar se o jogador percebe isto sem ajuda.
2. No prólogo, parado, Viriato morre e a cena reinicia sozinha.
3. Abaixo de 900 px de largura a dica de texto da barra de baixo do mapa fica escondida (incluindo a do modo «Reconhecer»; o botão fica marcado e o círculo aparece no mapa).
4. Não foi feito nenhum playtest com pessoas; o que está acima vem de testes automáticos e de verificação técnica.

## Registo sugerido por jogador

Hora de início/fim, ecrã/resolução, GPU/fps percebido, onde hesitou, onde morreu, o que não percebeu, citações, e se acabaria a campanha por vontade própria.
