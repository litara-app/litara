// Locator probe API (MIT). A classic script so it can be loaded by harness.html and injected into the Android reader's WebView
// over DevTools. It only DRIVES whatever <foliate-view> it is given; it copies no engine code.
// Every position is reduced to an engine-independent fact: (spine index, UTF-16 text offset within the section BODY). The body
// only: the live page also holds injected style text that a pristine document does not.
window.makeLocatorApi = getView => {
  const view = () => getView();

  // XHTML sections are XML documents (no doc.body); find the body element by name.
  const bodyOf = doc => doc.body ?? doc.getElementsByTagNameNS('*', 'body')[0] ?? doc.documentElement;

  const textBefore = (doc, node, offset) => {
    const r = doc.createRange();
    r.setStart(bodyOf(doc), 0);
    r.setEnd(node, offset);
    return r.toString().length;
  };

  const rangeFromOffsets = (doc, a, b) => {
    const w = doc.createTreeWalker(bodyOf(doc), NodeFilter.SHOW_TEXT);
    let n = 0, t, startNode = null, startOff = 0, endNode = null, endOff = 0;
    while ((t = w.nextNode())) {
      const len = t.data.length;
      if (!startNode && a <= n + len) { startNode = t; startOff = a - n; }
      if (!endNode && b <= n + len) { endNode = t; endOff = b - n; break; }
      n += len;
    }
    if (!startNode || !endNode) return null;
    const r = doc.createRange();
    r.setStart(startNode, startOff);
    r.setEnd(endNode, endOff);
    return r;
  };

  // A section's LIVE document: loaded into the renderer exactly as a reader would (createDocument() on an unloaded section is
  // not a faithful stand-in: both engines return an unusable document for it).
  const liveDoc = async index => {
    await view().renderer.goTo({ index });
    await new Promise(r => setTimeout(r, 60));
    const c = view().renderer.getContents().find(x => x.index === index);
    if (!c) throw new Error('section not loaded');
    return c.doc;
  };

  const nextRelocate = (ms = 4000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { view().removeEventListener('relocate', h); reject(new Error('no relocate')); }, ms);
    const h = e => { clearTimeout(t); view().removeEventListener('relocate', h); resolve(e.detail); };
    view().addEventListener('relocate', h);
  });

  const summarize = d => {
    const doc = d.range.startContainer.ownerDocument ?? d.range.commonAncestorContainer.ownerDocument;
    return {
      index: d.section?.current ?? d.index,
      cfi: d.cfi,
      fraction: d.fraction,
      start: textBefore(doc, d.range.startContainer, d.range.startOffset),
      end: textBefore(doc, d.range.endContainer, d.range.endOffset),
      snippet: d.range.toString().slice(0, 40),
    };
  };

  const api = {
    current: () => summarize(view().lastLocation),
    // Pages forward through the book, returning where each page starts (the engine's own relocate cfi and visible range).
    async walk(maxPages = 200) {
      const out = [];
      if (view().lastLocation) out.push(summarize(view().lastLocation));
      for (let i = 0; i < maxPages; i++) {
        const p = nextRelocate(7000);
        await view().next();
        let d;
        try { d = await p; } catch { break; }
        const s = summarize(d);
        if (out.length && out[out.length - 1].cfi === s.cfi) break;
        out.push(s);
      }
      return out;
    },
    async resolve(cfi) {
      const { index, anchor } = view().resolveCFI(cfi);
      const doc = await liveDoc(index);
      let r = anchor(doc);
      if (r.startContainer === undefined) { const x = doc.createRange(); x.selectNode(r); r = x; } // a Range of the iframe's own realm has startContainer
      return { index, start: textBefore(doc, r.startContainer, r.startOffset), end: textBefore(doc, r.endContainer, r.endOffset), text: r.toString().slice(0, 200) };
    },
    async go(cfi) {
      const expected = view().resolveCFI(cfi).index;
      await view().goTo(cfi);
      // Settle: the renderer may report the page it left before the new one; take the last report for the expected section.
      const t0 = Date.now();
      for (;;) {
        await new Promise(r => setTimeout(r, 120));
        const d = view().lastLocation;
        const idx = d?.section?.current ?? d?.index;
        if (d?.range && (idx === expected || Date.now() - t0 > 3000)) { await new Promise(r => setTimeout(r, 200)); break; }
      }
      return summarize(view().lastLocation);
    },
    // Navigates by book fraction (any viewport size/font gives a different page boundary) and reports where the engine landed.
    async goFraction(f) {
      const p = nextRelocate(4000).catch(() => null);
      await view().goToFraction(f);
      await p;
      await new Promise(r => setTimeout(r, 300));
      return summarize(view().lastLocation);
    },
    async sectionLengths() {
      const out = [];
      for (let i = 0; i < view().book.sections.length; i++) {
        const s = view().book.sections[i];
        if (!s.createDocument) { out.push(0); continue; }
        out.push(bodyOf(await liveDoc(i)).textContent.length);
      }
      return out;
    },
    async rangeCFI(index, a, b) {
      const doc = await liveDoc(index);
      const r = rangeFromOffsets(doc, a, b);
      if (!r) return null;
      return { cfi: view().getCFI(index, r), text: r.toString() };
    },
    // Layout variation without resizing the window: change the font size through the engine's own style hook.
    async setFont(px) {
      view().renderer.setStyles?.(`html { font-size: ${px}px !important; }`);
      await new Promise(r => setTimeout(r, 500));
    },
  };
  // A throw is a finding, not a crash: return it as data.
  for (const name of ['resolve', 'go', 'rangeCFI']) {
    const f = api[name];
    api[name] = async (...a) => { try { return await f(...a); } catch (e) { return { error: String(e?.message ?? e).slice(0, 200) }; } };
  }
  return api;
};
