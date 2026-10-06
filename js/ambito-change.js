// Official-edition change detection for planning-ámbito evidence (K7).
//
// Pure deterministic transforms over two explicit edition snapshots. No DOM,
// fetch, clock, browser storage or map dependencies are used here.

export const CHANGE_OUTCOME = Object.freeze({
  NO_CHANGE: "NO_CHANGE",
  STATE_TRANSITION: "STATE_TRANSITION",
  NEW_AMBITO: "NEW_AMBITO",
  ABSENT_FROM_EDITION: "ABSENT_FROM_EDITION",
  MODIFIED_BY_INSTRUMENT: "MODIFIED_BY_INSTRUMENT",
  CAUSE_UNRESOLVED: "CAUSE_UNRESOLVED",
  NON_COMPARABLE: "NON_COMPARABLE",
});

export const CHANGE_OUTCOMES = Object.freeze(Object.values(CHANGE_OUTCOME));

export const BUILDABILITY_STATE = Object.freeze({
  NO_CHANGE: "NO_CHANGE",
  OBSERVED_PUBLISHED_DIFFERENCE: "OBSERVED_PUBLISHED_DIFFERENCE",
  WITHHELD: "WITHHELD",
});

export const COMPARISON_BASIS =
  "Source-stated reference date and full SHA-256 fingerprint within one schema era; entity identity is scoped to each edition.";

export const MODIFICATION_CAVEAT =
  "Comparison may not be like-for-like across this planning instrument modification.";

export const K7_PAIR = Object.freeze({
  previous: "2025-07-01",
  current: "2026-01-01",
});

const S1_PHASE_KEYS = Object.freeze([
  "planeamiento",
  "gestion",
  "urbanizacion_proyecto",
  "urbanizacion_obras",
]);

const USE_CLASS_COLUMNS = Object.freeze({
  colectiva_residencial: "Colectiva. Edif. Residencial",
  unifamiliar_residencial: "Unifamiliar. Edif. Residencial",
  industrial: "Edif. Industrial",
  terciario: "Edif. Terciario",
});

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function copyPlain(value) {
  if (Array.isArray(value)) return value.map(copyPlain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyPlain(item)]));
  }
  return value;
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function editionIdentity(edition) {
  return edition && typeof edition.snapshot_identity === "string" ? edition.snapshot_identity : null;
}

function validFingerprint(edition) {
  return typeof edition?.sha256 === "string" && /^[a-f\d]{64}$/i.test(edition.sha256);
}

function pairGuard(previous, current, family = null) {
  if (!previous || !current || typeof previous !== "object" || typeof current !== "object") {
    return { ok: false, reason: "Both named edition records are required." };
  }
  const previousFamily = previous.family;
  const currentFamily = current.family;
  if (!previousFamily || previousFamily !== currentFamily || (family && family !== previousFamily)) {
    return { ok: false, reason: "The editions do not identify the same source family." };
  }
  if (!isDate(previous.reference_date) || !isDate(current.reference_date)) {
    return { ok: false, reason: "Both source-stated reference dates are required." };
  }
  if (previous.reference_date >= current.reference_date) {
    return { ok: false, reason: "The named editions must have distinct, ordered reference dates." };
  }
  if (!editionIdentity(previous) || !editionIdentity(current) || !validFingerprint(previous) || !validFingerprint(current)) {
    return { ok: false, reason: "Both edition identities and full fingerprints are required." };
  }
  if (editionIdentity(previous) === editionIdentity(current) || previous.sha256 === current.sha256) {
    return { ok: false, reason: "The same edition cannot be supplied twice." };
  }
  if (!previous.schema_era || !current.schema_era || previous.schema_era !== current.schema_era) {
    return { ok: false, reason: "The editions belong to different or unspecified schema eras." };
  }
  if (!previous.records || typeof previous.records !== "object" || !current.records || typeof current.records !== "object") {
    return { ok: false, reason: "Both edition record sets are required." };
  }
  return { ok: true, reason: null };
}

/** Comparison-only key. Source strings remain untouched in all returned evidence. */
export function cosmeticComparisonKey(value) {
  if (typeof value !== "string") return null;
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("en-US");
}

function entityKey(edition, exactCode) {
  const identity = editionIdentity(edition);
  if (!identity || typeof exactCode !== "string" || exactCode.length === 0) return null;
  return `${identity}:${exactCode}`;
}

/** Return an immutable edition-scoped identity containing the exact code. */
export function editionEntityIdentity(edition, exactCode) {
  return entityKey(edition, exactCode);
}

/** A bare code is not resolvable where an edition identity is required. */
export function resolveEditionEntity(edition, identityKey) {
  const identity = editionIdentity(edition);
  if (!identity || typeof identityKey !== "string") return null;
  const prefix = `${identity}:`;
  if (!identityKey.startsWith(prefix)) return null;
  const exactCode = identityKey.slice(prefix.length);
  if (!exactCode || !edition.records || !Object.hasOwn(edition.records, exactCode)) return null;
  return edition.records[exactCode];
}

function getEntity(edition, exactCode) {
  const key = entityKey(edition, exactCode);
  if (!key) return undefined;
  const value = resolveEditionEntity(edition, key);
  return value === null ? undefined : value;
}

