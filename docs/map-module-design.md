# Modulo 1 — Globo 3D operativo (solo design, niente UI)

Stato: **spec**. Non implementare ancora l’interfaccia olografica.

**Modulo 2** (grafo **3D** pipeline 17 piste): `docs/pipeline-graph-module-design.md`.  
**Modulo 3** (memoria grafo 5D): `docs/memory-graph-module-design.md`.  
**Modulo 4** (chat + voce): `docs/chat-module-design.md`.

Riferimenti ispirazione (link pubblici, non asset da copiare): `docs/palantir-visual-references.md`.

Target estetico: **~99% feeling** di dashboard ops dark military-style (Foundry/Gotham COP) — densità, contrasto, layer, glow — **senza** clonare branding, icone, tile o layout pixel-perfect Palantir.

---

## Forma primaria: globo 3D (non mappa piatta)

| Requisito | Specifica |
|---|---|
| Geometria | **Globo 3D ruotabile** (sfera), non planisfero 2D di default |
| Interazione | Drag per orbit/rotate, pinch/scroll zoom, inertia leggera; click-drag non deve “lanciare” la camera in modo arcade |
| Proiezione | Vista prospettica; occlusione emisfero posteriore (no wireframe che attraversa la Terra) |
| Orientamento | Nord “su” come default al reset; bottone **Reset view** |
| Atmosfera | Alone atmosferico sottile (blu/ciano molto debole) per leggerezza tech, non sci-fi eccessivo |
| Fallback | Solo se WebGL assente: avviso + eventuale 2D dark satellite — **non** è il target di prodotto |

Librerie candidate *future* (non installate ora): es. globe.gl / Cesium / MapLibre + globe — da valutare in implementazione.

---

## Base layer (obbligatorio)

| Requisito | Specifica |
|---|---|
| Tipo | **Imagery satellitare** avvolta sul globo — **non** bianco/blank, non solo oceano flat |
| Tema | **Dark military/ops**: satellitare tone-mapped (luminosità abbassata, neri profondi, continenti leggibili) |
| Oceani | Scuri, leggermente più bassi di contrasto dei continenti |
| Attribuzione | Credit tile discreto; provider con licenza chiara |

---

## Overlay tecnologici (stile ops dark)

1. **Bordi macro-area** — stroke **ciano/blu luminoso** sottilissimo (≈1px screen-space), glow soft; confini regione/continente/zone, non fill opachi.
2. **Choropleth intensità** — fill poligoni su sfera da **grigio scuro** → **verde brillante** (revenue verificato); canale **rosso** per stress/failure (toggle o dual scale).
3. **Punti glow** — top business verificati: alone ciano/verde, size ∝ rank/score; depth-fade oltre l’orizzonte.
4. **Link pulse** — archi **grandi cerchi** (great-circle) tra business correlati; pulse opacità lento; solo link ad alta confidenza (memoria / filiera).
5. **Legenda minimale** — floating compatto angolo basso: scala choropleth + 3 glyph (punto, arco, bordo); niente card stack.
6. **Selezione** — click punto/regione: highlight bordo ciano + pan/orbit soft verso target; pannello dettaglio laterale (fuori globo); layer toggles: Revenue · Failure · Supply · Post-verifica.

---

## Layout COP (dashboard)

```
[ Metric strip ops: top-25 | anomalie | bottleneck | consistency ]
[ Layer toggles ]     [ GLOBO 3D SATELLITARE DARK + overlay ]     [ Selection detail ]
                      [ Legenda minimale ]
```

Chrome UI: scuro, hairline, tipografia densa, zero clutter hero — feeling “sala operativa”, non marketing.

---

## Layer logici

| Layer | Contenuto | Default |
|---|---|---|
| `globe-satellite-dark` | Texture satellitare dark | On |
| `atmosphere` | Glow atmosfera | On |
| `macro-borders-cyan` | Confini luminosi | On |
| `choropleth-revenue` | Grigio→verde | On |
| `choropleth-stress` | Rosso stress | Toggle |
| `top-business-points` | Glow points | On |
| `relation-arcs-pulse` | Great-circle pulse | On (peso min.) |
| `supply-bottlenecks` | Highlight corridoi / heat su arco | Toggle |

---

## Fedeltà “99% feeling” — checklist (senza copia IP)

- [ ] Sfera full-bleed dominante nel viewport operativo  
- [ ] Satellite scurito, mai bianco  
- [ ] Ciano tecnico su bordi/selezione  
- [ ] Choropleth sobrio + punti glow + pochi archi pulse  
- [ ] Metric strip + dettaglio selezione (COP)  
- [ ] Legenda minima, layer toggles  
- [ ] Nessun logo/icon set/tile Palantir  

---

## Cosa non fare

- Mappa 2D piatta come default  
- Sfondo bianco / oceano vuoto senza imagery  
- Copia UI o asset Palantir  
- Troppi archi (spaghetti) o pin non verificati  
- Animazioni neon/arcade che rompono il tono militare-ops  
- Usare OpenRouter per il render (viz meccanica)

---

## Pipeline dati

- Choropleth / punti ← daily tops, consistency, score preliminare (PyOD)  
- Archi pulse ← neural links / holding / supply  
- Stress rosso ← failure + bottleneck  
- OpenBusiness deepen ← **solo** dopo selezione di business revenue-verified  

### Correzioni prodotto (vedi `docs/corrections-and-coverage-design.md`)

1. **Correzione utente sulla top** — Correct/Incorrect + una riga; regola meccanica immediata in SQLite (niente attesa AI). I punti sul globo rispettano le regole attive (nascondi/penalizza).  
2. **Soglie di verifica** — filing annuale forte = standalone; news di settore = serve corroborazione. Solo candidati che passano le soglie diventano glow points “verified”.  
3. **Trasparenza copertura** — per ogni macro-area (e settore se mappato): `coverage_degree` dichiarato su mappa (layer/etichetta + legenda), così non si assume completezza mondiale.

---

## Implementazione futura (non ora)

1. Scelta engine globo 3D + tile satellitare dark  
2. Proiezione GeoJSON → mesh/poligoni su sfera  
3. Binding SQLite / job notturno  
4. Performance: clustering punti oltre N, LOD archi  

**Niente build UI in questo passo.**
