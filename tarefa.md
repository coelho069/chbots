Refaça a aba "Grafo" da Memória do CH BOTS no estilo do Graph View do Obsidian (só como referência visual, código 100% nosso). Mostre o plano antes e espere meu OK.

1\) VISUAL:

\- Fundo escuro liso (#1e1e1e), nós como círculos pequenos e simples, linhas finas cinza semitransparentes.

\- Tamanho do nó proporcional ao número de ligações (mais conexões = nó maior).

\- O rótulo (texto) só aparece com zoom maior ou ao passar o mouse, com fade suave.

\- Cores por categoria (grupos), configuráveis.

\- Animação física contínua e suave (force-directed): os nós se repelem e as ligações puxam, e o grafo "respira" ao se mexer.


2\) INTERAÇÃO:

\- Passar o mouse num nó: ele e os vizinhos ficam acesos, e o resto escurece (dim).

\- Arrastar um nó: os vizinhos acompanham com física elástica.

\- Clicar: abre o fato no painel lateral. Duplo clique: centraliza e dá zoom.

\- Zoom com a roda do mouse e pan arrastando o fundo, suaves.



3\) PAINEL DE CONTROLES (engrenagem no canto, recolhível, como no Obsidian):

\- Filtros: busca por texto, mostrar órfãos (sem ligação), mostrar entidades, mostrar conflitos.

\- Grupos: criar grupo por consulta (ex.: categoria:Segurança) e escolher a cor.

\- Exibição: setas nas ligações, tamanho dos nós, espessura das linhas, limite de zoom para os rótulos (text fade threshold).

\- Forças: força central, repulsão, força das ligações, distância das ligações (sliders ao vivo).

\- Botão "Animar": mostra os fatos surgindo em ordem cronológica.



4\) GRAFO LOCAL:

\- No painel de um fato, um mini "grafo local" com só os vizinhos dele, com profundidade 1–3 configurável.



5\) DESEMPENHO:

\- Renderizar em Canvas/WebGL (react-force-graph-2d ou pixi.js), suave até 2.000 nós.

\- Simulação pausada quando estabiliza (economiza CPU); salvar as posições e as configurações no SQLite.



6\) TESTES: hover destaca só os vizinhos; um filtro de grupo muda as cores; o grafo local mostra a profundidade certa.

Depois aumente a versão (minor) e gere o .exe em build-out.