function sorted(values) {
  return [...values].sort((a, b) => String(a).localeCompare(String(b), "en"));
}

function unique(values) {
  return sorted([...new Set(values)]);
}

function sourceValue(row, field) {
  const verbatim = row?.source_verbatim?.[field];
  if (typeof verbatim === "string") return verbatim;
  const direct = row?.[field];
  return typeof direct === "string" ? direct : "";
}

function phaseEntries(record) {
  if (!record || !record.phases || typeof record.phases !== "object") return null;
  const fields = S1_PHASE_KEYS.map((key) => {
    const phase = record.phases[key];
    if (!phase || !["PUBLISHED", "NOT_PUBLISHED"].includes(phase.state)) return null;
    const raw = record.source_verbatim?.phase_values?.[key];
    const value = typeof raw === "string" ? raw : (typeof phase.source_value === "string" ? phase.source_value : "");
    return { key, state: phase.state, value, comparisonKey: cosmeticComparisonKey(value) };
  });
  return fields.some((field) => !field) ? null : fields;
}

function s2Rows(record) {
  if (!Array.isArray(record) || record.some((row) => !row || typeof row !== "object")) return null;
  return record.map((row, index) => ({
    source: row,
    index,
    sourceRow: row.source_row ?? index,
    situation: sourceValue(row, "situacion"),
    notes: sourceValue(row, "observaciones"),
    situationKey: cosmeticComparisonKey(sourceValue(row, "situacion")),
  }));
}

function rowCorrespondence(previousRows, currentRows) {
  const pairs = [];
  const matchedPrevious = new Set();
  const matchedCurrent = new Set();
  const reasons = [];

  // A sole row on each side has a unique code-scoped correspondence for the
  // status reading. Buildability still requires matching situation values.
  if (previousRows.length === 1 && currentRows.length === 1) {
    pairs.push({ previousIndex: 0, currentIndex: 0, basis: "SINGLE_ROW_PER_EDITION" });
    matchedPrevious.add(0);
    matchedCurrent.add(0);
  } else {
    const groups = (rows) => {
      const result = new Map();
      rows.forEach((row, index) => {
        const key = row.situationKey;
        const list = result.get(key) || [];
        list.push(index);
        result.set(key, list);
      });
      return result;
    };
    const before = groups(previousRows);
    const after = groups(currentRows);
    for (const key of unique([...before.keys(), ...after.keys()])) {
      const left = before.get(key) || [];
      const right = after.get(key) || [];
      if (key && left.length === 1 && right.length === 1) {
        pairs.push({ previousIndex: left[0], currentIndex: right[0], basis: "UNIQUE_SITUACION_KEY" });
        matchedPrevious.add(left[0]);
        matchedCurrent.add(right[0]);
      } else if (left.length > 1 || right.length > 1) {
        reasons.push("Duplicate situation labels prevent a defensible one-to-one row correspondence.");
      }
    }
    if (previousRows.some((row) => !row.situationKey) || currentRows.some((row) => !row.situationKey)) {
      reasons.push("A published row has no usable SITUACION DEL ÁMBITO identity.");
    }
    if (matchedPrevious.size !== previousRows.length || matchedCurrent.size !== currentRows.length) {
      reasons.push("One or more published rows have no counterpart in the other edition.");
    }
  }

  const unmatchedPrevious = previousRows.flatMap((row, index) => matchedPrevious.has(index) ? [] : [{
    sourceRow: row.sourceRow,
    situation: row.situation,
    sourceVerbatim: copyPlain(row.source.source_verbatim || {}),
  }]);
  const unmatchedCurrent = currentRows.flatMap((row, index) => matchedCurrent.has(index) ? [] : [{
    sourceRow: row.sourceRow,
    situation: row.situation,
    sourceVerbatim: copyPlain(row.source.source_verbatim || {}),
  }]);
  return {
    pairs: pairs.map((pair) => ({
      ...pair,
      previous: previousRows[pair.previousIndex],
      current: currentRows[pair.currentIndex],
    })),
    unmatchedPrevious,
    unmatchedCurrent,
    outcome: reasons.length ? CHANGE_OUTCOME.CAUSE_UNRESOLVED : "ROW_MATCHED",
    reason: unique(reasons).join(" ") || null,
  };
}

function baseResult(previous, current, exactCode, family, guard) {
  return {
    outcome: guard.ok ? CHANGE_OUTCOME.NO_CHANGE : CHANGE_OUTCOME.NON_COMPARABLE,
    family: previous?.family || family || null,
    exactCode: typeof exactCode === "string" ? exactCode : null,
    entityIdentity: {
      previous: entityKey(previous, exactCode),
      current: entityKey(current, exactCode),
    },
    pairIdentity: {
      previous: editionIdentity(previous),
      current: editionIdentity(current),
    },
    dates: { previous: previous?.reference_date ?? null, current: current?.reference_date ?? null },
    schemaEra: { previous: previous?.schema_era ?? null, current: current?.schema_era ?? null },
    comparisonBasis: COMPARISON_BASIS,
    comparabilityVerdict: guard.ok ? "COMPARABLE_WITHIN_SCHEMA_ERA" : "NON_COMPARABLE",
    reason: guard.reason,
    evidence: null,
    cosmeticOnly: false,
    instrument: null,
    modificationCaveat: null,
  };
}

