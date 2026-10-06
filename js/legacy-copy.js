// Product-authored interface copy catalogue (ES) — K4 language policy.
//
// One active document language, one translation path. The surfaces that predate
// the shared i18n layer (Area Profile, Destination Context, metric footers,
// Nearest, pedestrian, comparison table, controls, layer panel) build their
// English sentences inside pure, tested model modules whose English output is a
// contract of its own. Rather than fork those models per language, this catalogue
// maps each PRODUCT-AUTHORED English phrase to its Spanish rendering. English is
// the source text and is returned untouched, so EN is lossless by construction.
//
// What it will NOT translate (the verbatim rule):
//   * official / publisher values and names (barrio names, source terms, registry
//     wording), registry interpretation ceilings and the canonical ceilings the
//     claims document requires verbatim — those sit under [data-verbatim] and keep
//     their original language, annotated with lang="en" where they are English;
//   * numbers, units, dates' digits, state codes: only the words around them move.
//
// Pure: no DOM, no clock. Phrases containing {name} are patterns; captured parts
// are themselves localised (so nested known phrases and month names follow).

const LEGACY_COPY_ES = [
  // ------------------------------------------------------------ Area Profile
  ["Locating…", "Localizando…"],
  ["Reading the canonical Madrid administrative geography.", "Leyendo la geografía administrativa canónica de Madrid."],
  ["Administrative context unavailable", "Contexto administrativo no disponible"],
  ["The canonical Madrid geography could not be loaded, so no official area is reported.", "No se pudo cargar la geografía canónica de Madrid, por lo que no se informa de ningún área oficial."],
  ["Outside Madrid City", "Fuera de la ciudad de Madrid"],
  ["Outside the canonical Madrid City administrative geography.", "Fuera de la geografía administrativa canónica de la ciudad de Madrid."],
  ["No official barrio contains this point, so no barrio statistic applies.", "Ningún barrio oficial contiene este punto, por lo que no se aplica ninguna estadística de barrio."],
  ["Residential population unavailable for this administrative area.", "Población residente no disponible para esta área administrativa."],
  ["Whole official barrio — not the Lens circle.", "Barrio oficial completo, no el círculo de la Lente."],
  ["Official register", "Registro oficial"],
  ["Registered residents", "Residentes empadronados"],
  ["Administrative area", "Área administrativa"],
  ["official barrio", "barrio oficial"],
  ["official district", "distrito oficial"],
  ["whole official barrio", "barrio oficial completo"],
  ["Barrio {a} · District {b}", "Barrio {a} · Distrito {b}"],
  ["District {a}", "Distrito {a}"],
  ["Reference {a}", "Referencia {a}"],
  ["Reference date {a}", "Fecha de referencia {a}"],
  ["Barrio geography {a} · district geography {b}", "Geografía de barrio {a} · geografía de distrito {b}"],
  ["Both Lens centres are outside Madrid City.", "Los centros de ambas Lentes están fuera de la ciudad de Madrid."],
  ["One Lens centre is outside Madrid City, so the two areas are not comparable.", "El centro de una Lente está fuera de la ciudad de Madrid, por lo que las dos áreas no son comparables."],
  ["An administrative area is unavailable for one of the Lenses.", "No hay área administrativa disponible para una de las Lentes."],
  ["One barrio statistic, not two observations.", "Una estadística de barrio, no dos observaciones."],
  ["Both Lens centres are in {a}. {b}", "Los centros de ambas Lentes están en {a}. {b}"],
  ["Two barrios of {a}.", "Dos barrios de {a}."],
  ["administrative-area statistics, not two observations.", "estadísticas de área administrativa, no dos observaciones."],
  ["· {a} residents", "· {a} residentes"],
  ["· residents unavailable", "· residentes no disponibles"],
  ["{a} residents", "{a} residentes"],
  // registry display names (our labels; the AUTHORITY strings beside them stay verbatim)
  ["Tourist information points", "Puntos de información turística"],
  ["BiciMAD stations", "Estaciones de BiciMAD"],
  ["Metro and Cercanias stations", "Estaciones de Metro y Cercanías"],
  ["Accommodation listings (Madrid Destino tourism catalogue)", "Listados de alojamiento (catálogo turístico de Madrid Destino)"],
  ["Principal municipal parks and gardens", "Parques y jardines municipales principales"],
  ["Permanent pedestrian counters", "Contadores permanentes de peatones"],
  ["HATI-Madrid outdoor UTCI pilot evidence", "Evidencia del piloto de UTCI exterior de HATI-Madrid"],
  ["Curated multi-source packaged fallback sample", "Muestra alternativa empaquetada y curada de varias fuentes"],
  ["Madrid administrative geography", "Geografía administrativa de Madrid"],
  ["Madrid residential population (Padron)", "Población residente de Madrid (Padrón)"],
  ["Licensed tourist-dwelling units (VUT activity licences)", "Viviendas de uso turístico con licencia (licencias de actividad VUT)"],
  ["Hospitality & Commercial Context", "Contexto de hostelería y actividad comercial"],
  ["Hotel demand by month (Destination Context)", "Demanda hotelera por mes (Contexto del destino)"],
  ["Madrid domestic origin context by month (Destination Context)", "Contexto de orígenes nacionales de Madrid por mes (Contexto del destino)"],
  // map tooltips
  ["model-derived", "derivado de modelo"],
  ["context only", "solo contexto"],
  ["Accommodation", "Alojamiento"],
  ["2024 published period", "periodo publicado de 2024"],
  ["Mean observed: {a} pedestrians / published hourly record", "Media observada: {a} peatones / registro horario publicado"],
  ["Madrid permanent counter", "Contador permanente de Madrid"],
  ["Principal municipal park / garden", "Parque / jardín municipal principal"],
  ["{a} licensed VUT units", "{a} unidades VUT con licencia"],
  ["{a} licensed VUT unit", "{a} unidad VUT con licencia"],
  ["· licensed VUT unavailable", "· VUT con licencia no disponible"],
  ["Administrative licence", "Licencia administrativa"],
  ["Licensed VUT", "VUT con licencia"],
  ["Licensed VUT units", "Unidades VUT con licencia"],
  ["licensed VUT units", "unidades VUT con licencia"],
  ["licensed VUT unit", "unidad VUT con licencia"],
  ["activity licences", "licencias de actividad"],
  ["activity licence", "licencia de actividad"],
  ["{a} activity licences", "{a} licencias de actividad"],
  ["{a} activity licence", "{a} licencia de actividad"],
  ["per 1,000 registered residents", "por cada 1.000 residentes empadronados"],
  ["{a} per 1,000 registered residents", "{a} por cada 1.000 residentes empadronados"],
  ["ratio unavailable without a resident figure", "ratio no disponible sin una cifra de residentes"],
  ["Granted licences", "Licencias concedidas"],
  ["Granted licences · {a}", "Licencias concedidas · {a}"],
  ["Reading the licensed-VUT source.", "Leyendo la fuente de VUT con licencia."],
  ["Licensed-VUT source unavailable in this session.", "Fuente de VUT con licencia no disponible en esta sesión."],
  ["Not covered by the committed licensed-VUT source.", "No cubierto por la fuente de VUT con licencia incluida."],
  ["Source & interpretation", "Fuente e interpretación"],
  ["source file state {a}", "estado del archivo de la fuente {a}"],
  ["Licence grant dates in this extract span {a} to {b}.", "Las fechas de concesión de licencias de este extracto abarcan de {a} a {b}."],
  ["Source state: HTTP Last-Modified observed on the resource file, {a}. The source declares no reference or effective date, so this is not one.", "Estado de la fuente: HTTP Last-Modified observado en el archivo del recurso, {a}. La fuente no declara fecha de referencia ni de efecto, así que esto no lo es."],

  // ------------------------------------------------------ Destination context
  ["Destination context", "Contexto del destino"],
  ["whole municipality", "municipio completo"],
  ["Official statistics", "Estadísticas oficiales"],
  ["provisional", "provisional"],
  ["Whole municipality of Madrid — not the Lens circle.", "Municipio de Madrid completo, no el círculo de la Lente."],
  ["Provisional: the source revises the current year's months later.", "Provisional: la fuente revisa meses después los datos del año en curso."],
  ["Hotel establishments only — not all tourism, not all accommodation.", "Solo establecimientos hoteleros: no todo el turismo ni todo el alojamiento."],
  ["Overnight stays", "Pernoctaciones"],
  ["overnight stays", "pernoctaciones"],
  ["overnight stay", "pernoctación"],
  ["Travellers", "Viajeros"],
  ["travellers", "viajeros"],
  ["Unavailable", "No disponible"],
  ["Reading the hotel-demand series.", "Leyendo la serie de demanda hotelera."],
  ["Destination context unavailable in this session.", "Contexto del destino no disponible en esta sesión."],
  ["Residents in Spain {a} ·", "Residentes en España {a} ·"],
  ["Residents in Spain {a}", "Residentes en España {a}"],
  ["Residents abroad {a}", "Residentes en el extranjero {a}"],
  ["Of travellers in this month, {a}", "De los viajeros de este mes, {a}"],
  ["No comparison: the source published zero for {a}", "Sin comparación: la fuente publicó cero para {a}"],
  ["No comparison: the source published no figure for {a}", "Sin comparación: la fuente no publicó ninguna cifra para {a}"],
  ["No figure published for this month", "No se publicó ninguna cifra para este mes"],
  ["No comparison: the series does not reach back a year", "Sin comparación: la serie no se remonta un año atrás"],
  ["from {a} to {b}.", "de {a} a {b}."],
  ["Lowest {a}, highest {b}.", "Mínimo {a}, máximo {b}."],
  ["No figure published for {a}.", "No se publicó ninguna cifra para {a}."],
  ["Observation period: {a}", "Periodo de observación: {a}"],
  [", published as provisional and revised later.", ", publicado como provisional y revisado más tarde."],
  ["Retrieved from the publisher on {a}. That is when this snapshot was built, not the period it describes.", "Obtenido del editor el {a}. Es cuando se construyó esta instantánea, no el periodo que describe."],

  // ----------------------------------------------------------- Lens metrics
  ["No data", "Sin datos"],
  ["No evidence", "Sin evidencia"],
  ["Off", "Apagado"],
  ["within lens", "dentro de la Lente"],
  ["deployment snapshot", "instantánea del despliegue"],
  ["sample count, not exhaustive", "recuento de muestra, no exhaustivo"],
  ["source unavailable", "fuente no disponible"],
  ["{a} · within lens", "{a} · dentro de la Lente"],
  ["{a} · deployment snapshot", "{a} · instantánea del despliegue"],
  ["{a} · sample, not exhaustive", "{a} · muestra, no exhaustiva"],
  ["All accommodation", "Todo el alojamiento"],
  ["Hotels", "Hoteles"],
  ["Hostales", "Hostales"],
  ["Apartahotels / apartments", "Apartahoteles / apartamentos"],
  ["Albergues", "Albergues"],
  ["Pensions / guest houses", "Pensiones / casas de huéspedes"],
  ["Student residences", "Residencias de estudiantes"],
  ["Camping", "Camping"],
  ["Other / unclassified", "Otros / sin clasificar"],
  ["BiciMAD + rail stations in lens", "BiciMAD + estaciones de tren en la Lente"],
  ["BiciMAD + CRTM deployment snapshot", "BiciMAD + instantánea del despliegue de CRTM"],
  ["BiciMAD + rail stations", "BiciMAD + estaciones de tren"],
  ["partial mobility sample, not exhaustive", "muestra parcial de movilidad, no exhaustiva"],
  ["some mobility sources unavailable", "algunas fuentes de movilidad no disponibles"],
  ["HATI outdoor samples", "muestras exteriores de HATI"],
  ["enable HATI research evidence", "active la evidencia de investigación HATI"],
  ["no HATI samples in lens", "sin muestras HATI en la Lente"],
  ["{a} HATI sample · {b}", "{a} muestra HATI · {b}"],
  ["{a} HATI samples · {b}", "{a} muestras HATI · {b}"],
  ["model", "modelo"],
  ["{a} within lens", "{a} dentro de la Lente"],
  ["{a} circle", "círculo de {a}"],
  ["Lens {a} radius", "Radio de la Lente {a}"],
  ["Lens A · active", "Lente A · activa"],
  ["Lens B · active", "Lente B · activa"],
  ["Lens A", "Lente A"],
  ["Lens B", "Lente B"],
  ["+ Enable Lens B", "+ Activar Lente B"],
  ["Reset active lens", "Restablecer la Lente activa"],
  ["Lens A radius", "Radio de la Lente A"],
  ["Lens B radius", "Radio de la Lente B"],
  ["HATI model time", "Hora del modelo HATI"],
  ["Enable HATI research evidence to change model time", "Active la evidencia de investigación HATI para cambiar la hora del modelo"],
  ["Resize analysis panel", "Cambiar el tamaño del panel de análisis"],
  ["Drag to resize · double-click to reset", "Arrastre para cambiar el tamaño · doble clic para restablecer"],
  ["Spatial analysis panel", "Panel de análisis espacial"],
  ["Loading spatial sources…", "Cargando fuentes espaciales…"],
  ["Central Madrid", "Madrid centro"],
  ["{a} records · deployment snapshot (see layer panel)", "{a} registros · instantánea del despliegue (ver panel de capas)"],
  ["{a} records · {b}", "{a} registros · {b}"],
  ["{a} records", "{a} registros"],
  ["live source", "fuente en vivo"],
  ["partial fallback", "alternativa parcial"],
  ["live mixed", "en vivo mixto"],
  ["some unavailable", "algunas no disponibles"],
  ["Snapshot sample; not exhaustive", "Muestra de la instantánea; no exhaustiva"],
  ["Deployment snapshot", "Instantánea del despliegue"],
  ["Live source", "Fuente en vivo"],
  ["no data at this time", "sin datos en este momento"],
  ["snapshot sample (not exhaustive)", "muestra de la instantánea (no exhaustiva)"],

  // ------------------------------------------------------- Mix and Nearest
  ["N/A", "N/D"],
  ["Loading…", "Cargando…"],
  ["No features in lens", "Sin elementos en la Lente"],
  ["No tourism, stay, mobility or info features inside this lens.", "Ningún elemento turístico, de alojamiento, de movilidad o de información dentro de esta Lente."],
  ["No features in this lens", "Sin elementos en esta Lente"],
  ["Category mix · {a}", "Mezcla de categorías · {a}"],
  ["category mix unavailable: some layers lack evidence", "mezcla de categorías no disponible: faltan datos en algunas capas"],
  ["partial mix: some layers unavailable", "mezcla parcial: algunas capas no disponibles"],
  ["based on sample counts", "basado en recuentos de muestra"],

  // ----------------------------------------------------------- Pedestrian
  ["Pedestrian flow", "Flujo peatonal"],
  ["Pedestrian flow {a}", "Flujo peatonal {a}"],
  ["observed", "observado"],
  ["Madrid permanent counters", "Contadores permanentes de Madrid"],
  ["Counts are observed pedestrians, not tourists. No interpolation between counters.", "Los recuentos son peatones observados, no turistas. Sin interpolación entre contadores."],
  ["No sensor evidence", "Sin evidencia de sensores"],
  ["deployment snapshot unavailable", "instantánea del despliegue no disponible"],
  ["no permanent pedestrian counter in lens", "ningún contador permanente de peatones en la Lente"],
  ["{a} ped/h", "{a} peat./h"],
  ["{a} passages/hour", "{a} pasos/hora"],
  ["{a} counter in current lens · {b} radius", "{a} contador en la Lente actual · radio {b}"],
  ["{a} counters in current lens · {b} radius", "{a} contadores en la Lente actual · radio {b}"],
  ["Pedestrian · panel only", "Peatones · solo panel"],
  ["Pedestrian source unavailable", "Fuente de peatones no disponible"],
  ["Pedestrian layer off.", "Capa de peatones apagada."],
  ["Observed pedestrian activity", "Actividad peatonal observada"],
  ["Observed pedestrian activity unavailable in this deployment", "Actividad peatonal observada no disponible en este despliegue"],
  ["Show Madrid permanent pedestrian counters and lens activity evidence", "Mostrar los contadores permanentes de peatones de Madrid y la evidencia de actividad de la Lente"],
  ["Toggle observed pedestrian activity", "Alternar la actividad peatonal observada"],
  ["Principal parks context unavailable in this deployment", "Contexto de parques principales no disponible en este despliegue"],
  ["Show principal municipal parks and gardens as context", "Mostrar como contexto los principales parques y jardines municipales"],
  ["Toggle principal municipal parks", "Alternar los parques municipales principales"],
  ["Toggle HATI thermal pilot", "Alternar el piloto térmico HATI"],
  ["Filter the official accommodation layer by Madrid Destino category", "Filtrar la capa oficial de alojamiento por categoría de Madrid Destino"],
  ["Accommodation type metadata unavailable in the current fallback", "Metadatos de tipo de alojamiento no disponibles en la alternativa actual"],
  ["Accommodation category", "Categoría de alojamiento"],
  ["Administrative geography unavailable in this deployment", "Geografía administrativa no disponible en este despliegue"],
  ["Base map", "Mapa base"],
  ["Administrative boundaries", "Límites administrativos"],
  ["Light · CARTO Positron", "Claro · CARTO Positron"],
  ["Satellite + labels · Esri", "Satélite + etiquetas · Esri"],
  ["Dark · CARTO Dark Matter", "Oscuro · CARTO Dark Matter"],
  ["Off · active area only", "Apagado · solo el área activa"],
  ["All district outlines", "Todos los contornos de distrito"],
  ["All barrio outlines", "Todos los contornos de barrio"],
  ["Hotels & stays", "Hoteles y alojamientos"],
  ["Tourist info", "Información turística"],
  ["Metro & Cercanías", "Metro y Cercanías"],
  ["Mean UTCI", "UTCI media"],
  ["Tourism POIs", "POI turísticos"],
  ["Mobility nodes", "Nodos de movilidad"],
  ["Museums", "Museos"],
  ["Stays", "Alojamientos"],
  ["Mobility", "Movilidad"],
  ["Info", "Información"],
  ["Nearest in active lens", "Más cercanos en la Lente activa"],
  ["Category mix", "Mezcla de categorías"],
  ["Within the Lens", "Dentro de la Lente"],
  ["Deployment snapshots are generated from the public sources during the latest site deploy.", "Las instantáneas del despliegue se generan a partir de las fuentes públicas durante el último despliegue del sitio."],
  ["Curated fallback counts are a partial sample, not a complete inventory.", "Los recuentos de la alternativa curada son una muestra parcial, no un inventario completo."],
  ["Observed pedestrian activity: {a}", "Actividad peatonal observada: {a}"],
  ["Pedestrian counters are observed activity evidence, not tourist counts, and are excluded from POI/category-mix metrics.", "Los contadores de peatones son evidencia de actividad observada, no recuentos de turistas, y se excluyen de las métricas de POI y de mezcla de categorías."],
  ["Principal parks (context): {a}", "Parques principales (contexto): {a}"],
  ["Park context is excluded from lens counts, category mix, nearest features and A/B comparisons.", "El contexto de parques se excluye de los recuentos de la Lente, la mezcla de categorías, los elementos más cercanos y las comparaciones A/B."],
  ["Hotels & stays and BiciMAD are visually grouped below zoom 16; lens counts still use every record.", "Hoteles y alojamientos y BiciMAD se agrupan visualmente por debajo del zoom 16; los recuentos de la Lente siguen usando todos los registros."],
  ["DEPLOYMENT SNAPSHOT", "INSTANTÁNEA DEL DESPLIEGUE"],
  ["SNAPSHOT SAMPLE", "MUESTRA DE LA INSTANTÁNEA"],
  ["LIVE", "EN VIVO"],
  ["UNAVAILABLE", "NO DISPONIBLE"],
  ["not tourism-specific", "no específica del turismo"],

  // --------------------------------------------------------- Comparison
  ["Lens A ↔ Lens B", "Lente A ↔ Lente B"],
  ["circle measurements only", "solo mediciones del círculo"],
  ["Metric", "Métrica"],
  ["B−A", "B−A"],
  ["Pedestrian", "Peatones"],
  ["UTCI", "UTCI"],
  ["Lens A and Lens B circle measurements", "Mediciones de los círculos de la Lente A y la Lente B"],
  ["Focused metric comparison", "Comparación de la métrica enfocada"],
  ["Lens radii", "Radios de las Lentes"],
  ["Lens A · {a} | Lens B · {b}", "Lente A · {a} | Lente B · {b}"],
  ["Lens A {a}; Lens B {b}.", "Lente A {a}; Lente B {b}."],
  ["Equal windows · raw represented counts", "Ventanas iguales · recuentos brutos representados"],
  ["Different windows · POI/stay comparator: represented records/km²", "Ventanas distintas · comparador de POI y alojamientos: registros representados/km²"],
  ["Different windows · POI/stay normalized comparison withheld", "Ventanas distintas · comparación normalizada de POI y alojamientos retenida"],
  ["Nested windows · records may be shared", "Ventanas anidadas · los registros pueden compartirse"],
  ["Overlapping windows · observations are not independent", "Ventanas solapadas · las observaciones no son independientes"],
  ["Windows are disjoint.", "Las ventanas son disjuntas."],
  ["Withheld · circle crosses Madrid AOI", "Retenido · el círculo cruza el AOI de Madrid"],
  ["Withheld · circle outside Madrid AOI", "Retenido · el círculo está fuera del AOI de Madrid"],
  ["Withheld · AOI unavailable", "Retenido · AOI no disponible"],
  ["Withheld · source states incompatible", "Retenido · estados de fuente incompatibles"],
  ["circle crosses Madrid AOI", "el círculo cruza el AOI de Madrid"],
  ["circle outside Madrid AOI", "el círculo está fuera del AOI de Madrid"],
  ["Madrid AOI unavailable", "AOI de Madrid no disponible"],
  ["AOI unavailable", "AOI no disponible"],
  ["source evidence incompatible or unavailable", "evidencia de fuente incompatible o no disponible"],
  ["represented records", "registros representados"],
  ["represented catalogue records", "registros de catálogo representados"],
  ["catalogue records", "registros de catálogo"],
  ["{a} nodes", "{a} nodos"],
  ["{a} nodes\nr {b}", "{a} nodos\nr {b}"],
  ["{a} records/km²", "{a} registros/km²"],
  ["Evidence —", "Evidencia —"],
  ["Evidence {a}", "Evidencia {a}"],
  ["Pedestrian observations · A {a} counters / {b} observations · r {c}; B {d} counters / {e} observations · r {f}; observed pedestrians, not tourists.", "Observaciones de peatones · A {a} contadores / {b} observaciones · r {c}; B {d} contadores / {e} observaciones · r {f}; peatones observados, no turistas."],
  ["HATI off", "HATI apagado"],
  ["HATI {a} · 21 Aug 2023 · A {b} samples (r {c}) / B {d} samples (r {e}).", "HATI {a} · 21 ago 2023 · A {b} muestras (r {c}) / B {d} muestras (r {e})."],
  ["HATI {a} · 21 Aug 2023 · A {b} samples (r {c}) / B {d} samples (r {e}); sample counts differ, summarizing different sampled assets/windows.", "HATI {a} · 21 ago 2023 · A {b} muestras (r {c}) / B {d} muestras (r {e}); los recuentos de muestras difieren y resumen elementos o ventanas muestreados distintos."],
  ["HATI {a} · 21 Aug 2023 · A {b} samples (r {c}) / B {d} samples (r {e}); sample counts differ, summarizing different sampled assets/windows", "HATI {a} · 21 ago 2023 · A {b} muestras (r {c}) / B {d} muestras (r {e}); los recuentos de muestras difieren y resumen elementos o ventanas muestreados distintos"],
  ["sample counts differ, summarizing different sampled assets/windows", "los recuentos de muestras difieren y resumen elementos o ventanas muestreados distintos"],
  ["HATI {a} · 21 Aug 2023 · A {b} samples (r {c}) / B {d} samples (r {e})", "HATI {a} · 21 ago 2023 · A {b} muestras (r {c}) / B {d} muestras (r {e})"],
  ["Tourism POIs raw counts {a} and {b}; stays raw counts {c} and {d}.", "Recuentos brutos de POI turísticos {a} y {b}; recuentos brutos de alojamientos {c} y {d}."],
  ["Comparison halo", "Halo de comparación"],
  ["supplementary map marks", "marcas complementarias del mapa"],
  ["Show comparison halo around Lens A and Lens B", "Mostrar el halo de comparación alrededor de la Lente A y la Lente B"],
  ["Map halo off; the full comparison remains in this panel.", "Halo del mapa apagado; la comparación completa permanece en este panel."],
  ["Map halo off.", "Halo del mapa apagado."],
  ["below the 30 px compact Halo threshold", "por debajo del umbral compacto de 30 px del halo"],
  ["overlapped by a map control panel", "tapado por un panel de control del mapa"],
  ["ambiguous Lens A/B slot overlap", "solape ambiguo de posiciones entre la Lente A y la B"],
  ["at the map edge", "en el borde del mapa"],
  ["Some map Halo slots are hidden ({a}); {b}.", "Algunas posiciones del halo del mapa están ocultas ({a}); {b}."],
  ["Lens {a} compact bars", "barras compactas de la Lente {a}"],
  ["the full comparison stays in this panel", "la comparación completa permanece en este panel"],
  ["detail stays in this panel", "el detalle permanece en este panel"],
  ["Map Halo shown. Bar length is each lens's value against a fixed Madrid reference for that metric; lengths compare within a metric only.", "Halo del mapa visible. La longitud de la barra es el valor de cada Lente frente a una referencia fija de Madrid para esa métrica; las longitudes solo se comparan dentro de una métrica."],
  ["Evidence & limits", "Evidencia y límites"],

  // ----------------------------------------------------------- Panel chrome
  ["Map display", "Visualización del mapa"],
  ["Operational layers", "Capas operativas"],
  ["Observed activity", "Actividad observada"],
  ["Pedestrian counters", "Contadores de peatones"],
  ["Context", "Contexto"],
  ["not in metrics", "fuera de las métricas"],
  ["Principal parks", "Parques principales"],
  ["Research evidence", "Evidencia de investigación"],
  ["bounded pilot", "piloto acotado"],
  ["HATI · thermal pilot", "HATI · piloto térmico"],
  ["Show HATI pilot on the map", "Mostrar el piloto HATI en el mapa"],
  ["Evidence ceiling", "Límite de la evidencia"],
  ["Madrid · Urban development · Official evidence", "Madrid · Desarrollo urbano · Evidencia oficial"],
  ["Source month", "Mes de referencia"],
  ["Capture current comparison", "Capturar la comparación actual"],
  ["Reset baseline", "Restablecer la línea base"],
  ["Clear selected barrio", "Borrar el barrio seleccionado"],
  ["Madrid municipality · 28079", "Municipio de Madrid · 28079"],
  ["Hotel & stays", "Hoteles y alojamientos"],
  ["Mobility comparison {a}", "Comparación de movilidad {a}"],

  // ---------------------------------------- accessibility copy and map controls
  ["Mode", "Modo"],
  ["Controls", "Controles"],
  ["Reading", "Lectura"],
  ["Scope and freshness of the evidence on screen", "Ámbito y actualidad de la evidencia en pantalla"],
  ["Administrative area of the active lens", "Área administrativa de la Lente activa"],
  ["Published-origin set counts", "Recuentos del conjunto de orígenes publicados"],
  ["Destination context: hotel demand for the city of Madrid", "Contexto del destino: demanda hotelera de la ciudad de Madrid"],
  ["Madrid · municipality {a}", "Madrid · municipio {a}"],
  ["Zoom in", "Acercar"],
  ["Zoom out", "Alejar"],
  ["A JavaScript library for interactive maps", "Una biblioteca JavaScript para mapas interactivos"],
  ["Focus a halo metric to compare Lens A and Lens B", "Enfoque una métrica del halo para comparar la Lente A y la Lente B"],
  ["Museums:", "Museos:"],
  ["Tourist info:", "Información turística:"],
  ["BiciMAD:", "BiciMAD:"],
  ["Metro & Cercanías:", "Metro y Cercanías:"],
  ["Hotels & stays:", "Hoteles y alojamientos:"],
  ["Observed pedestrian activity:", "Actividad peatonal observada:"],
  ["Principal parks (context):", "Parques principales (contexto):"],

  // -------------------------------------------------------- comparison table
  ["Withheld", "Retenido"],
  ["sample", "muestra"],
  ["deploy", "desp."],
  ["Equal windows", "Ventanas iguales"],
  ["raw represented counts", "recuentos brutos representados"],
  ["Overlapping windows", "Ventanas solapadas"],
  ["observations are not independent", "las observaciones no son independientes"],
  ["Nested windows", "Ventanas anidadas"],
  ["records may be shared", "los registros pueden compartirse"],
  ["Different windows", "Ventanas distintas"],
  ["{a} records\nr {b}", "{a} registros\nr {b}"],
  ["{a} catalogue records\nr {b}", "{a} registros de catálogo\nr {b}"],
  ["{a} observed pedestrians/hour", "{a} peatones observados/hora"],
  ["{a} model-derived samples", "{a} muestras derivadas de modelo"],
  ["{a} model-derived samples.", "{a} muestras derivadas de modelo."],
  ["comparison withheld because one or both lenses have no HATI sample", "comparación retenida porque una o ambas Lentes no tienen muestra HATI"],
  ["comparison withheld because neither lens has a HATI sample", "comparación retenida porque ninguna Lente tiene muestra HATI"],
  ["comparison withheld because one or both lenses have no observed counters", "comparación retenida porque una o ambas Lentes no tienen contadores observados"],
  ["comparison withheld · incompatible evidence", "comparación retenida · evidencia incompatible"],
  ["Withheld · different window sizes", "Retenido · tamaños de ventana distintos"],
  ["HATI timesteps differ", "las horas del modelo HATI difieren"],
  ["HATI layer off", "capa HATI apagada"],
  ["source states differ or a value is unavailable", "los estados de la fuente difieren o un valor no está disponible"],
  ["invalid circle area", "área de círculo no válida"],
  ["layer off", "capa apagada"],
  ["pedestrian source period unavailable", "periodo de la fuente de peatones no disponible"],
  ["model-derived · {a} · 21 Aug 2023 · {b} / {c} samples", "derivado de modelo · {a} · 21 ago 2023 · {b} / {c} muestras"],
  ["Sample mix · not exhaustive · some categories unavailable", "Mezcla de muestra · no exhaustiva · algunas categorías no disponibles"],
  ["Sample mix · not exhaustive", "Mezcla de muestra · no exhaustiva"],
  ["Deployment snapshot · some categories unavailable", "Instantánea del despliegue · algunas categorías no disponibles"],
  ["Deployment snapshot · not real-time", "Instantánea del despliegue · no en tiempo real"],
  ["Some categories unavailable", "Algunas categorías no disponibles"],
  ["valid value", "valor válido"],
  ["valid value · snapshot sample", "valor válido · muestra de la instantánea"],
  ["valid value · deployment snapshot", "valor válido · instantánea del despliegue"],
  ["off", "apagado"],
  ["unavailable", "no disponible"],
  ["no evidence", "sin evidencia"],
  ["comparison withheld", "comparación retenida"],
  ["valid snapshot sample", "muestra válida de la instantánea"],
  ["valid deployment snapshot", "instantánea del despliegue válida"],
  ["evidence state unknown", "estado de la evidencia desconocido"],
  ["{a} POIs", "{a} POI"],
  ["{a} stays", "{a} alojamientos"],

  // ----------------------------------------- screen-reader comparison summaries
  ["Lens {a}, {b}: {c}. Radial bar length represents this metric against its own Madrid reference; compare this metric across lenses only.", "Lente {a}, {b}: {c}. La longitud de la barra radial representa esta métrica frente a su propia referencia de Madrid; compare esta métrica solo entre Lentes."],
  ["Comparison halo.", "Halo de comparación."],
  ["Lens A radius {a} m; Lens B radius {b} m.", "Radio de la Lente A {a} m; radio de la Lente B {b} m."],
  ["Fixed radial slots: Tourism POIs at twelve o'clock, Hotels & stays at two, Mobility nodes at six, Mean UTCI at nine.", "Posiciones radiales fijas: POI turísticos a las doce, Hoteles y alojamientos a las dos, Nodos de movilidad a las seis, UTCI media a las nueve."],
  ["Every bar starts just outside its own Lens circumference and points outward; the same metric keeps the same angle on Lens A and Lens B.", "Cada barra empieza justo fuera de la circunferencia de su propia Lente y apunta hacia fuera; la misma métrica mantiene el mismo ángulo en la Lente A y en la Lente B."],
  ["The printed number is the raw value inside the lens; for the three count metrics the bar length is that lens's represented spatial density (records per square kilometre) relative to a fixed Madrid reference density, so unequal radii stay comparable.", "El número impreso es el valor bruto dentro de la Lente; en las tres métricas de recuento, la longitud de la barra es la densidad espacial representada de esa Lente (registros por kilómetro cuadrado) respecto a una densidad de referencia fija de Madrid, de modo que los radios desiguales siguen siendo comparables."],
  ["UTCI's bar is its position in a model-derived Celsius band.", "La barra del UTCI es su posición en una banda de grados Celsius derivada de modelo."],
  ["Bar lengths are comparable within the same metric only, never across metrics.", "Las longitudes de barra solo son comparables dentro de la misma métrica, nunca entre métricas."],
  ["{a}: Lens A {b}, Lens B {c}, difference {d}; {e}.", "{a}: Lente A {b}, Lente B {c}, diferencia {d}; {e}."],
  ["{a}: Lens A {b}, Lens B {c}; direct comparison withheld; {d}.", "{a}: Lente A {b}, Lente B {c}; comparación directa retenida; {d}."],
  ["bar: represented {a} density vs Madrid reference", "barra: densidad representada de {a} frente a la referencia de Madrid"],
  ["bar: represented {a} density vs Madrid reference ({b} at or above reference)", "barra: densidad representada de {a} frente a la referencia de Madrid ({b} en o por encima de la referencia)"],
  ["bar: position in model-derived Celsius band", "barra: posición en la banda de grados Celsius derivada de modelo"],
  ["Lens A coverage: {a}", "Cobertura de la Lente A: {a}"],
  ["Lens B coverage: {a}", "Cobertura de la Lente B: {a}"],
  ["stay", "alojamiento"],
  ["mobility node", "nodo de movilidad"],
  ["POI", "POI"],
  ["Lens A and Lens B", "Lente A y Lente B"],
  ["{a} represented records/km²", "{a} registros representados/km²"],
  ["{a} represented catalogue records/km²", "{a} registros de catálogo representados/km²"],
  ["Reference density is the Madrid p{a} local density in a {b} metre window per count metric, shared by Lens A and Lens B, and a model-derived Celsius band for UTCI.", "La densidad de referencia es la densidad local p{a} de Madrid en una ventana de {b} metros por métrica de recuento, compartida por la Lente A y la Lente B, y una banda de grados Celsius derivada de modelo para el UTCI."],
  ["Reference density is the Madrid p95 local density per count metric, shared by Lens A and Lens B, and a model-derived Celsius band for UTCI.", "La densidad de referencia es la densidad local p95 de Madrid por métrica de recuento, compartida por la Lente A y la Lente B, y una banda de grados Celsius derivada de modelo para el UTCI."],
  ["Values above the reference density saturate the bar while the raw value keeps the real magnitude.", "Los valores por encima de la densidad de referencia saturan la barra mientras el valor bruto conserva la magnitud real."],
  ["Unavailable data reads N/A, never zero; a genuine zero stays a distinct zero state.", "Los datos no disponibles se leen N/D, nunca cero; un cero genuino sigue siendo un estado de cero distinto."],
  ["No bar is a score or recommendation.", "Ninguna barra es una puntuación ni una recomendación."],
  ["Tourism rates {a} and {b} represented records per km²; delta {c}.", "Tasas de POI turísticos {a} y {b} registros representados por km²; diferencia {c}."],
  ["Stay rates {a} and {b} represented catalogue records per km²; delta {c}.", "Tasas de alojamientos {a} y {b} registros de catálogo representados por km²; diferencia {c}."],
  ["Mobility comparison {a} · {b}.", "Comparación de movilidad {a} · {b}."],
  ["Some map Halo slots are hidden ({a}); the full comparison stays in this panel.", "Algunas posiciones del halo del mapa están ocultas ({a}); la comparación completa permanece en este panel."],
  ["{a} tourism: {b}", "{a} turismo: {b}"],
  ["{a} stays: {b}", "{a} alojamientos: {b}"],
  ["{a} mobility: {b}", "{a} movilidad: {b}"],
  ["{a} utci: {b}", "{a} UTCI: {b}"],
  ["Lens {a} compact bars. Map Halo shown. Bar length is each lens's value against a fixed Madrid reference for that metric; lengths compare within a metric only.", "Barras compactas de la Lente {a}. Halo del mapa visible. La longitud de la barra es el valor de cada Lente frente a una referencia fija de Madrid para esa métrica; las longitudes solo se comparan dentro de una métrica."],

  // ------------------------------------------------ destination and origins
  ["{a} travellers", "{a} viajeros"],
  ["{a} overnight stays", "{a} pernoctaciones"],
  ["Madrid municipality — not the Lens circle.", "Municipio de Madrid, no el círculo de la Lente."],
  ["Source geography: {a} “{b}” — the publisher defines a {c} as a municipality and publishes this one under municipality code {d} (Madrid).", "Geografía de la fuente: {a} «{b}»: el editor define un {c} como un municipio y publica este bajo el código de municipio {d} (Madrid)."],
];

