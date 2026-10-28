// UX-C2 — in-page containment audit for the right analytical panel.
//
// `PANEL_AUDIT` is serialised into the page by Playwright, so it must stay
// self-contained (no imports, no closures over module scope). It measures real
// layout — getBoundingClientRect, clientWidth/scrollWidth, computed padding and
// border — and never inspects CSS source text.
//
// Every visible element under `root` is compared against the CONTENT BOX of its
// layout parent (border + padding + scrollbar removed). Findings are classified:
//
//   escape      the element's border box leaves its parent's content box
//   spill       overflow:visible content wider than the element's own box
//   clip        overflow:hidden/clip (or ellipsis) hiding part of its own content
//   hscroll     a horizontal scroller whose content is wider than its viewport
//   asymmetry   a box that fills its parent but is unevenly inset left vs right
//   focus-clip  a focused control whose outline is cut off horizontally
//
// Regions that are SUPPOSED to scroll are listed in DESIGNED_HSCROLL and are
// reported separately (as `designed`), never silently dropped. Vertical scroll
// is never a finding: the panel and its capped lists are designed vertical
// scrollers; only the horizontal axis is audited.
export const DESIGNED_HSCROLL = [
  // Wide comparison / data tables scroll horizontally inside their own wrapper
  // so the panel never has to.
  ".comparetable-wrap",
  ".ambito-qty-wrap",
  ".domestic-origin-table-wrap",
  ".planning-change-analyst-data",
];