function instrumentFor(events, previous, current, exactCode, changedFields) {
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    if (!event || event.applicable !== true || event.entity_code !== exactCode) continue;
    if (!isDate(event.effective_date) || event.effective_date <= previous.reference_date || event.effective_date >= current.reference_date) continue;
    if (typeof event.instrument_reference !== "string" || !event.instrument_reference.trim()) continue;
    if (typeof event.source_evidence !== "string" || !event.source_evidence.trim()) continue;
    if (!Array.isArray(event.affected_fields) || !event.affected_fields.some((field) => changedFields.includes(field))) continue;
    return event;
  }
  return null;
}

function attachInstrument(result, event) {
  result.outcome = CHANGE_OUTCOME.MODIFIED_BY_INSTRUMENT;
  result.instrument = {
    reference: event.instrument_reference,
    effectiveDate: event.effective_date,
    sourceEvidence: event.source_evidence,
  };
  result.modificationCaveat = MODIFICATION_CAVEAT;
  result.reason = "A dated, applicable planning instrument event is documented for a compared field.";
}

/** Classify one exact code across two named editions. Every call has one outcome. */
export function classifyAmbitoEditionPair(previous, current, exactCode, { instrumentEvents = [], absenceReasons = {} } = {}) {
  const guard = pairGuard(previous, current);
  const result = baseResult(previous, current, exactCode, previous?.family, guard);
  if (!guard.ok) return deepFreeze(result);
  if (typeof exactCode !== "string" || exactCode.length === 0) {
    result.outcome = CHANGE_OUTCOME.NON_COMPARABLE;
    result.comparabilityVerdict = "NON_COMPARABLE";
    result.reason = "An exact edition-scoped ámbito code is required.";
    return deepFreeze(result);
  }

  const before = getEntity(previous, exactCode);
  const after = getEntity(current, exactCode);
  if (before === undefined && after === undefined) {
    result.reason = "Neither named edition publishes a record for this exact code.";
    result.evidence = { membership: "ABSENT_IN_BOTH_EDITIONS" };
    return deepFreeze(result);
  }
  if (before === undefined) {
    result.outcome = CHANGE_OUTCOME.NEW_AMBITO;
    result.reason = "The exact code is present in the later named edition and absent from the earlier named edition.";
    result.evidence = { previous: null, current: copyPlain(after) };
    return deepFreeze(result);
  }
  if (after === undefined) {
    result.outcome = CHANGE_OUTCOME.ABSENT_FROM_EDITION;
    result.reason = "The exact code is present in the earlier named edition and absent from the later named edition.";
    const absenceReason = copyPlain(absenceReasons?.[exactCode] ?? null);
    result.evidence = {
      previous: copyPlain(before),
      current: null,
      absenceReason,
      causeStatus: absenceReason ? "SOURCE_DOCUMENTED" : "CAUSE_UNRESOLVED",
    };
    return deepFreeze(result);
  }

  let changedFields = [];
  const cosmeticDifferences = [];
  if (previous.family === "S1") {
    const beforePhases = phaseEntries(before);
    const afterPhases = phaseEntries(after);
    if (!beforePhases || !afterPhases) {
      result.outcome = CHANGE_OUTCOME.CAUSE_UNRESOLVED;
      result.reason = "A phase record does not carry the four required published fields.";
      result.evidence = { previous: copyPlain(before), current: copyPlain(after) };
      return deepFreeze(result);
    }
    const currentByKey = new Map(afterPhases.map((entry) => [entry.key, entry]));
    const differences = [];
    for (const previousPhase of beforePhases) {
      const currentPhase = currentByKey.get(previousPhase.key);
      const same = previousPhase.state === currentPhase.state && previousPhase.comparisonKey === currentPhase.comparisonKey;
      if (!same) {
        changedFields.push(previousPhase.key);
        differences.push({
          field: previousPhase.key,
          previous: previousPhase.value,
          current: currentPhase.value,
          previousState: previousPhase.state,
          currentState: currentPhase.state,
        });
      } else if (previousPhase.value !== currentPhase.value) {
        cosmeticDifferences.push({ field: previousPhase.key, previous: previousPhase.value, current: currentPhase.value });
      }
    }
    result.evidence = {
      phaseDifferences: differences,
      verbatimPhaseValues: {
        previous: beforePhases.map(({ key, value }) => ({ key, value })),
        current: afterPhases.map(({ key, value }) => ({ key, value })),
      },
      cosmeticTextDifferences: cosmeticDifferences,
    };
  } else if (previous.family === "S2") {
    const beforeRows = s2Rows(before);
    const afterRows = s2Rows(after);
    if (!beforeRows || !afterRows) {
      result.outcome = CHANGE_OUTCOME.CAUSE_UNRESOLVED;
      result.reason = "A published row set is malformed and cannot be classified.";
      result.evidence = { previous: copyPlain(before), current: copyPlain(after) };
      return deepFreeze(result);
    }
    const correspondence = rowCorrespondence(beforeRows, afterRows);
    const oneToOne = beforeRows.length === 1 && afterRows.length === 1;
    const stateChanges = [];
    const noteChanges = [];
    for (const pair of correspondence.pairs) {
      const previousSituationKey = pair.previous.situationKey;
      const currentSituationKey = pair.current.situationKey;
      if (oneToOne && previousSituationKey !== currentSituationKey) {
        changedFields.push("situation");
        stateChanges.push({
          field: "SITUACION DEL ÁMBITO",
          previous: pair.previous.situation,
          current: pair.current.situation,
          rowMatching: pair.basis,
        });
      }
      const previousNoteKey = cosmeticComparisonKey(pair.previous.notes);
      const currentNoteKey = cosmeticComparisonKey(pair.current.notes);
      if (previousNoteKey !== currentNoteKey) {
        changedFields.push("observaciones");
        noteChanges.push({
          previous: pair.previous.notes,
          current: pair.current.notes,
          previousSourceRow: pair.previous.sourceRow,
          currentSourceRow: pair.current.sourceRow,
          rowMatching: pair.basis,
        });
      } else if (pair.previous.notes !== pair.current.notes) {
        cosmeticDifferences.push({
          field: "OBSERVACIONES",
          previous: pair.previous.notes,
          current: pair.current.notes,
          previousSourceRow: pair.previous.sourceRow,
          currentSourceRow: pair.current.sourceRow,
          rowMatching: pair.basis,
        });
      }
      if (pair.previous.situation !== pair.current.situation && previousSituationKey === currentSituationKey) {
        cosmeticDifferences.push({
          field: "SITUACION DEL ÁMBITO",
          previous: pair.previous.situation,
          current: pair.current.situation,
          previousSourceRow: pair.previous.sourceRow,
          currentSourceRow: pair.current.sourceRow,
          rowMatching: pair.basis,
        });
      }
    }
    if (correspondence.outcome === CHANGE_OUTCOME.CAUSE_UNRESOLVED) changedFields.push("row_correspondence");
    result.evidence = {
      previousRowCount: beforeRows.length,
      currentRowCount: afterRows.length,
      situationDifferences: stateChanges,
      situations: {
        previousVerbatim: beforeRows.map((row) => row.situation),
        currentVerbatim: afterRows.map((row) => row.situation),
        matched: correspondence.pairs.map((pair) => ({
          basis: pair.basis,
          previous: pair.previous.situation,
          current: pair.current.situation,
          previousSourceRow: pair.previous.sourceRow,
          currentSourceRow: pair.current.sourceRow,
        })),
        unmatchedPrevious: correspondence.unmatchedPrevious,
        unmatchedCurrent: correspondence.unmatchedCurrent,
      },
      observations: {
        previousVerbatim: beforeRows.map((row) => row.notes),
        currentVerbatim: afterRows.map((row) => row.notes),
        substantiveDifferences: noteChanges,
      },
      rowCorrespondence: {
        outcome: correspondence.outcome,
        reason: correspondence.reason,
        matchingBasis: "Exact ámbito code plus unique, stable SITUACION DEL ÁMBITO value within each edition.",
      },
      cosmeticTextDifferences: cosmeticDifferences,
    };
    result.cosmeticOnly = changedFields.length === 0 && cosmeticDifferences.length > 0;
  } else {
    result.outcome = CHANGE_OUTCOME.NON_COMPARABLE;
    result.comparabilityVerdict = "NON_COMPARABLE";
    result.reason = "The source family has no K7 classifier contract.";
    result.evidence = { previous: copyPlain(before), current: copyPlain(after) };
    return deepFreeze(result);
  }

  if (changedFields.length > 0) {
    const event = instrumentFor(instrumentEvents, previous, current, exactCode, changedFields);
    if (event) attachInstrument(result, event);
    else if (changedFields.includes("situation") || (previous.family === "S1" && changedFields.some((field) => S1_PHASE_KEYS.includes(field)))) {
      result.outcome = CHANGE_OUTCOME.STATE_TRANSITION;
      result.reason = previous.family === "S1"
        ? "One or more published S1 phase values differ between the editions."
        : "The sole published S2 situation value differs between the editions.";
    } else {
      result.outcome = CHANGE_OUTCOME.CAUSE_UNRESOLVED;
      result.reason = changedFields.includes("row_correspondence")
        ? "One or more published S2 rows has no defensible counterpart; the editions do not establish a planning event."
        : "A substantive published note differs and the editions do not establish why.";
    }
  } else {
    result.outcome = CHANGE_OUTCOME.NO_CHANGE;
    result.reason = "No substantive difference was detected in the fields with a defensible comparison.";
  }
  return deepFreeze(result);
}