const SPANISH_MONTHS = Object.freeze({ Jan: "ene", Feb: "feb", Mar: "mar", Apr: "abr", May: "may", Jun: "jun", Jul: "jul", Aug: "ago", Sep: "sep", Oct: "oct", Nov: "nov", Dec: "dic" });
const SPANISH_MONTH_NAMES = Object.freeze({ January: "enero", February: "febrero", March: "marzo", April: "abril", May: "mayo", June: "junio", July: "julio", August: "agosto", September: "septiembre", October: "octubre", November: "noviembre", December: "diciembre" });
// Sentences first (keeping their full stop), then clauses, then compound feet.
const SPLITTERS = Object.freeze([/(?<=\.)( +)/, /(; )/, /( · )/, /( \| )/, /(, )/]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Compile once: literal entries into a Map, {x} entries into anchored patterns.
const LEGACY_EXACT = new Map();
const LEGACY_PATTERNS = [];
for (const [en, es] of LEGACY_COPY_ES) {
  if (/\{[a-z]\}/.test(en)) {
    const names = [];
    const source = escapeRegExp(en).replace(/\\\{([a-z])\\\}/g, (_, name) => { names.push(name); return "([\\s\\S]+?)"; });
    LEGACY_PATTERNS.push({ regex: new RegExp(`^${source}$`), names, es, fragments: en.split(/\{[a-z]\}/), spansSentences: /\.\s/.test(en), specificity: en.replace(/\{[a-z]\}/g, "").length });
  } else {
    LEGACY_EXACT.set(en, es);
  }
}
// Longest literal skeleton first, so the most specific pattern wins.
LEGACY_PATTERNS.sort((x, y) => y.specificity - x.specificity);

function localizeMonths(text) {
  // Dates in our own short copy only; a long sentence is publisher prose and stays whole.
  if (text.length > 80) return text;
  return text
    .replace(/(?<!\d )\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/g, (_, month, year) => SPANISH_MONTH_NAMES[month] + " de " + year)
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b(?=\s\d{4}\b)/g, (month) => SPANISH_MONTHS[month]);
}

