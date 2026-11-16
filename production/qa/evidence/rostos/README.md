# Evidência — rostos de mulheres e crianças (branch `fix/rostos-criancas-mulheres`)

Capturas da cena «Os Cativos» (`node /tmp/audit/faces2.mjs`: câmara na cabeça, personagem congelada em pose de pé / agachada / de perfil).

- `crianca-rapariga-*`, `crianca-rapaz-*`, `mulher-*`: de pé, de perfil e agachadas. O rapaz usa o corpo masculino; a rapariga o feminino com rosto emprestado.
- `ancião-*`, `homem-*`: homens. `ancião-de-pe` é **idêntico pixel a pixel** ao da `main` (0 píxeis diferentes); `homem-antes-depois.png` põe lado a lado a `main` (esquerda) e esta branch (direita): o homem é o mesmo (as diferenças de píxeis vêm da criança que está ao lado, que mudou de rapariga para rapaz, e da sua sombra).
- Prova exacta de que os homens não mudaram: os 3 testes de impressão digital de `tests/faces.test.mjs` (geometria, ossos e materiais).
- Pescoço: o rosto de pele corta-se à linha do maxilar (y ≥ 1,585); abaixo, a textura é a da roupa (daí a mancha escura) e fica o pescoço pintado do manequim, com a mesma cor da pele.
- O colarinho claro visível nos homens e no rapaz (corpo masculino) já existe na `main`; não faz parte desta correção.