function buildabilityPairs(previousRows, currentRows) {
  const group = (rows) => {
    const result = new Map();
    rows.forEach((row, index) => {
      const key = row.situationKey;
      const list = result.get(key) || [];
      list.push(index);
      result.set(key, list);
    });
    return result;
  };
  const before = group(previousRows);
  const after = group(currentRows);
  const pairs = [];
  const matchedPrevious = new Set();
  const matchedCurrent = new Set();
  const reasons = [];
  for (const key of unique([...before.keys(), ...after.keys()])) {
    const left = before.get(key) || [];
    const right = after.get(key) || [];
    if (key && left.length === 1 && right.length === 1) {
      pairs.push({ previousIndex: left[0], currentIndex: right[0], situationKey: key, basis: "UNIQUE_SITUACION_KEY" });
      matchedPrevious.add(left[0]);
      matchedCurrent.add(right[0]);
    } else if (left.length > 1 || right.length > 1) {
      reasons.push("Duplicate situation labels prevent a defensible numeric row match.");
    }
  }
  if (previousRows.some((row) => !row.situationKey) || currentRows.some((row) => !row.situationKey)) {
    reasons.push("A row lacks a usable published situation identity.");
  }
  const unmatchedPrevious = previousRows.flatMap((row, index) => matchedPrevious.has(index) ? [] : [{ index, sourceRow: row.sourceRow, situation: row.situation }]);
  const unmatchedCurrent = currentRows.flatMap((row, index) => matchedCurrent.has(index) ? [] : [{ index, sourceRow: row.sourceRow, situation: row.situation }]);
  if (unmatchedPrevious.length || unmatchedCurrent.length) reasons.push("One or more rows has no one-to-one counterpart; numeric comparison is withheld for those rows.");
  return { pairs, unmatchedPrevious, unmatchedCurrent, reasons: unique(reasons) };
}

