# Hospitality & Commercial Context — methodology gate

**This document is populated for Gate A — Unit & Identity, Gate B — Activity
Taxonomy and Gate C — Status Semantics.** The temporal comparability (D), geography
reconciliation (E) and denominator (F) gates are deliberately left unwritten.
Writing their conclusions now, before their evidence exists, is the error this gate
discipline exists to prevent. (Gate B renumbers the later gates' evidence questions
onto C–F; issue #33's original letters are preserved.)

Nothing here builds a UI, a map layer, an indicator, a score, a ranking or a
denominator, and nothing here changes HATI, Destination Context, Area Profile,
population, VUT or any existing production dataset. It is research.

The reproducible evidence lives in
[`research/hospitality_commercial_gate/`](../research/hospitality_commercial_gate/).
Every count below is produced by
[`audit_identity.py`](../research/hospitality_commercial_gate/audit_identity.py)
and stored in
[`results/gate_a_identity_summary.json`](../research/hospitality_commercial_gate/results/gate_a_identity_summary.json).
None were typed by hand.

---

## Gate A — Unit & Identity

### The single question

> Can the same local/premises and its associated activities be tracked between
> consecutive monthly snapshots using a stable, source-native identifier — without
> relying on names, addresses, coordinates or fuzzy matching?

### A.0 · Retrieval date/time

Audited on **2026-09-30** (UTC timestamps recorded per resource in the results
file). Fetched directly from `datos.madrid.es`. The Gate C0 network block of
2026-09-30 was an environment-specific egress policy; this audit ran from an
environment where `datos.madrid.es` was reachable, and records a SHA-256 for every
file so the exact upstream state is verifiable.

### A.1 · Source files examined

Dataset: **Censo de locales, sus actividades y terrazas de hostelería y
restauración — histórico**, `datos.madrid.es`
`209548-0-censo-locales-historico`, licence **CC BY 4.0**, catalogue state
`2026-09-28T15:40:59` at audit time.

The dataset publishes four monthly resource families (Actividades, Locales,
Locales con información de licencia, Terrazas). Gate A examines **Locales** and
**Actividades** only. Licencias and Terrazas were **not** fetched.

Structure document read in full:
[`estructura_ds_ficherocla.pdf`](https://datos.madrid.es/dataset/209548-0-censo-locales-historico/resource/209548-403-censo-locales-historico/download/estructura_ds_ficherocla.pdf)
— *"Datos abiertos: Censo de Locales y Actividades", versión mar/2022*. One
document governs **both** the Locales and Actividades files.

### A.2 · Exact resource months

Resolved deterministically by exact `description` match (the only field carrying
family + month; unique per resource). Opaque numeric ids are recorded, not used to
select.

| Family | Month | Resource id | Bytes | SHA-256 (head) | HTTP Last-Modified |
|---|---|---|---:|---|---|
| Locales | Sep 2026 | 209548-851 | 89,266,582 | `2475e8bcff7d` | Thu 03 Sep 2026 06:18 |
| Locales | Aug 2026 | 209548-839 | 89,296,127 | `906a02b2a5a2` | Mon 28 Sep 2026 15:43 |
| Locales | Sep 2025 | 209548-726 | 89,900,542 | `a9b5571a86eb` | Mon 16 Feb 2026 00:52 |
| Actividades | Sep 2026 | 209548-857 | 124,927,121 | `47185269efe6` | Thu 03 Sep 2026 06:45 |
| Actividades | Aug 2026 | 209548-845 | 125,004,408 | `ca31fbef1c06` | Mon 28 Sep 2026 15:28 |
| Actividades | Sep 2025 | 209548-35 | 126,043,844 | `cd7f232695700` | Sun 15 Feb 2026 23:53 |

> **A published-cut caveat that must travel with these two months.** The file
> *labelled* "Agosto 2026" carries a **later** HTTP `Last-Modified` (28 Sep 2026)
> than the one labelled "Septiembre 2026" (03 Sep 2026). The month label is the
> reference period; the timestamp is when the file was last served. They do not
> contradict the identity findings, but they mean the *direction* of the Aug→Sep
> churn in A.4 reflects this particular pair's cut timing, not a clean calendar
> delta. The Sep 2025 → Sep 2026 control is the cleaner longitudinal picture.

### A.3 · Row / unit semantics

The structure document is explicit, and the data confirm it exactly.

- **Locales — one row is one premises (`local`).** *"Fichero de locales en el que
  cada registro corresponde a un local."* Confirmed: in every snapshot the row
  count equals the distinct `id_local` count with zero duplicates and zero blanks
  (Sep 2026: 203,610 rows / 203,610 distinct).
- **Actividades — one row is one premises × one activity epigraph.** *"Cada
  registro corresponde a un local más un código de actividad… si un local tiene
  asociado más de un epígrafe de actividad, dicho local aparecerá repetido tantas
  veces como epígrafes tenga."* Confirmed: Sep 2026 has 225,556 rows, of which
  187,484 locals carry one activity and 16,126 carry more than one (max 14).

The two files share the same premises block and the same premises universe: in
Sep 2026, **0** Actividades rows reference an `id_local` absent from the Locales
file (referential integrity holds).

`one local ≠ one activity row` — as the gate anticipated. Premises identity and
activity identity therefore need **different keys**, established next.

### A.4 · Candidate identifiers and uniqueness

| Candidate | File | Semantics | Uniqueness (Sep 2026) | Verdict |
|---|---|---|---|---|
| **`id_local`** | Locales | documented premises code | 203,610 / 203,610 distinct, 0 blank, 0 dup | **premises key** |
| **`(id_local, id_epigrafe)`** | Actividades | premises × epigraph | 225,556 / 225,556 distinct, 0 dup pairs; but 53,242 rows have a **blank** epigraph | **classified-activity key** — valid only where `id_epigrafe` is populated (172,314 rows); blank rows are **not** an activity identity (A.9, A.10) |
| `id_local` alone | Actividades | — | repeats by design (1 per epigraph) | not a row key here |
| `id_ndp_edificio` (address) | Locales | building address code | 40,588 addresses hold >1 local; max 264 | rejected (A.6) |
| coordinates | Locales | approx. entrance UTM | one pair `(0.0,0.0)` shared by 50,808 | rejected (A.6) |
| `rotulo` (name) | Locales | commercial sign | 53,244 blank; `"S/R"` on 11,454 | rejected (A.6) |

`id_local` is documented as *"Código numérico que identifica cada local"*, derived
from `id_ndp_edificio` + `secuencial_local_PC` (puerta de calle) or from
agrupación + planta + local (agrupado) — an address-anchored construction, which
is consistent with the empirical stability below.

### A.5 · Cross-month persistence

**Premises (`id_local`), Locales, Aug → Sep 2026:**

- Aug 203,680 → Sep 203,610; intersection **203,610**; persistence **99.966%**.
- 70 disappeared, 0 appeared (see the published-cut caveat, A.2).
- Of 203,610 persistent premises, only **688 changed any tracked attribute while
  `id_local` stayed identical**: rótulo 623, situación 123 (e.g. 80 Cerrado→Abierto,
  28 Abierto→Cerrado), coordinates 11, building/number 5. This is the crux: the key
  is stable *while* descriptive attributes move. Identity is not a description.

**Premises (`id_local`), Locales, Sep 2025 → Sep 2026 control:**

- Sep 2025 202,346 → Sep 2026 203,610; intersection **202,343**; persistence
  **99.999%** — only **3** premises from a year earlier are absent, 1,267 new.
- This holds **across a format change**: the 2025 file is unquoted, the 2026 file
  quotes every field (A.7). The source-native key survives it intact; a
  line/string identity would have matched nothing.

**Activity (`id_local, id_epigrafe`), Actividades, Aug → Sep 2026:**

- 225,689 → 225,556 pairs; intersection **224,983**; pair persistence **99.687%**.
- 706 pairs left, 573 appeared — activities churn on premises that themselves
  persist (the premises `id_local` persistence is the same 99.966%). New activities
  attach to existing locals; this is coherent, expected behaviour, not instability.
- This persistence is a property of the *pair*; it does not resolve the 53,242
  blank-epigraph rows, whose pair is `(id_local, "")` and whose meaning is a Gate B
  question (A.9, A.10).

> **Direction caveat (both files, Aug → Sep 2026).** The pair is valid for identity
> *persistence* testing, but the appeared/disappeared *direction* must not be read as
> clean calendar-month churn: the published resource timing is inverted (A.2), so
> September is a near-subset of August. The Sep 2025 → Sep 2026 control is the
> representative directional delta.

### A.6 · Negative controls — why weaker identities are rejected

Each was tested on the real Sep 2026 Locales file, not merely asserted.

- **Name (`rotulo`).** 53,244 of 203,610 rows blank; the single value `"S/R"`
  covers 11,454 premises, `"ROTULO NO INFORMADO"` 4,848, `"VIVIENDAS TURISTICAS"`
  2,878 — and the accented/unaccented pair `"RÓTULO NO INFORMADO"` (1,679) vs the
  unaccented form shows the same concept spelled two ways. Unusable as identity.
- **Full address (`id_ndp_edificio`).** 40,588 addresses legitimately hold more
  than one local; one building address holds 264. A building is not a premises.
- **Coordinates.** "No coordinate" is encoded as the sentinel `(0.0, 0.0)`, shared
  by 50,808 locals; agrupados share their agrupación's single coordinate. Only
  137,245 distinct pairs for 203,610 locals. Unusable.
- **Concatenated descriptive fields / fuzzy matching.** Since name, address and
  coordinates each fail individually, and 688 persistent premises change one or
  more of exactly these fields month-to-month (A.5), any string concatenation of
  them is *both* non-unique *and* non-stable. No fuzzy matching is used anywhere;
  the source-native key makes it unnecessary.

### A.7 · Schema / format drift observed (documented, not normalised away)

The mar/2022 structure document and the 2025–2026 files disagree on form, though
not on the identity fields:

- **Delimiter.** Document says `|`; the 2025–2026 files use `;`.
- **Quoting.** 2026 files quote every field and carry a UTF-8 BOM; the Sep 2025
  file is unquoted (still BOM-prefixed). The audit detects dialect per file.
- **Field name.** Document writes `ide_epigrafe`; the files use `id_epigrafe`.
- **Coordinates.** Document lists a single `coordenadas x-y_local`; the files split
  it into `coordenada_x_local` and `coordenada_y_local`.
- **Undocumented columns.** `cod_postal`, `hora_apertura1/2`, `hora_cierre1/2` and
  a per-row load date `fx_carga` appear in the files but not the mar/2022 document.
- **Undocumented access type.** `id_tipo_acceso_local = 3` ("Interior", 51,455 rows
  in Sep 2026) is not among the document's 0/1/12 codes.
- **Column count is stable across all six files** (Locales 46, Actividades 47), so
  no column-level break exists across the audited window.

None of this alters `id_local` or `(id_local, id_epigrafe)`; it is recorded so a
later gate does not mistake a format change for a real change.

### A.8 · Geography observation (not the geography gate)

Recorded only to answer whether source-native geography exists for later testing.
It does: Locales carries `id_distrito_local`, `id_barrio_local` (which *includes*
the district code), `cod_barrio_local`, `id_seccion_censal_local` and coordinates.
In Sep 2026 the file contains **exactly 131 distinct `id_barrio_local`** and **21
distinct `id_distrito_local`**, with **1** row missing a barrio. The count matches
Lens's canonical 131 barrios and 21 districts — **promising, and to be *tested*,
not assumed, in Gate E.** No reconciliation is built here.

### A.9 · Known uncertainties

1. **Published-cut timing (A.2).** The Aug/Sep 2026 labels do not correspond to a
   clean sequential cut; the "August" file was served later. Aug→Sep new/disappeared
   counts are pair-specific. The 2025→2026 control is the more representative delta.
2. **Blank epigraph — activity semantics UNRESOLVED.** 53,242 Actividades rows in
   Sep 2026 have a blank `id_epigrafe`; for those rows the pair collapses to
   `(id_local, "")`. Row-level uniqueness still holds, but `(id_local, "")` is **not**
   a known activity identity and is not treated as one. This gate does not reinterpret
   the blank, does not assign a placeholder activity category, and does not discard the
   rows. Their meaning is deferred to Gate B. Classified activity identity is asserted
   only for the 172,314 rows whose epigraph is populated.
3. **Situación is a "variable de mantenimiento complicado"** (source's own words):
   there is no procedure that records when an activity ceases and a local closes
   without a new activity appearing. Any use of situación is Gate C; it is out of
   scope for identity.
4. **Records not to be counted as premises.** The source states situación Baja (8,
   12,427) and Baja R (9, 4,114) and access type "PC Asociado" (12, 2,877) *"no
   deben tenerse en cuenta a la hora de extraer datos del número total de locales."*
   Identity is unaffected; any future *count* must apply these exclusions. That is
   a counting rule for a later gate, deliberately not applied here.
5. **Full history untested.** Only three months were examined. The claim is about
   Aug/Sep 2026 with a Sep 2025 control, not about 2014→2026 homogeneity (Gate D).

### A.10 · Gate A ruling — **GO to Gate B, with one explicit scope limitation**

The ruling is deliberately split, because one part of the activity file is not yet
resolvable at Gate A:

| Question | Ruling |
|---|---|
| **Premises identity** — `id_local` | **GO** |
| **Classified activity identity** — `(id_local, id_epigrafe)` *where `id_epigrafe` is populated* | **GO** |
| **Blank-epigraph activity semantics** — the 53,242 Sep 2026 rows with a blank `id_epigrafe` | **UNRESOLVED — deferred to Gate B** |
| **Overall Gate A** | **GO to Gate B**, subject to the limitation above |

- **Premises key: `id_local`** — unique within every snapshot (0 duplicate, 0
  blank), 99.966% persistent Aug→Sep 2026 and 99.999% across a full year, stable
  under both descriptive-attribute drift and a CSV formatting change.
- **Classified activity key: `(id_local, id_epigrafe)` where the epigraph is
  populated** — the pair is unique within every snapshot (0 duplicate pairs);
  172,314 of the 225,556 Sep 2026 rows carry a populated epigraph, and 99.687% of
  the Aug→Sep pairs persist, with activity churn correctly localised onto persistent
  premises.
- **Blank-epigraph rows are NOT a known activity identity.** For the 53,242 Sep 2026
  rows with a blank `id_epigrafe`, the pair collapses to `(id_local, "")`. This gate
  does **not** call that an activity identity, does **not** reinterpret the blank,
  does **not** invent a placeholder activity category, and does **not** discard the
  rows. What they represent is a taxonomy/semantics question that belongs to Gate B.
- **Row unit — Locales:** one premises. **Actividades:** one premises × activity
  epigraph. Documented and confirmed.
- Every weaker identity (name, address, coordinates, concatenation, fuzzy) is shown
  to be non-unique, non-stable, or both.

The same local/premises **can** be followed reproducibly between monthly snapshots
using its source-native identifier, and so can each of its *classified* activities.
Gate A is satisfied for identity; the blank-epigraph rows are the one carve-out
handed forward to Gate B.

**What GO does not authorise.** No indicator, count, taxonomy, denominator, map or
status interpretation is admitted by this ruling. A premises census record remains
administrative evidence — not economic vitality, not commercial success, not visitor
demand, not tourism pressure, and not evidence that a documented premises is trading
today. GO means only that identity is solved well enough for the next gate to begin.

### Recommendation for Gate B (taxonomy)

Gate B should read the official three-level epigraph classification (Sección 21 /
División / Epígrafe) and define a reproducible hostelería/restauración and
commercial subset. Two facts from this audit bound that work: the files carry **453
distinct epigraphs and 86 divisions** in Sep 2026 (the mar/2022 document says 448
and 87 — the taxonomy has drifted and must be read live, not from the PDF), and
**53,242 activity rows carry a blank epigraph** and must be handled explicitly
rather than silently dropped or bucketed.

---

## Gate B — Activity Taxonomy

The reproducible evidence for this section is produced by
[`audit_taxonomy.py`](../research/hospitality_commercial_gate/audit_taxonomy.py)
and stored in
[`results/gate_b_taxonomy.json`](../research/hospitality_commercial_gate/results/gate_b_taxonomy.json)
(full per-epigraph mapping) and
[`results/gate_b_taxonomy_summary.json`](../research/hospitality_commercial_gate/results/gate_b_taxonomy_summary.json).
Every count below is produced by that script from the live source and stored in
those files; none were typed by hand. The audit reuses the Gate A source contract
(catalogue resolution by exact `description`, streamed fingerprinting, per-file
dialect detection) by importing the Gate A helpers, so both gates provably read the
same upstream the same way.

### B.0 · Scope

Gate B resolves **one** question: *which official activity epigraphs can support a
defensible Hospitality & Commercial Context classification, and which cannot?* It
builds a classification **layer** only. It does **not** build an indicator, count,
ranking, score, denominator, map, or any "pressure", "overtourism", "saturation" or
"commercial vitality" claim. An activity record remains administrative evidence — it
is not revenue, turnover, employment, footfall, demand, popularity, commercial
health, economic success, tourist use, tourist expenditure, visitor pressure, legal
compliance, or proof that a premises is trading today. Central location is not read
as tourist orientation, and hospitality presence is not read as tourist demand.

The taxonomy is read **live** from the primary snapshot **Actividades. Septiembre
2026** (resource `209548-857`, SHA-256 head `47185269efe6`), with **Actividades.
Septiembre 2025** (resource `209548-35`, SHA-256 head `cd7f23269570`) as a
drift/control snapshot. Only these two Actividades files are fetched; no years of
history are downloaded, and no raw CSV is committed.

### B.1 · Observed taxonomy

The primary snapshot carries a clean three-level hierarchy. Read live:

| Quantity | Sep 2026 (live) |
|---|---:|
| Distinct sections (`id_seccion`) | **21** |
| Distinct divisions (`id_division`) | **86** |
| Distinct populated epigraphs (`id_epigrafe`) | **453** |
| Rows total | 225,556 |
| Rows with a populated epigraph | **172,314** |
| Rows with a blank epigraph | **53,242** |

For every populated epigraph the report records its `id_seccion`, `desc_seccion`,
`id_division`, `desc_division`, `desc_epigrafe`, activity-row count and distinct
`id_local` count.

**One epigraph maps to exactly one parent.** `epigraph_multi_parent_count` is **0**:
no `id_epigrafe` appears under more than one `(id_seccion, id_division)` pair. This is
the fact that makes a hierarchy-based classification safe (Stop condition 2 does not
fire). **One epigraph carries a within-snapshot description inconsistency:** code
`561008` appears as both `ESTABLECIMIENTO DE RESTAURACION MOVIL` and `VENDEDOR
AMBULANTE DE ALIMENTOS PREPARADOS PARA SU CONSUMO INMEDIATO`. Both are food service
under division 56, so the *class* is unaffected; the inconsistency is recorded on the
epigraph record rather than normalised away.

### B.2 · Source hierarchy semantics

The structure document (`estructura_ds_ficherocla.pdf`, versión mar/2022), section
IV, is explicit, and the live data confirms it:

- **Epígrafe is an administrative code, not an operational label.** Activities are
  coded by *"una clasificación propia del Ayuntamiento que parte de los antiguos
  epígrafes de Impuesto de Actividades Económicas (I.A.E.)"*, and the epigraph
  information is provided *"sólo a efectos estadísticos"*. It is derived from a tax
  register lineage; it is not a statement that a business trades, earns or is used.
- **Sección and División are CNAE-09.** The document states the two upper levels
  *"coinciden con los utilizados por la CNAE-09 del INE"* and that *"todos los
  epígrafes de una misma división empiezan por los dos dígitos de división."* So the
  section (a letter) and division (two digits) are **source-stable, INE-aligned
  administrative categories**, and the epigraph code itself begins with its division.
  Classification in Gate B is therefore made on the **official section/division the
  file carries**, never by keyword-matching the free-text description.
- **The PDF counts are stale; the live counts govern.** The mar/2022 document reports
  **21 sections / 87 divisions / 448 epigraphs**; the live Sep 2026 data has **21 /
  86 / 453**. The PDF is not exhaustive and is not used as the taxonomy of record.
- **Mixed sections exist.** Section I (Hostelería) itself contains two very different
  divisions — 55 (alojamiento) and 56 (comidas y bebidas) — and section R mixes
  culture, sport, entertainment and gambling. This is why the classification resolves
  section I and section N at the division level rather than the section level.

### B.3 · Classification framework

Six analytical classes (issue #33's letters A–F), assigned on the CNAE
section/division, plus a separate label for the blank rows. No class is a binary
"tourism / not tourism" variable.

| Class | Meaning | Source-native rule |
|---|---|---|
| **A · Core hospitality / restoration** | Food and beverage service | Division **56** |
| **B · Accommodation** | Lodging (kept separate from A, and from VUT / Madrid Destino) | Division **55** |
| **C · Tourism-adjacent commercial context** | Not inherently a tourist business but defensibly destination-relevant | Division **79** |
| **D · Generic commercial context** | Documented commerce, background composition only | Section **G** (div 45/46/47) |
| **E · Excluded** | Outside a Hospitality & Commercial Context reading | All other sections + Z (SIN ACTIVIDAD) |
| **F · Ambiguous / manual review** | Semantics do not permit a confident class | Section **R** (div 90/91/92/93) |
| *(separate)* **UNCLASSIFIED_SOURCE_ACTIVITY** | Blank epigraph — a premises with no activity classification recorded | blank `id_epigrafe` |

The assignment is a rule on the official code (`DIVISION_OVERRIDE` for 55/56/79, else
`SECTION_DEFAULT`), so every one of the 453 epigraphs is auditable to its CNAE parent.
Programmatic grouping assists review; it is not a black-box authority, and there is no
keyword-only production rule. The six classes **partition** the populated universe
exactly: 21 + 9 + 1 + 158 + 241 + 23 = **453** epigraphs and 22,762 + 8,092 + 837 +
53,575 + 82,768 + 4,280 = **172,314** rows.

Per-class rollup (Sep 2026). *Distinct-premises counts are a union within each class
and deliberately do **not** sum across classes — a premises may host activities in
more than one class:*

| Class | Epigraphs | Source rows | Distinct premises |
|---|---:|---:|---:|
| CORE_HOSPITALITY (56) | 21 | 22,762 | 21,552 |
| ACCOMMODATION (55) | 9 | 8,092 | 8,007 |
| TOURISM_ADJACENT (79) | 1 | 837 | 837 |
| GENERIC_COMMERCIAL (G) | 158 | 53,575 | 44,433 |
| EXCLUDED | 241 | 82,768 | 77,652 |
| AMBIGUOUS (R) | 23 | 4,280 | 3,997 |

### B.4 · Core hospitality / restoration

**Division 56 — Servicios de comidas y bebidas.** 21 epigraphs, 22,762 activity
rows, 21,552 distinct premises. This is the food-and-beverage core: restaurants,
fast food, cafés/bars, catering and mobile food service all sit under one CNAE
division whose code prefix is unambiguous (`56xxxx`). The defensible management
question this supports is bounded: *"how much administratively documented
food-and-beverage activity is recorded in a barrio?"* — not how much it earns, how
busy it is, or whether it serves tourists. **GO.**

### B.5 · Accommodation

**Division 55 — Servicios de alojamiento.** 9 epigraphs, 8,092 activity rows, 8,007
distinct premises. Lodging is a **separate** class from food/beverage: CNAE places
hotels, hostels and other lodging in division 55, distinct from 56. Examples include
`HOTELES Y MOTELES CON/SIN RESTAURANTE`.

This class is census-**activity** evidence and is a **different evidence universe**
from the project's licensed-VUT numerator and from the Madrid Destino accommodation
catalogue. It must **not** be merged with them; any later reconciliation is a separate
decision-module task with explicit compatibility logic. As a class, it is defensible
and cleanly source-native. **GO** (as a distinct class, with the no-merge condition).

### B.6 · Tourism-adjacent commercial context

**Division 79 — Agencias de viajes, operadores turísticos y servicios de reservas.**
1 epigraph, 837 rows, 837 premises. This is the one category that is both
destination-facing and cleanly isolable by a source-native code. It is admitted
because a real management question justifies it (documented travel-trade presence),
not because it contains the word "turístico".

No other category is admitted to C. Section R (culture, entertainment, sport,
gambling) is a *candidate* — museums, shows and sports venues are plausibly
destination-relevant — but the section is heterogeneous and no source-native sub-code
isolates the tourism-facing part, so it is held in F, not forced into C. **GO for
division 79 only; MODIFY** if C is to be broadened, which would require an explicit
management question and, ideally, a source-native way to isolate the relevant subset.

### B.7 · Generic commercial context

**Section G — Comercio al por mayor y al por menor; reparación de vehículos.** 158
epigraphs, 53,575 rows, 44,433 premises (divisions 45 vehicle sales/repair, 46
wholesale, 47 retail). This is the barrio's documented commercial composition, with no
tourism-specific interpretation. It supports the question *"what is the documented
commercial composition of the barrio?"* — background only. **GO.**

The boundary between D and E is, beyond section G, a **scope decision, not a taxonomy
fact.** Several excluded sections are consumer-facing and could be folded into a
broader "commercial composition" if a management question warranted it — finance and
insurance branches (K, div 64/65/66), real-estate agencies (L, div 68), and repair and
other personal services (S, div 95/96). The report flags these divisions as
`broader_composition_candidate` rather than silently discarding them. They are not
included in the confirmed commercial class here.

### B.8 · Blank epigraph analysis

**53,242 rows carry a blank `id_epigrafe` — the single most important finding of Gate
B.** What was learned:

1. **The whole taxonomy is blank, not just the epigraph.** In all 53,242 rows,
   `id_seccion`, `id_division` and all three descriptions are empty as well. There is
   **no higher hierarchy level to fall back to** — a blank epigraph cannot be rescued
   to a section or division.
2. **It is one row per premises, and never co-occurs with a classified activity.**
   53,242 distinct `id_local`; `locals_blank_only_no_populated = 53,242`;
   `locals_blank_and_also_populated = 0`. A premises either carries classified
   activities **or** appears once with an entirely blank taxonomy — never both.
3. **It is not merely "closed".** Situación skews to Cerrado (24,046), Baja (9,069),
   Uso vivienda (7,396) and Baja R (1,704) — but **11,027 are "Abierto"** (open,
   with declared economic activity per the source) yet carry no activity code. So the
   blank is genuinely an *absent classification*, not a synonym for a closed premises.
4. **It is spread across the whole city** — present in all 131 barrios — so it is not
   a localised artefact.
5. **The source documentation does not define it.** The structure PDF describes every
   field but never says what an empty epigraph means. The characterisation above is
   therefore **empirical only**.
6. **A higher-level classification is not supported** (point 1), and the rows must not
   be invented into an epigraph, assigned "unknown hospitality", bucketed, discarded,
   or treated as the activity identity `(id_local, "")`.

**Ruling for the blank set — split: handling RESOLVED, source semantics UNRESOLVED.**
The *empirical handling* is **RESOLVED**: the set is fully characterised (points 1–4
above) and carried under the project label **`UNCLASSIFIED_SOURCE_ACTIVITY`** — a
premises-level "no activity classification recorded" set, explicitly outside classes
A–F and **not an activity**, distinct from section **Z "SIN ACTIVIDAD"** (4,402 rows
under code `000000`), which is an explicit **populated** "no activity" code classified
as Excluded. The *source semantics* are **UNRESOLVED**: the official documentation
never defines an empty epigraph (point 5), so **why** these records carry no taxonomy
is not stated by the source and is not asserted here. `UNCLASSIFIED_SOURCE_ACTIVITY`
is therefore a **project handling label, not an official source meaning**. The blank
set must be carried explicitly through any later premises-level counting and **never
silently dropped** from a denominator.

### B.9 · Taxonomy drift

Sep 2025 → Sep 2026, taxonomy stability only (not a trend claim; full comparability
is a later gate):

| Check | Result |
|---|---|
| Epigraphs present in both | **453** |
| New epigraph codes in 2026 | **0** |
| Disappeared epigraph codes | **0** |
| Same code, changed description | **0** |
| Same code, changed division/section | **0** |
| Distinct sections | 21 → 21 |
| Distinct divisions | 86 → 86 |
| Blank-epigraph share | 24.08% → 23.60% |

The taxonomy is **stable across this one-year pair**: identical code set, identical
descriptions, identical parents, identical section/division counts, and a
near-constant blank share (~24%). The only drift observed anywhere is the **PDF vs
live** discrepancy (87→86 divisions, 448→453 epigraphs) noted in B.2, which is a
documentation-lag artefact, not a change between the two live snapshots. No claim is
made about the 2014→2025 history, which is not examined here.

### B.10 · Interpretation limits

- The classification is a **layer**, not a verdict. It labels what kind of activity a
  code represents; it does not measure how much, how busy, how profitable, or how
  touristic.
- **Counts are not yet admitted.** The per-class row and premises counts in B.3 are
  observations that describe the taxonomy's shape; they are not a barrio indicator and
  carry no denominator. The source's own counting rules (situación Baja 8/9 and access
  type 12 *"no deben tenerse en cuenta a la hora de extraer datos del número total de
  locales"*) are a Gate C/F concern and are **not** applied here.
- **Accommodation (B) must not be merged** with licensed-VUT or Madrid Destino
  evidence; they are different universes.
- The **blank set** must remain visible in any later premises-level denominator.
- Central location, hospitality density and status are **not** admitted as evidence of
  tourist demand, pressure or economic strength.

### B.11 · Gate B ruling — **GO to Gate C, with scoped sub-rulings**

| Question | Ruling |
|---|---|
| **Core hospitality / restoration** — division 56 | **GO** |
| **Accommodation** — division 55 | **GO** (distinct class; no merge with VUT / Madrid Destino) |
| **Tourism-adjacent commercial context** — division 79 | **GO** (division 79 only); **MODIFY** to broaden (needs a management question) |
| **Generic commercial context** — section G | **GO** |
| **Blank-epigraph** — handling | **RESOLVED** — characterised and labelled `UNCLASSIFIED_SOURCE_ACTIVITY` (a project handling label) |
| **Blank-epigraph** — source semantics | **UNRESOLVED** — the official documentation does not define why these records carry no taxonomy |
| **Overall Gate B** | **GO to Gate C**, subject to the scope limitation below |

A defensible hospitality/restoration subset (56), a defensible and *separate*
accommodation subset (55), a clean tourism-adjacent code (79) and a defensible generic
commercial subset (section G) all exist as source-native CNAE categories; the
ambiguous entertainment/culture section (R) is held explicitly for manual review
rather than forced into a tourism class; and the blank rows' *handling* is resolved as
an explicit unclassified set while their *source semantics* remain undefined by the
documentation. No result is hidden under a blanket GO.

**What GO does not authorise.** No indicator, count, ranking, score, denominator, map
or status interpretation is admitted by this ruling. A classification layer is not a
policy verdict.

### Product name (B evaluation)

**Recommendation: keep "Hospitality & Commercial Context."** The taxonomy supports it:
*Hospitality* maps cleanly to CNAE section I (division 56 food/beverage + division 55
accommodation) and *Commercial Context* maps cleanly to CNAE section G (comercio). Both
pillars have defensible source-native definitions. This is recorded as a
recommendation only; production is not renamed here, and the name is valid solely for
the classification layer — never as a tourism-pressure or vitality claim.

### Recommendation for Gate C (status semantics)

Gate C should establish exactly what `id_situacion_local` (Abierto/Cerrado/Uso
vivienda/Obras/Baja/Baja R) can and cannot mean, given the source's own warning that
situación is a *"variable de mantenimiento complicado"* with no procedure to record
when an activity ceases without a replacement. Two Gate B facts bound that work: the
53,242 `UNCLASSIFIED_SOURCE_ACTIVITY` rows carry a situación even with no activity code
(including 11,027 "Abierto"), and the source's exclusion rules for situación 8/9 and
access type 12 are a counting decision that Gate C/F must confront before any premises
count is admitted. Gate C must not translate abierto/cerrado into operating
performance, demand, turnover or commercial success.

---

## Gate C — Status Semantics

The reproducible evidence for this section is produced by
[`audit_status.py`](../research/hospitality_commercial_gate/audit_status.py) and
stored in
[`results/gate_c_status.json`](../research/hospitality_commercial_gate/results/gate_c_status.json)
(full report) and
[`results/gate_c_status_summary.json`](../research/hospitality_commercial_gate/results/gate_c_status_summary.json)
(compact digest). Every count below is produced by that script from the live source
and stored in those files; none were typed by hand. The audit imports the Gate A
helpers (catalogue resolution by exact `description`, streamed fingerprinting,
per-file dialect detection) and the Gate B classification (`classify`, the CNAE
section/division class map), so all three gates provably read the same upstream and
classify activities the same way.

### C.0 · Scope

Gate C resolves **one** question: *what can the administrative status fields
(`id_situacion_local`, `id_tipo_acceso_local`) legitimately tell us about whether a
premises belongs in a future administrative count — and what must they never be read
as?* It establishes a **semantics layer** only. It builds **no** indicator, count
for production, ranking, score, denominator, map, or any "operating business",
"business failure", "economic", "vitality", "saturation" or "tourism-pressure"
claim. A status field is administrative evidence, nothing more.

Three evidence levels are kept in **separate fields** throughout the machine-readable
report and never merged: **(1) source semantics** — what the structure document
actually says; **(2) empirical observation** — what the live data shows; **(3)
project handling / interpretation ceiling** — our analytical decision. A
project-handling label is **not** official source metadata.

Status lives on **Locales** (one row = one premises); taxonomy lives on
**Actividades** (one row = one premises × epigraph). Gate C reads the primary
snapshot **Locales. Septiembre 2026** and **Actividades. Septiembre 2026**, with
**Locales. Septiembre 2025** as a status-mutability control. It does **not** download
the full history — that is Gate D.

> **⚠ `nominal_snapshot_revision` — the "Septiembre 2026" resource was re-published.**
> This is a formal provenance finding, not an incidental note. The resource *labelled*
> "Septiembre 2026" that Gate C read is a **later published revision** of the one Gate
> A/B read: the Sep 2026 Locales fingerprint changed from SHA-256 `2475e8bcff7d…`
> (HTTP `Last-Modified` 03 Sep 2026, 203,610 premises) at the Gate A/B run to
> `4ca33fed004b…` (HTTP `Last-Modified` 01 Oct 2026, **203,688** premises) at the Gate
> C run. Therefore:
>
> 1. Gate C uses a **later published revision** of the resource labelled "Septiembre
>    2026" than Gate A/B did.
> 2. Gate C counts **must not** be numerically compared against the earlier Gate A/B
>    Sep-2026 counts **without using their respective SHA-256 fingerprints**.
> 3. This does **not** invalidate Gate A/B conclusions; those remain valid observations
>    tied to their own recorded SHA-256 upstream states.
> 4. The mutable/revised nature of nominal monthly snapshots is a formal **Gate D**
>    temporal-comparability question.
> 5. **Never treat the month label alone as sufficient version identity** — identity is
>    the (month label + SHA-256 fingerprint) pair.
>
> Counts throughout Gate C are observations of one run against the fingerprinted
> resources recorded in the results file, not repository invariants. The Sep 2025
> control file is byte-for-byte the one Gate A saw (SHA `a9b5571a86eb`). The machine-
> readable form of this finding is `nominal_snapshot_revision` in
> [`gate_c_status.json`](../research/hospitality_commercial_gate/results/gate_c_status.json)
> and its summary.

### C.1 · Status universe

**`id_situacion_local` — complete observed universe (Sep 2026 Locales, 203,688
premises; one row per premises, so rows = distinct `id_local`):**

| Code | Official description | Premises | Share | Source counting instruction |
|---|---|---:|---:|---|
| 1 | Abierto | 139,797 | 68.63% | none |
| 4 | Cerrado | 38,888 | 19.09% | none |
| 5 | Uso vivienda | 8,460 | 4.15% | none |
| 8 | Baja | 12,423 | 6.10% | **exclude from total count** |
| 9 | Baja Reunificación | 4,120 | 2.02% | **exclude from total count** |

**`id_tipo_acceso_local` — complete observed universe:**

| Code | Official description | Premises | Share | Note |
|---|---|---:|---:|---|
| 1 | Puerta Calle | 134,643 | 66.10% | documented |
| 3 | Interior | 51,501 | 25.28% | **UNDOCUMENTED** (see C.10) |
| 0 | Agrupado | 14,663 | 7.20% | documented |
| 12 | PC Asociado | 2,881 | 1.41% | **exclude from total count** |

**Discrepancies vs the structure documentation (recorded, not normalised away):**

- **Code 7 "Obras" is documented but absent** — the structure PDF lists situación 7
  (Local en obras), but the live Sep 2026 snapshot has **0** such rows. Documented ≠
  present; it is reported, not invented.
- **Access code 3 "Interior" is undocumented** — it is 25% of all premises yet the
  mar/2022 structure document's Tipo-acceso table lists only 0/1/12, and the
  document's own extraction note says only Agrupado / Puerta de Calle / PC Asociado
  premises were selected. Its source meaning is **UNRESOLVED**; it is surfaced
  prominently and given no invented meaning.

### C.2 · Official source semantics

Verified **again** against `estructura_ds_ficherocla.pdf` (versión mar/2022),
apartados II and III — not inherited from earlier gates.

| Code | Official description | Documented meaning (verbatim sense) | Counting instruction | Analytical interpretation allowed |
|---|---|---|---|---|
| sit 1 Abierto | Local activo | *"Local activo en el que se desarrolla algún tipo de actividad económica"* | none | administrative **last-recorded** "active"; not verified trading |
| sit 4 Cerrado | Local cerrado (sin actividad) | *"Local en el que en ese momento no se realiza ningún tipo de actividad"* | none | "no activity recorded at the extract moment"; not permanent, no date |
| sit 5 Uso vivienda | Local destinado a vivienda | *"…transformado en vivienda y se utilizan, exclusivamente, como vivienda familiar"* | none | recorded conversion to housing; no economic-cessation date |
| sit 7 Obras | Local en obras | *"Locales en los que se está realizando una reforma"* | none | undergoing works; **absent from this snapshot** |
| sit 8 Baja | Local que ha desaparecido | *"Locales desaparecidos"* | **exclude** | administrative "disappeared"; not a measured business failure |
| sit 9 Baja R | …desaparecido uniéndose a otro | *"Baja o baja por reunificación: Locales desaparecidos"* | **exclude** | administrative merge/reorganisation; not a failure |
| acc 12 PC Asociado | PC asociado | *"No se trata de un local físico… permite diferenciar actividades…"* | **exclude** | non-physical sub-access / double-representation |

Two caveats from the source govern **every** situación value:

- **"Variable de mantenimiento complicado."** Apartado III: *"…no se dispone de
  ninguno [procedimiento] que informe de cuándo una actividad cesa y el local se
  cierra sin aparecer una nueva actividad."* There is no procedure that detects a
  closure without a replacement activity, so any value — Abierto included — can be
  stale.
- **Extraction shows the last status.** *"…mostrándose la última situación del
  local."* Situación is the last recorded state, not a verified real-time status.

### C.3 · Status vs activity taxonomy

Cross-tab of premises status × per-premises taxonomy-record state (classified /
section-Z *SIN ACTIVIDAD* / blank `UNCLASSIFIED_SOURCE_ACTIVITY`), joined on
`id_local`, each premises counted once:

| Situación | CLASSIFIED | SIN_ACTIVIDAD | BLANK | CLASSIFIED+SIN_ACT |
|---|---:|---:|---:|---:|
| 1 Abierto | 126,710 | 2,009 | 11,015 | 63 |
| 4 Cerrado | 13,032 | 1,810 | 24,017 | 29 |
| 5 Uso vivienda | 728 | 342 | 7,390 | 0 |
| 8 Baja | 3,167 | 189 | 9,065 | 2 |
| 9 Baja R | 2,352 | 63 | 1,704 | 1 |

Answers (all from the join, not assumption):

1. **Can `Abierto` coexist with blank taxonomy?** **Yes** — 11,015 Abierto premises
   carry only an `UNCLASSIFIED_SOURCE_ACTIVITY` (blank) taxonomy.
2. **Can `Cerrado` retain populated activity codes?** **Yes** — 13,032 do.
3. **Can `Baja` retain activity codes?** **Yes** — 3,167 (Baja) + 2,352 (Baja R) do.
4. **Can section Z (SIN ACTIVIDAD) coexist with different statuses?** **Yes** — it
   appears under every situación value.
5. **Does administrative status determine taxonomy state?** **No** — every status
   co-occurs with multiple taxonomy states.

**Therefore status and activity classification are separate dimensions and must not
be collapsed.**

### C.4 · Status by Gate B class

Per Gate B class, over its **distinct** premises (a premises may belong to several
classes; it is counted once *within* a class and these do **not** sum across
classes). The purpose is **not** to rank sectors — it is to test whether any class
has a materially different status composition that would make a naive premises count
misleading.

| Gate B class | Distinct premises | Abierto | Cerrado | Uso viv. | Baja | Baja R | Source-excluded (8∪9∪acc12) |
|---|---:|---:|---:|---:|---:|---:|---:|
| CORE_HOSPITALITY (56) | 21,565 | 19,227 | 1,777 | 49 | 163 | 349 | 2,033 |
| ACCOMMODATION (55) | 8,050 | 7,503 | 362 | 70 | 63 | 52 | 131 |
| TOURISM_ADJACENT (79) | 834 | 751 | 50 | 2 | 22 | 9 | 37 |
| GENERIC_COMMERCIAL (G) | 44,411 | 37,588 | 4,696 | 165 | 673 | 1,289 | 2,350 |
| AMBIGUOUS (R) | 4,016 | 3,545 | 338 | 9 | 31 | 93 | 203 |
| EXCLUDED | 77,769 | 65,766 | 8,100 | 780 | 2,426 | 697 | 3,893 |

The composition differs modestly between classes (e.g. generic commerce carries
proportionally more Baja R than accommodation). The finding is only that a naive
total-premises count per class would fold in differing shares of source-excluded
records; it is **not** a vitality, health or ranking statement.

### C.5 · Official counting exclusions

The structure document instructs **exactly three** codes out of a total-premises
count, verified verbatim:

- situación **8 (Baja)** and **9 (Baja R)**: *"Los locales en situación 8 y 9, no
  deben tenerse en cuenta a la hora de extraer datos de número total de locales."*
- access **12 (PC Asociado)**: *"No deben tenerse en cuenta a la hora de extraer
  datos del número total de locales"* because *"No se trata de un local físico."*

The rule applies to **Locales** rows (premises; it speaks of "número total de
locales"), is **unconditional**, and covers **only** these codes — Cerrado, Uso
vivienda and Obras carry no exclusion instruction.

**Sep 2026 impact (audit calculation):**

| Quantity | Premises |
|---|---:|
| Raw premises universe | 203,688 |
| Excluded — situación 8 (Baja) | 12,423 |
| Excluded — situación 9 (Baja R) | 4,120 |
| Excluded — access 12 (PC Asociado) | 2,881 |
| Naïve sum (with double-counting) | 19,424 |
| Overlap: PC Asociado ∩ Baja | 1 |
| Overlap: PC Asociado ∩ Baja R | 14 |
| Overlap: Baja ∩ Baja R | 0 (mutually exclusive) |
| Double-subtraction avoided | 15 |
| **Union excluded** | **19,409** |
| **Remaining after official exclusions** | **184,279** |

> **This is an audit calculation only.** It does **not** authorise a production
> denominator or indicator. Gate F remains the denominator gate. Excluded records
> remain valid historical evidence; exclusion is from a current total-count universe,
> not from the research record.

### C.6 · `Abierto`

Official definition: *"Local activo en el que se desarrolla algún tipo de actividad
económica."* Sep 2026: **139,797** premises (68.6%). Of these, **126,773** carry a
populated classified activity, **11,015** carry a blank-only taxonomy, and **2,072**
carry a section-Z *SIN ACTIVIDAD* row. Abierto premises appear across **every** Gate
B class, including 65,766 in EXCLUDED.

**Does `Abierto` support "currently operating business"? — NO, only as an
administrative status.** The source *does* say Abierto means a premises with economic
activity, but (a) it explicitly warns situación is a *variable de mantenimiento
complicado* with no procedure to detect cessation without a replacement activity, (b)
extraction shows the *última situación* (last recorded, not verified-today), and (c)
11,000+ Abierto premises carry no activity classification at all. Abierto is at most
`ADMINISTRATIVELY_OPEN` (last-recorded active); it is never a verified current-
operation count, and never revenue, demand, footfall or commercial success.

### C.7 · `Cerrado`

**Source semantics (verbatim, apartado III):** *"Local en el que en ese momento no se
realiza ningún tipo de actividad."* This exact wording is the source meaning and is
preserved as such — it is **not** paraphrased into a project phrase. Sep 2026:
**38,888** premises; **13,061** still carry a populated classified activity. No
closure dates are published, and Cerrado is explicitly distinct from Baja
(desaparecido).

**Project interpretation ceiling (separate from the source meaning).** Because
`situación` is a difficult-to-maintain, last-recorded administrative variable and the
source lacks a complete cessation-update procedure, Gate C does **not** treat
`Cerrado` as: independently verified current closure; permanent cessation; business
failure; or economic decline. Activity codes can remain attached and no date exists.

**Can `Cerrado` be read as business cessation or economic failure? — NO (bounded).**
The ruling is NO-GO for all four interpretations above; the verbatim source meaning
stands on its own and is not stretched to cover them.

### C.8 · `Baja` and `Baja R`

Treated separately. **Baja (8):** *"Local que ha desaparecido"*, 12,423 premises,
3,169 still carrying activity codes. **Baja R (9):** *"Local que ha desaparecido
uniéndose a otro"*, 4,120 premises, 2,353 still carrying activity codes. The
distinction **is** documented (9 = disappeared by merging into another); apartado III
groups both as *"Baja o baja por reunificación: Locales desaparecidos."* Both are
**unconditionally excluded** from total-premises counts.

"Desaparecido" is an administrative register event, **not** a measured business
failure or bankruptcy; Baja R in particular is a reorganisation (merge). The records
**remain** in the research artifacts — exclusion from a count is not deletion from the
evidence.

### C.9 · Other statuses

- **Uso vivienda (5):** 8,460 premises. *"Transformado en vivienda… exclusivamente
  como vivienda familiar."* No source exclusion; inclusion as an administrative record
  is defensible, but it is explicitly a premises converted to housing, so folding it
  into a "commercial premises" reading would need its own justification.
- **Obras (7):** documented in the PDF, **0 rows** in this snapshot — reported as
  documented-but-absent, not invented.

### C.10 · Access-type semantics

- **PC Asociado (12):** 2,881 premises (1.4%). *"No se trata de un local físico"* — a
  subordinate access that separates activities of different owners inside one physical
  premises (a double-representation). Excluded from total-premises counts because it
  is **not a premises**, not because of any status or economic signal. Its overlap
  with the status exclusions (1 also Baja, 14 also Baja R) is handled so it is never
  double-subtracted (C.5).
- **Interior (3):** 51,501 premises (25.3%), **undocumented** (C.1). It is not named
  in any exclusion rule, so the explicit rules leave it in the counted universe, but
  any future count **must** flag it. Gate C invents no meaning for it; its source
  semantics are UNRESOLVED.
- **Agrupado (0)** and **Puerta Calle (1):** carry no special counting instruction.

### C.11 · Temporal transition control

Sep 2025 → Sep 2026, persistent premises (stable `id_local`): **202,343**; situación
unchanged for **200,693**. Observed transitions include Abierto→Cerrado **867**,
Cerrado→Abierto **489**, Abierto→Baja R **77**, **Baja→Abierto 60**, Baja
R→Abierto **5**, Abierto→Baja **4**, Uso vivienda→other **22**.

Statuses behave like **mutable administrative attributes**: the same persistent
premises carries different situación values across snapshots in both directions —
including "disappeared" premises (Baja/Baja R) reverting to Abierto, which a literal
"disappeared" reading could not produce. Transitions are **not** read as real
business openings or closures. Two snapshots only; full historical comparability
(field/code/format homogeneity across the whole series) remains **Gate D**.

### C.12 · Permissible counting language

Project handling labels — each explicitly distinguished from source terminology, none
asserting that a premises trades today:

| Project label | Rule | Source basis | Interpretation ceiling | Usable later? |
|---|---|---|---|---|
| `SOURCE_INCLUDED_PREMISES` | all − (sit∈{8,9} ∪ acc=12) | explicit source instruction | administrative records the source does not exclude; not a trading count | **yes** |
| `SOURCE_EXCLUDED_PREMISES` | sit∈{8,9} ∪ acc=12 | explicit source instruction | disappeared premises + non-physical sub-accesses; kept in the record | **yes** |
| `ADMINISTRATIVELY_OPEN` | sit=1 | code 1 only | last-recorded "active"; **not** current operation | **MODIFY** — status descriptor only, caveat must travel |
| `STATUS_UNCERTAIN` | disclaimer, not a subset | the maintenance caveat | the register cannot certify real-time operation for any premises | no (a disclaimer) |

### C.13 · Interpretation limits

This evidence can **never**, on its own, claim: that any premises is trading today; a
count of active businesses; a count of business failures or closures; economic
decline, growth, success or commercial health; commercial vitality, saturation,
tourism pressure or overtourism; demand, turnover, revenue, footfall or visitor
numbers.

It **can** support: the number of premises remaining after the source's explicit
exclusion rules; the administrative status composition of documented
hospitality/commercial premises; how much of the source universe is administratively
unresolved or unclassified.

### C.14 · Gate C ruling — **GO to Gate D, with scoped sub-rulings**

| Question | Ruling |
|---|---|
| **`Abierto`** as a current-operation proxy | **NO-GO** (administrative status only; maintenance caveat applies) |
| **`Cerrado`** as business-cessation / failure evidence | **NO-GO** (bounded; "no activity recorded at extract", no date, not permanent) |
| **`Baja` / `Baja R`** as explicit source exclusions | **GO** (unconditional source instruction; records retained) |
| **`PC Asociado`** as an explicit source exclusion | **GO** (not a physical premises) |
| **Source-excluded premises universe** as a reproducible administrative filtering rule | **GO** (research filtering rule, overlaps handled; **not** a production denominator — Gate F) |
| **Economic interpretation** | **NO-GO** (no status field supports trading/demand/success/failure/vitality/saturation) |
| **Overall Gate C** | **GO to Gate D** |

Mixed sub-rulings are the intended outcome: administrative filtering is **GO**,
current-operation inference is **NO-GO**, economic interpretation is **NO-GO**, and
the gate as a whole is **GO to Gate D**.

**What GO does not authorise.** No indicator, production count, ranking, score,
denominator, map or economic/operating reading is admitted. A status field is
administrative evidence; the source's own exclusion rules are reproducible, but
nothing here says a documented premises is trading, has failed, or carries any
economic meaning.

### Recommendation for Gate D (temporal comparability)

Gate D should test field/code/format homogeneity across the **whole** published
series (not the three months examined here), establish the earliest defensible
comparison window, and treat status transitions strictly as mutable administrative-
attribute changes — never as real openings/closures. Two Gate C facts bound that
work: situación is the *última situación* and a *variable de mantenimiento
complicado* (so cross-month deltas are register-update deltas, not events), and the
live data already departs from the mar/2022 document (undocumented access code 3,
absent situación 7), so category vocabularies must be read live per snapshot, not
assumed stable from the PDF.
