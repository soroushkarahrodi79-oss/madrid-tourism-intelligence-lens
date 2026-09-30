# Hospitality & Commercial Context — methodology gate

**This document is opened at Gate A and populated only for Gate A — Unit &
Identity.** The taxonomy (B), status semantics (C), temporal comparability (D),
geography reconciliation (E) and denominator (F) gates are deliberately left
unwritten. Writing their conclusions now, before their evidence exists, is the
error this gate discipline exists to prevent.

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