function numericCell(row, useClass) {
  const cell = row?.use_classes?.[useClass];
  if (!cell || cell.state !== "PUBLISHED" || typeof cell.value !== "number" || !Number.isFinite(cell.value)) return null;
  if (cell.unit !== "m² edificable" || cell.source_column !== USE_CLASS_COLUMNS[useClass]) return null;
  return cell;
}

/** Compare S2 numbers only for exact-code, uniquely situation-matched rows. */
export function compareBuildability(previous, current, exactCode, { instrumentEvents = [] } = {}) {
  const guard = pairGuard(previous, current, "S2");
  const dates = { previous: previous?.reference_date ?? null, current: current?.reference_date ?? null };
  const pairIdentity = { previous: editionIdentity(previous), current: editionIdentity(current) };
  const withheld = (reason, details = {}) => deepFreeze({
    state: BUILDABILITY_STATE.WITHHELD,
    exactCode: typeof exactCode === "string" ? exactCode : null,
    dates,
    pairIdentity,
    comparabilityVerdict: guard.ok ? "COMPARABLE_WITHIN_SCHEMA_ERA" : "NON_COMPARABLE",
    reason,
    rowMatching: details.rowMatching || { basis: null, reason },
    observedDifferenceCount: 0,
    withheldCellCount: 0,
    differences: details.differences || [],
  });
  if (!guard.ok) return withheld(guard.reason);
  if (typeof exactCode !== "string" || !exactCode) return withheld("An exact edition-scoped code is required.");
  const beforeEntity = getEntity(previous, exactCode);
  const afterEntity = getEntity(current, exactCode);
  if (!Array.isArray(beforeEntity) || !Array.isArray(afterEntity)) {
    return withheld("Both named editions must publish S2 rows for this exact code.");
  }
  const beforeRows = s2Rows(beforeEntity);
  const afterRows = s2Rows(afterEntity);
  const match = buildabilityPairs(beforeRows, afterRows);
  const differences = [];
  let observedDifferenceCount = 0;
  let withheldCellCount = 0;
  const issues = [...match.reasons];

  const eventsForUse = (useClass) => instrumentFor(
    instrumentEvents,
    previous,
    current,
    exactCode,
    ["buildability", useClass, USE_CLASS_COLUMNS[useClass]],
  );

  for (const pair of match.pairs) {
    const oldRow = beforeRows[pair.previousIndex];
    const newRow = afterRows[pair.currentIndex];
    const useClasses = [];
    for (const useClass of Object.keys(USE_CLASS_COLUMNS)) {
      const instrument = eventsForUse(useClass);
      const oldCell = numericCell(oldRow.source, useClass);
      const newCell = numericCell(newRow.source, useClass);
      if (instrument || !oldCell || !newCell) {
        const reason = instrument
          ? `Withheld across ${instrument.instrument_reference}; the published values may not be like-for-like.`
          : "Both editions must publish numeric values for the same documented use class; blank is not zero.";
        withheldCellCount += 1;
        issues.push(reason);
        useClasses.push({
          useClass,
          state: BUILDABILITY_STATE.WITHHELD,
          reason,
          previous: copyPlain(oldRow.source.use_classes?.[useClass] ?? null),
          current: copyPlain(newRow.source.use_classes?.[useClass] ?? null),
          instrument: instrument ? { reference: instrument.instrument_reference, effectiveDate: instrument.effective_date } : null,
        });
        continue;
      }
      const difference = newCell.value - oldCell.value;
      const state = difference === 0 ? BUILDABILITY_STATE.NO_CHANGE : BUILDABILITY_STATE.OBSERVED_PUBLISHED_DIFFERENCE;
      if (state === BUILDABILITY_STATE.OBSERVED_PUBLISHED_DIFFERENCE) observedDifferenceCount += 1;
      useClasses.push({
        useClass,
        state,
        previous: { value: oldCell.value, unit: oldCell.unit, sourceColumn: oldCell.source_column },
        current: { value: newCell.value, unit: newCell.unit, sourceColumn: newCell.source_column },
        observedDifference: difference,
      });
    }
    differences.push({
      rowMatching: pair.basis,
      situationKey: pair.situationKey,
      situationVerbatim: { previous: oldRow.situation, current: newRow.situation },
      previousSourceRow: oldRow.sourceRow,
      currentSourceRow: newRow.sourceRow,
      useClasses,
    });
  }

  const addUnmatched = (rows, side) => {
    for (const unmatched of rows) {
      const row = side === "previous" ? beforeRows[unmatched.index] : afterRows[unmatched.index];
      const reason = "This published row has no defensible counterpart in the other edition.";
      for (const useClass of Object.keys(USE_CLASS_COLUMNS)) {
        withheldCellCount += 1;
      }
      differences.push({
        rowMatching: "WITHHELD",
        unmatchedEdition: side,
        situationVerbatim: { [side]: row.situation },
        sourceRow: row.sourceRow,
        reason,
        useClasses: Object.keys(USE_CLASS_COLUMNS).map((useClass) => ({
          useClass,
          state: BUILDABILITY_STATE.WITHHELD,
          reason,
          sourceValue: copyPlain(row.source.use_classes?.[useClass] ?? null),
        })),
      });
    }
  };
  addUnmatched(match.unmatchedPrevious, "previous");
  addUnmatched(match.unmatchedCurrent, "current");

  const state = withheldCellCount > 0
    ? BUILDABILITY_STATE.WITHHELD
    : observedDifferenceCount > 0
      ? BUILDABILITY_STATE.OBSERVED_PUBLISHED_DIFFERENCE
      : BUILDABILITY_STATE.NO_CHANGE;
  return deepFreeze({
    state,
    exactCode,
    dates,
    pairIdentity,
    comparabilityVerdict: "COMPARABLE_WITHIN_SCHEMA_ERA",
    rowMatching: {
      basis: "Exact code plus a unique, stable SITUACION DEL ÁMBITO value within each edition.",
      previousRowCount: beforeRows.length,
      currentRowCount: afterRows.length,
      matchedRowCount: match.pairs.length,
      unmatchedPrevious: match.unmatchedPrevious,
      unmatchedCurrent: match.unmatchedCurrent,
      reasons: match.reasons,
    },
    reason: state === BUILDABILITY_STATE.WITHHELD ? unique(issues).join(" ") || "At least one numeric comparison is withheld." : null,
    observedDifferenceCount,
    withheldCellCount,
    differences,
  });
}

