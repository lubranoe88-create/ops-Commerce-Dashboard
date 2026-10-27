# Riferimenti visuali pubblici (stile ops / Palantir-like)

**Policy:** nessun asset proprietario scaricato o ridistribuito. Solo **link pubblici** da aprire nel browser per vedere screenshot/demo. Usare come ispirazione di pattern, non come copia.

Creato: 2026-10-27 (Europe/Berlin).

---

## A. Documentazione ufficiale Palantir (Foundry / Workshop / Map)

Apri queste pagine: le immagini di esempio sono embeddati nei docs pubblici.

| Tema | Link | Cosa guardare |
|---|---|---|
| Map widget Workshop | https://palantir.com/docs/foundry/workshop/widgets-map/ | Layer base/object/overlay, legenda, COP geospatial |
| Map Legacy (layer types) | https://palantir.com/docs/foundry/workshop/widgets-map-legacy/ | Screenshot clustering, choropleth, line, colori |
| Visualization widgets | https://www.palantir.com/docs/foundry/workshop/widgets-visualization | Metric card, map, XY, Gantt, timeline |
| Example apps / COP | https://palantir.com/docs/foundry/workshop/example-applications/ | Common Operating Picture: metriche + mappa + tabella |
| COP geospatial build guide | https://build.palantir.com/platform/266edc4b-05f6-46ed-b724-65aa8453ce02 | Layout COP: Map + Metric Card + Object Table + Filter |
| Geo-marker su Map | https://build.palantir.com/platform/11700725-7f6a-40f5-8de0-45a242ccbff2 | Pin scalati, colori per stato, supply-chain example |
| Dark mode Carbon/Foundry | https://palantir.com/docs/foundry/carbon/dark-mode/ | Tema scuro organizzativo |
| Slate Map layers | https://www.palantir.com/docs/foundry/slate/widgets-visualization | Heatmap, heat grid, choropleth, dark/satellite tiles |
| Gaia + Ontology | https://palantir.com/docs/foundry/geospatial/add-ontology-data-to-gaia/ | Pannello data sources a sinistra, layer, filtri spazio/tempo |
| Blog Gaia collaboration | https://blog.palantir.com/frontend-engineering-at-palantir-redefining-real-time-map-collaboration-8845ebb928d1 | Contesto Gotham/Gaia + immagini di prodotto pubbliche sul blog |

Community (screenshot UI map selection):

- https://community.palantir.com/t/is-there-a-reference-variable-for-the-active-object-selected-on-a-map/486

SDK esempio Gaia (codice pubblico, non screenshot prodotto completo):

- https://github.com/palantir/defense-sdk-examples

---

## B. Figura pubblica brevetto (mappa interattiva + heatmap)

Documento USPTO/pubblicazione Palantir su interactive data object map (figure heatmap/selezione — **pubblico**:

- https://www.freepatentsonline.com/y2014/0337772.html  
  Cercare nel testo le figure 5A–5D (heatmap su mappa, radius/opacity).

Alternativa Google Patents (stessa famiglia, spesso con figure rese):

- Ricerca: `INTERACTIVE DATA OBJECT MAP Palantir` su https://patents.google.com/

---

## C. Riferimenti open (stile dark / choropleth / heatmap / network) — riusabili come pattern

Questi **non** sono Palantir; servono a vedere lo stesso *tipo* di viz in dark/ops senza IP Palantir.

| Tipo | Link | Nota |
|---|---|---|
| Choropleth mondo (globe) | https://github.com/vasturiano/react-globe.gl/blob/master/example/choropleth-countries/index.html | Esempio country choropleth |
| Demo live globe.gl | https://vasturiano.github.io/globe.gl/example/choropleth/ | Aprire in browser |
| Dark choropleth lib | https://github.com/amoradi/atlas | WebGPU map dark + choropleth |
| Heatmap + graph dark dashboard | https://developer.nvidia.com/blog/build-a-fully-interactive-dashboard-in-a-few-lines-of-python/ | cuxfilter: heatmap, graph, dark theme |
| Network + geo graph gist | Collegato nel post NVIDIA / RAPIDS cuxfilter tutorial | Layout COP-like |
| Dashboard dark + world choropleth | https://github.com/abhishekhsingh/goatcounter-dashboard | Dark default + mappa paesi |
| Heatmap / choropleth D3 example stack | https://github.com/resurector/chicago-crime-graph | Choropleth + heatmap matrix |

Tile base open (per riprodurre dark/satellite *senza* asset Palantir):

- CARTO Dark Matter: https://carto.com/basemaps  
- OpenStreetMap: https://www.openstreetmap.org  
- Satellite open (es. Esri World Imagery termini d’uso da verificare): documentazione Esri basemaps

---

## D. Mapping rapido → nostro dashboard

| Pattern visto nei riferimenti | Uso nostro |
|---|---|
| COP: metriche + mappa + tabella | Top-25 / score / alert |
| Choropleth macro-aree | Revenue / fallimenti per regione |
| Heatmap densità | Bottleneck e anomalie |
| Layer on/off | Revenue · failure · supply · post-verifica |
| Network/graph | Holding, filiere, neural links |
| Dark base tiles | Tema ops (tile open, non branding Palantir) |

**Spec completa:** **globo 3D** satellitare dark + overlay ops — `docs/map-module-design.md` (design only, UI non costruita).

---

## Cosa *non* è in questo workspace

- Nessuna immagine `.png`/`.jpg` Palantir salvata localmente (evita redistribuzione di asset proprietari).
- Per vedere lo stile: aprire i link della sezione A–C.

File salvato: `docs/palantir-visual-references.md`