// Every literal fragment of a pattern must appear, in order, the first at the start
// and the last at the end. A linear scan that spares the regex engine from
// backtracking across a long sentence it can never match.
function fragmentsInOrder(fragments, text) {
  if (!text.startsWith(fragments[0]) || !text.endsWith(fragments[fragments.length - 1])) return false;
  let at = fragments[0].length;
  for (let i = 1; i < fragments.length - 1; i += 1) {
    const found = text.indexOf(fragments[i], at);
    if (found === -1) return false;
    at = found + fragments[i].length;
  }
  return at <= text.length - fragments[fragments.length - 1].length;
}

function translateOnce(text) {
  if (LEGACY_EXACT.has(text)) return LEGACY_EXACT.get(text);
  for (const pattern of LEGACY_PATTERNS) {
    if (!fragmentsInOrder(pattern.fragments, text)) continue; // cheap reject before any regex work
    const match = pattern.regex.exec(text);
    if (!match) continue;
    // A short skeleton ("{a} residents") must not swallow a whole sentence: that is
    // how an untranslated ceiling would be half-translated. Long captures need a
    // long (specific) skeleton.
    // A placeholder never spans a sentence break unless the phrase itself does: that
    // is how one sentence pattern could swallow a whole multi-sentence summary.
    if (!pattern.spansSentences && match.slice(1).some((part) => /\.\s/.test(part))) continue;
    if (pattern.specificity < 16 && match.slice(1).some((part) => part.length > 40)) continue;
    let result = pattern.es;
    pattern.names.forEach((name, index) => {
      result = result.split(`{${name}}`).join(localizeCopyEs(match[index + 1]));
    });
    return result;
  }
  return null;
}