function countsFor(records) {
  return Object.fromEntries(CHANGE_OUTCOMES.map((outcome) => [outcome, records.filter((record) => record.outcome === outcome).length]));
}

/** Row-preserving production classification over the exact-code union. */
export function auditEditionPair(previous, current, { instrumentEvents = [], absenceReasons = {} } = {}) {
  const guard = pairGuard(previous, current);
  if (!guard.ok) return deepFreeze({ comparabilityVerdict: "NON_COMPARABLE", reason: guard.reason, counts: null, cosmeticOnlyCount: null, records: [] });
  const codes = unique([...Object.keys(previous.records), ...Object.keys(current.records)]);
  const records = codes.map((code) => classifyAmbitoEditionPair(previous, current, code, { instrumentEvents, absenceReasons }));
  return deepFreeze({
    comparabilityVerdict: "COMPARABLE_WITHIN_SCHEMA_ERA",
    pairIdentity: { previous: editionIdentity(previous), current: editionIdentity(current) },
    dates: { previous: previous.reference_date, current: current.reference_date },
    counts: countsFor(records),
    cosmeticOnlyCount: records.filter((record) => record.cosmeticOnly).length,
    records,
  });
}

function legacyFold(value) {
  return cosmeticComparisonKey(typeof value === "string" ? value : "");
}

function legacyFirstRow(record) {
  return Array.isArray(record) ? record[0] : null;
}