export const PANEL_AUDIT = ({ rootSelector, designed, includeFocus }) => {
  const root = document.querySelector(rootSelector);
  if (!root) return { error: `missing ${rootSelector}` };
  const num = (v) => parseFloat(v) || 0;
  const visible = (el) => {
    if (!(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  };
  const label = (el) => {
    const parts = [];
    for (let n = el; n && n !== root.parentElement && parts.length < 4; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += `#${n.id}`;
      else if (typeof n.className === "string" && n.className.trim()) s += `.${n.className.trim().split(/\s+/).slice(0, 2).join(".")}`;
      parts.unshift(s);
      if (n.id) break;
    }
    return parts.join(" > ");
  };
  const contentBox = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const bl = num(cs.borderLeftWidth), br = num(cs.borderRightWidth);
    const pl = num(cs.paddingLeft), pr = num(cs.paddingRight);
    const sb = Math.max(0, el.offsetWidth - el.clientWidth - bl - br);
    // The scrollbar sits on the right in LTR; both layouts are LTR here.
    return { left: r.left + bl + pl, right: r.right - br - sb - pr, sb, pl, pr, bl, br };
  };
  const isDesigned = (el) => designed.some((sel) => el.closest(sel));
  const out = { findings: [], designed: [], stats: {} };
  const rootRect = root.getBoundingClientRect();
  const rcs = getComputedStyle(root);
  const rootBox = contentBox(root);
  out.stats = {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    rect: { left: rootRect.left, top: rootRect.top, width: rootRect.width, height: rootRect.height },
    clientWidth: root.clientWidth, offsetWidth: root.offsetWidth, scrollWidth: root.scrollWidth,
    clientHeight: root.clientHeight, scrollHeight: root.scrollHeight,
    padding: { left: num(rcs.paddingLeft), right: num(rcs.paddingRight) },
    border: { left: num(rcs.borderLeftWidth), right: num(rcs.borderRightWidth) },
    scrollbarWidth: rootBox.sb, scrollbarGutter: rcs.scrollbarGutter,
    overflow: `${rcs.overflowX}/${rcs.overflowY}`, scrollTop: root.scrollTop,
  };
  // The root itself must never scroll horizontally.
  if (root.scrollWidth > root.clientWidth + 1) {
    out.findings.push({ kind: "hscroll", el: label(root), detail: `scrollWidth ${root.scrollWidth} > clientWidth ${root.clientWidth}` });
  }
  const EPS = 0.75;
  let minInsetLeft = Infinity, minInsetRight = Infinity;
  const all = [root, ...root.querySelectorAll("*")];
  for (const el of all) {
    if (!visible(el)) continue;
    if (el.closest(".leaflet-container, svg")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "contents" || cs.display === "inline") {
      // Inline boxes wrap across lines; their line boxes are measured through
      // the nearest block ancestor, so there is nothing to assert on them.
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    // The 1px visually-hidden pattern (.sr-only, live-region announcers) is
    // clipped on purpose; it is not on-screen content.
    if (el.offsetWidth <= 1 && el.offsetHeight <= 1) continue;
    const designedRegion = isDesigned(el);

    // --- escape: against the layout parent's content box --------------------
    const parent = el.parentElement;
    const positioned = cs.position === "absolute" || cs.position === "fixed";
    if (el !== root && parent && !positioned && getComputedStyle(parent).display !== "contents") {
      const pb = contentBox(parent);
      // Deliberate full-bleed (negative margin) children, e.g. the sticky mode
      // bar, extend over the parent's padding on purpose; they are measured
      // against the parent's BORDER box instead.
      const bleed = num(cs.marginLeft) < 0 || num(cs.marginRight) < 0;
      const pr = parent.getBoundingClientRect();
      const pcs = getComputedStyle(parent);
      const lim = bleed
        ? { left: pr.left + num(pcs.borderLeftWidth), right: pr.right - num(pcs.borderRightWidth) - pb.sb }
        : { left: pb.left, right: pb.right };
      const insideDesignedScroller = designed.some((sel) => parent.closest(sel)) && !el.matches(designed.join(","));
      if (!insideDesignedScroller && (rect.left < lim.left - EPS || rect.right > lim.right + EPS)) {
        out.findings.push({
          kind: "escape", el: label(el),
          detail: `left ${(rect.left - lim.left).toFixed(2)} right ${(rect.right - lim.right).toFixed(2)} vs parent content box (${label(parent)})`,
        });
      }
    }

    // Smallest gap between any painted box and the panel's own content edges.
    if (el !== root && !positioned && !designedRegion && cs.position !== "sticky" && num(cs.marginLeft) >= 0 && num(cs.marginRight) >= 0
      && (num(cs.borderLeftWidth) > 0 || num(cs.borderRightWidth) > 0 || (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent"))
      && !el.closest(".panel-head, .drawer-head") && rect.width > 24) {
      minInsetLeft = Math.min(minInsetLeft, rect.left - rootBox.left);
      minInsetRight = Math.min(minInsetRight, rootBox.right - rect.right);
    }

    // --- spill / clip / hscroll on this element's own box -------------------
    if (el !== root) {
      const sw = el.scrollWidth, cw = el.clientWidth;
      if (cw > 0 && sw > cw + 1) {
        const ox = cs.overflowX;
        const clipped = ox === "hidden" || ox === "clip";
        const ellipsis = cs.textOverflow === "ellipsis";
        const scroller = ox === "auto" || ox === "scroll";
        const rec = { el: label(el), detail: `scrollWidth ${sw} > clientWidth ${cw}`, text: (el.textContent || "").trim().slice(0, 80) };
        if (scroller) {
          (designedRegion ? out.designed : out.findings).push({ ...rec, kind: "hscroll" });
        } else if (clipped || ellipsis) {
          // Table cells and replaced elements report scrollWidth oddly; only
          // flag boxes that really have text content to lose.
          if (rec.text) out.findings.push({ ...rec, kind: "clip" });
        } else if (ox === "visible" && el.children.length === 0 && rec.text && cs.display !== "inline") {
          out.findings.push({ ...rec, kind: "spill" });
        }
      }
    }

    // --- asymmetry: a bordered/filled box that (nearly) fills its VISUAL parent.
    // The visual parent is the nearest ancestor that paints a border or fill (a
    // card), not the layout parent: a scroll list's own padding/gutter must not
    // hide an uneven inset against the card the reader actually sees.
    if (el !== root && parent && !positioned) {
      const paints = (n) => {
        const c = getComputedStyle(n);
        return num(c.borderLeftWidth) > 0 || num(c.borderRightWidth) > 0 || (c.backgroundColor !== "rgba(0, 0, 0, 0)" && c.backgroundColor !== "transparent");
      };
      const inline = cs.display.startsWith("inline");
      // Only boxes WIDTH-DETERMINED by their parent (block/grid stretch) are
      // asymmetric by accident; flex/inline items size to their content.
      const stretched = /^(block|grid|flow-root|list-item)$/.test(getComputedStyle(parent).display);
      if (paints(el) && !inline && stretched && !designedRegion) {
        let vis = parent;
        while (vis !== root && !paints(vis)) vis = vis.parentElement;
        const vb = contentBox(vis);
        const width = vb.right - vb.left;
        if (width > 120 && rect.width >= width * 0.9 && rect.width < width + 2) {
          // A visible scrollbar on an ancestor between the box and the card is
          // not padding: take it out of the right inset.
          let sbBetween = 0;
          for (let n = parent; n && n !== vis; n = n.parentElement) sbBetween += contentBox(n).sb;
          const l = rect.left - vb.left, r = vb.right - rect.right - sbBetween;
          if (Math.abs(l - r) > 3) {
            out.findings.push({ kind: "asymmetry", el: label(el), detail: `left inset ${l.toFixed(2)} vs right inset ${r.toFixed(2)} in ${label(vis)}` });
          }
        }
      }
    }
  }

  out.stats.minInsetLeft = Number.isFinite(minInsetLeft) ? +minInsetLeft.toFixed(2) : null;
  out.stats.minInsetRight = Number.isFinite(minInsetRight) ? +minInsetRight.toFixed(2) : null;
  out.stats.elementsAudited = all.length;

  // --- focus ring clipping ---------------------------------------------------
  if (includeFocus) {
    const focusable = [...root.querySelectorAll("a[href],button,select,input,summary,textarea,[tabindex]:not([tabindex='-1'])")].filter(visible);
    const prev = document.activeElement;
    for (const el of focusable) {
      if (el.closest("[hidden]")) continue;
      el.focus({ preventScroll: true });
      if (document.activeElement !== el) continue;
      const cs = getComputedStyle(el);
      const ow = cs.outlineStyle === "none" ? 0 : num(cs.outlineWidth);
      const oo = ow ? num(cs.outlineOffset) : 0;
      const grow = ow + Math.max(0, oo);
      const r = el.getBoundingClientRect();
      // Nearest ancestor that clips horizontally.
      for (let a = el.parentElement; a; a = a.parentElement) {
        const acs = getComputedStyle(a);
        const clips = acs.overflowX !== "visible";
        if (!clips) { if (a === root) break; continue; }
        const ar = a.getBoundingClientRect();
        const bl = num(acs.borderLeftWidth), br = num(acs.borderRightWidth);
        const sb = Math.max(0, a.offsetWidth - a.clientWidth - bl - br);
        const padL = ar.left + bl, padR = ar.right - br - sb;
        if (r.left - grow < padL - EPS || r.right + grow > padR + EPS) {
          out.findings.push({ kind: "focus-clip", el: label(el), detail: `outline ${grow}px exceeds ${label(a)} padding box by L ${(padL - (r.left - grow)).toFixed(2)} R ${((r.right + grow) - padR).toFixed(2)}` });
        }
        break;
      }
    }
    if (prev && prev.focus) prev.focus({ preventScroll: true });
  }
  return out;
};