// localizeCopy(text, lang) -> the Spanish rendering of a product-authored English
// phrase, or the text unchanged. EN is the source language and is never altered.
const LEGACY_MEMO = new Map();
function localizeCopyEs(text) {
  if (typeof text !== "string" || !/[A-Za-z]{2}/.test(text)) return text;
  const cached = LEGACY_MEMO.get(text);
  if (cached !== undefined) return cached;
  const result = localizeCopyUncached(text);
  if (LEGACY_MEMO.size < 5000) LEGACY_MEMO.set(text, result);
  return result;
}

function localizeCopyUncached(text) {
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  const core = text.trim();
  const whole = translateOnce(core);
  if (whole !== null) return lead + localizeMonths(whole) + trail;
  // A phrase catalogued without its closing full stop still matches when the
  // sentence carries one (the stop is re-attached untouched).
  if (core.endsWith(".")) {
    const bare = translateOnce(core.slice(0, -1));
    if (bare !== null) return lead + localizeMonths(bare) + "." + trail;
  }
  for (const splitter of SPLITTERS) {
    // split() with a capture group keeps the separators at the odd indexes.
    const pieces = core.split(splitter);
    if (pieces.length < 3) continue;
    const translated = pieces.map((piece, index) => (index % 2 === 0 ? localizeCopyEs(piece) : piece));
    // All-or-nothing for prose: if any clause we could not translate is a real
    // sentence (6+ words), the text is not ours to half-translate — leave it whole.
    const stranded = translated.some((piece, index) => index % 2 === 0 && piece === pieces[index] && piece.trim().split(/\s+/).length >= 6);
    if (stranded) continue;
    if (translated.some((piece, index) => piece !== pieces[index])) return lead + translated.join("") + trail;
  }
  return lead + localizeMonths(core) + trail;
}

function localizeCopy(text, language) {
  return language === "es" ? localizeCopyEs(text) : text;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LEGACY_COPY_ES, localizeCopy, localizeCopyEs, localizeMonths };
}