/** Reproduce Gate L's old code-level audit. S2's first-row rule is audit-only. */
export function auditLegacyGateLPair(previous, current) {
  const guard = pairGuard(previous, current);
  if (!guard.ok) return deepFreeze({ comparabilityVerdict: "NON_COMPARABLE", reason: guard.reason, counts: null, cosmeticOnlyCount: null, records: [] });
  const codes = unique([...Object.keys(previous.records), ...Object.keys(current.records)]);
  const records = codes.map((exactCode) => {
    const before = getEntity(previous, exactCode);
    const after = getEntity(current, exactCode);
    const base = baseResult(previous, current, exactCode, previous.family, guard);
    if (before === undefined && after === undefined) {
      base.reason = "Neither edition carries this code.";
    } else if (before === undefined) {
      base.outcome = CHANGE_OUTCOME.NEW_AMBITO;
      base.reason = "Absent from the earlier edition and present in the later edition.";
    } else if (after === undefined) {
      base.outcome = CHANGE_OUTCOME.ABSENT_FROM_EDITION;
      base.reason = "Present in the earlier edition and absent from the later edition.";
    } else if (previous.family === "S1") {
      const left = phaseEntries(before);
      const right = phaseEntries(after);
      if (!left || !right) {
        base.outcome = CHANGE_OUTCOME.CAUSE_UNRESOLVED;
        base.reason = "Legacy audit could not read the four phase fields.";
      } else {
        const diffs = left.filter((phase, index) => phase.comparisonKey !== right[index].comparisonKey);
        const cosmetic = left.filter((phase, index) => phase.value !== right[index].value && phase.comparisonKey === right[index].comparisonKey);
        base.outcome = diffs.length ? CHANGE_OUTCOME.STATE_TRANSITION : CHANGE_OUTCOME.NO_CHANGE;
        base.cosmeticOnly = !diffs.length && cosmetic.length > 0;
        base.evidence = { phaseDifferences: diffs.map((phase) => ({ field: phase.key, previous: phase.value, current: right.find((item) => item.key === phase.key).value })) };
        if (diffs.length) base.reason = "At least one published phase value differs.";
        else base.reason = "No substantive published phase difference was detected.";
      }
    } else if (previous.family === "S2") {
      const left = legacyFirstRow(before);
      const right = legacyFirstRow(after);
      const leftSituation = sourceValue(left, "situacion");
      const rightSituation = sourceValue(right, "situacion");
      const leftNotes = sourceValue(left, "observaciones");
      const rightNotes = sourceValue(right, "observaciones");
      const stateChanged = legacyFold(leftSituation) !== legacyFold(rightSituation);
      const notesChanged = legacyFold(leftNotes) !== legacyFold(rightNotes);
      const cosmetic = !stateChanged && !notesChanged && (leftSituation !== rightSituation || leftNotes !== rightNotes);
      base.outcome = stateChanged ? CHANGE_OUTCOME.STATE_TRANSITION : notesChanged ? CHANGE_OUTCOME.CAUSE_UNRESOLVED : CHANGE_OUTCOME.NO_CHANGE;
      base.cosmeticOnly = cosmetic;
      base.reason = stateChanged
        ? "Legacy Gate L first-row code-level situation value differs."
        : notesChanged
          ? "Legacy Gate L notes differ without a situation difference."
          : "Legacy Gate L found no substantive first-row code-level difference.";
      base.evidence = {
        selection: "LEGACY_AUDIT_ONLY_FIRST_SOURCE_ROW_PER_CODE",
        previous: { situation: leftSituation, observations: leftNotes, sourceRow: left?.source_row ?? null },
        current: { situation: rightSituation, observations: rightNotes, sourceRow: right?.source_row ?? null },
      };
    } else {
      base.outcome = CHANGE_OUTCOME.NON_COMPARABLE;
      base.comparabilityVerdict = "NON_COMPARABLE";
      base.reason = "No legacy classification contract exists for this family.";
    }
    return deepFreeze(base);
  });
  return deepFreeze({
    auditMode: "LEGACY_GATE_L_CODE_LEVEL_REPRODUCTION",
    rowPolicy: previous.family === "S2" ? "FIRST_ROW_PER_CODE_FOR_LEGACY_REPRODUCTION_ONLY" : "ONE_S1_ROW_PER_CODE",
    comparabilityVerdict: "COMPARABLE_WITHIN_SCHEMA_ERA",
    pairIdentity: { previous: editionIdentity(previous), current: editionIdentity(current) },
    dates: { previous: previous.reference_date, current: current.reference_date },
    counts: countsFor(records),
    cosmeticOnlyCount: records.filter((record) => record.cosmeticOnly).length,
    records,
  });
}

/** Compare Gate L's audit-only result to the K6 row-preserving production result. */
export function reconcileEditionPair(previous, current, { instrumentEvents = [], absenceReasons = {} } = {}) {
  const legacy = auditLegacyGateLPair(previous, current);
  const production = auditEditionPair(previous, current, { instrumentEvents, absenceReasons });
  if (legacy.comparabilityVerdict !== "COMPARABLE_WITHIN_SCHEMA_ERA" || production.comparabilityVerdict !== "COMPARABLE_WITHIN_SCHEMA_ERA") {
    return deepFreeze({ comparabilityVerdict: "NON_COMPARABLE", legacy, production, divergences: [] });
  }
  const productionByCode = new Map(production.records.map((record) => [record.exactCode, record]));
  const divergences = legacy.records.flatMap((legacyRecord) => {
    const productionRecord = productionByCode.get(legacyRecord.exactCode);
    if (!productionRecord) return [];
    const rowIssue = productionRecord.evidence?.rowCorrespondence?.outcome === CHANGE_OUTCOME.CAUSE_UNRESOLVED;
    const differs = legacyRecord.outcome !== productionRecord.outcome ||
      legacyRecord.cosmeticOnly !== productionRecord.cosmeticOnly || rowIssue;
    if (!differs) return [];
    const numeric = previous.family === "S2"
      ? compareBuildability(previous, current, legacyRecord.exactCode, { instrumentEvents })
      : null;
    return [{
      exactCode: legacyRecord.exactCode,
      legacy: copyPlain(legacyRecord),
      production: copyPlain(productionRecord),
      rowReconciliation: {
        ...copyPlain(productionRecord.evidence?.rowCorrespondence ?? {}),
        previousRowCount: productionRecord.evidence?.previousRowCount ?? null,
        currentRowCount: productionRecord.evidence?.currentRowCount ?? null,
        matchedSituations: copyPlain(productionRecord.evidence?.situations?.matched ?? []),
        unmatchedPrevious: copyPlain(productionRecord.evidence?.situations?.unmatchedPrevious ?? []),
        unmatchedCurrent: copyPlain(productionRecord.evidence?.situations?.unmatchedCurrent ?? []),
      },
      buildability: numeric ? copyPlain(numeric) : null,
    }];
  });
  return deepFreeze({
    family: previous.family,
    referenceDates: { previous: previous.reference_date, current: current.reference_date },
    pairIdentity: { previous: editionIdentity(previous), current: editionIdentity(current) },
    comparisonBasis: COMPARISON_BASIS,
    comparabilityVerdict: "COMPARABLE_WITHIN_SCHEMA_ERA",
    legacy: {
      auditMode: legacy.auditMode,
      rowPolicy: legacy.rowPolicy,
      counts: copyPlain(legacy.counts),
      cosmeticOnlyCount: legacy.cosmeticOnlyCount,
    },
    production: {
      rowPolicy: previous.family === "S2" ? "PRESERVE_ALL_ROWS_MATCH_UNIQUE_SITUACION_ONLY" : "ONE_EXACT_CODE_ROW_PER_EDITION",
      counts: copyPlain(production.counts),
      cosmeticOnlyCount: production.cosmeticOnlyCount,
    },
    divergenceCount: divergences.length,
    divergences,
  });
}

/** Build one immutable comparison consumed by citizen and analyst readings. */
export function buildAmbitoComparison({ previous, current, exactCode, instrumentEvents = [], absenceReasons = {} } = {}) {
  const families = ["S1", "S2"];
  const checks = families.map((family) => pairGuard(previous?.families?.[family], current?.families?.[family], family));
  const comparable = checks.every((check) => check.ok);
  const state = {};
  for (const family of families) {
    state[family] = classifyAmbitoEditionPair(
      previous?.families?.[family],
      current?.families?.[family],
      exactCode,
      { instrumentEvents, absenceReasons },
    );
  }
  const s2Buildability = comparable
    ? compareBuildability(previous.families.S2, current.families.S2, exactCode, { instrumentEvents })
    : deepFreeze({
        state: BUILDABILITY_STATE.WITHHELD,
        exactCode,
        dates: { previous: previous?.reference_date ?? null, current: current?.reference_date ?? null },
        comparabilityVerdict: "NON_COMPARABLE",
        reason: checks.find((check) => !check.ok)?.reason || "The edition pair is not comparable.",
        differences: [],
      });

  const metadata = (edition) => {
    if (!edition) return null;
    const { records: _records, ...record } = edition;
    return copyPlain(record);
  };
  const comparison = {
    exactCode: typeof exactCode === "string" ? exactCode : null,
    comparisonBasis: COMPARISON_BASIS,
    comparabilityVerdict: comparable ? "COMPARABLE_WITHIN_SCHEMA_ERA" : "NON_COMPARABLE",
    reason: checks.find((check) => !check.ok)?.reason || null,
    dates: {
      previous: previous?.reference_date ?? null,
      current: current?.reference_date ?? null,
    },
    pairIdentity: Object.fromEntries(families.map((family) => [family, {
      previous: editionIdentity(previous?.families?.[family]),
      current: editionIdentity(current?.families?.[family]),
    }])),
    editions: {
      previous: Object.fromEntries(families.map((family) => [family, metadata(previous?.families?.[family])])),
      current: Object.fromEntries(families.map((family) => [family, metadata(current?.families?.[family])])),
    },
    state,
    buildability: s2Buildability,
  };
  return deepFreeze(comparison);
}

/** Two projections, one source object. Neither projection recalculates evidence. */
export function projectAmbitoChangeReading(comparison, audience = "citizen") {
  if (!comparison || !["citizen", "analyst"].includes(audience)) {
    throw new TypeError("projectAmbitoChangeReading requires a comparison and a citizen or analyst audience.");
  }
  const common = {
    exactCode: comparison.exactCode,
    dates: copyPlain(comparison.dates),
    comparabilityVerdict: comparison.comparabilityVerdict,
    outcomes: Object.fromEntries(Object.entries(comparison.state).map(([family, result]) => [family, result.outcome])),
    reasons: Object.fromEntries(Object.entries(comparison.state).map(([family, result]) => [family, result.reason])),
    evidence: Object.fromEntries(Object.entries(comparison.state).map(([family, result]) => [family, copyPlain(result.evidence)])),
    buildability: {
      state: comparison.buildability.state,
      reason: comparison.buildability.reason,
      differences: copyPlain(comparison.buildability.differences),
    },
  };
  if (audience === "citizen") return deepFreeze(common);
  return deepFreeze({
    ...common,
    comparisonBasis: comparison.comparisonBasis,
    pairIdentity: copyPlain(comparison.pairIdentity),
    editions: copyPlain(comparison.editions),
    stateDetails: copyPlain(comparison.state),
    buildabilityDetails: copyPlain(comparison.buildability),
  });
}
