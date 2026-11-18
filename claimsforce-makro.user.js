// ==UserScript==
// @name         Claimsforce Makro – Sparkasse + LAS-Standard (VHV)
// @namespace    claimsforce-makro
// @version      3.8
// @description  Füllt Berichte per Knopfdruck aus: "Bericht Sparkassenversicherung" (inkl. Stundenabrechnung) oder LAS-Standard (inkl. Kalkulation)
// @match        https://web.claimsforce.com/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/AnimatedArts/claimsforce-makro-berichte/main/claimsforce-makro.user.js
// @downloadURL  https://raw.githubusercontent.com/AnimatedArts/claimsforce-makro-berichte/main/claimsforce-makro.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* =====================================================================
     EINSTELLUNGEN – hier kannst du Werte ändern
     ===================================================================== */

  // ---- Ablauf A: Bericht heißt "... Sparkassenversicherung ..." ----
  const SPARKASSE = {
    verdacht: 'Nein',
    abstimmungVN: ['Ja', 'Ja', 'Ja', 'Nein'],
    weitereInfos: ['Nein', 'Nein', 'Nein', 'Nein', 'Nein', 'Ja', 'Ja', 'Ja', 'Nein'],
    regress: 'Nein',
    regressBaustein: 'Der Schaden entstand durch höhere Gewalt',
    mehrfachversicherung: ['Nein', 'Nein'],
    handlungsempfehlung: ['Nein', 'Nein'],
    vorsteuerabzug: 'Nein',
    freigabeErteilt: 'Ja',
    vorschussText: 'Vorschusszahlung an VN', // Erläuterung, wenn in der Kalkulation Positionen auf "Zahlen" stehen
    // Positionen auf "Freigeben" mit einer dieser Firmen kommen in "Freigabe 1–3 an" (Tippfehler werden toleriert)
    freigabeFirmen: ['BTS', 'Pinguin', 'Belfor', 'Cinar', 'ABT', 'Sprint', 'Scherer', 'Pingitore', 'Weber',
      'Polygon', 'Rainbow', 'Mey', 'Heinrich Schmid', 'Vilson', 'SAT', 'Webesan'],
    // Wörter, die keiner Firma zugeordnet werden sollen (verhindert Fehltreffer)
    keineFirma: ['springt', 'spring', 'springen', 'sprinter', 'weben', 'webern', 'cinema', 'scherben', 'polygone'],
    leereKalkulationAnlegen: true, // leere Kalkulation + Leitungswasser & Co. → Gewerke/Strom wie beim LAS-Bericht
    kalkulationAlsStichpunkte: true, // Beschreibungen aus der Kalkulation unten im Schadenhergang anhängen …
    stichpunkteNurBei: /sturm|hagel/i, // … aber nur bei diesen Schadenursachen
    stunden: ['1,0', '0,75', '1,5', '1,75'],
    taetigkeit: ['Bürotätigkeit', 'Fahrzeit', 'Ortstermin', 'Berichterstellung'],
    kilometer: '40',
    formularName: 'SV-Stundenabrechnung Bericht',
    entwurfSpeichern: true,
  };

  // ---- Ablauf B: alle anderen Berichte (z. B. "LAS-Standard Sach VHV") ----
  const LAS = {
    ausgehaendigteFormulare: ['Nein', 'Nein'], // §28 VVG, Entschädigungsvereinbarung
    verdacht: 'Nein',
    hergangBaustein: 'Teilnehmer am Ortstermin',
    polizei: 'Nein',
    feuerwehr: 'Nein',
    deckung: 'Ja',
    plausibilitaet: 'Ja',
    obliegenheiten: 'Nein',
    grobeFahrlaessigkeit: 'Nein',
    sicherheitsvorschriften: 'Nein',
    regress: 'Nein',
    mehrfachversicherung: 'Nein',
    handlungsempfehlungen: ['Nein', 'Nein', 'Ja'], // Spezialist, Schadenschlusserklärung, Objekt bewohnbar
    handlungsHaken: ['Freigabe gemäß Kalkulation'],
    // Kalkulation nur, wenn die Schadenursache rechts eins dieser Wörter enthält:
    kalkulationBei: /leitungswasser|rohrbruch|undichtigkeit|r(ü|ue)ckstau|elementar/i,
    gewerke: ['Wiederherstellungsarbeiten', 'Technische Trocknung', 'Klempnerarbeiten'],
    strom: { gewerk: 'Technische Trocknung', suche: 'Stromverbrauch', preisEnthaelt: '0.35', menge: '350', einheit: 'kWh', aktion: 'Reservieren' },
  };

  /* ===================== ab hier nichts ändern nötig ===================== */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MAX_WARTEN = 15000;
  let statusEl;

  function status(t) {
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = t; }
    console.log('[Claimsforce Makro]', t);
  }

  async function warteAuf(fn, was, ms = MAX_WARTEN) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      try { const r = fn(); if (r) return r; } catch (e) { /* weiter warten */ }
      await sleep(200);
    }
    throw new Error('Nicht gefunden: ' + was);
  }

  // Element mit genau diesem sichtbaren Text (nicht im Makro-Panel)
  function elementMitText(text, wurzel = document.body) {
    const w = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.textContent.trim() === text) {
        const e = n.parentElement;
        if (!e || e.closest('#cf-makro-panel')) continue;
        if (!e.getClientRects().length) continue;
        return e;
      }
    }
    return null;
  }

  function textKnotenEnthaelt(regex) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (regex.test(n.textContent)) return n.parentElement;
    return null;
  }

  function klick(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.click();
  }

  // Für Elemente, die erst auf "Maustaste drücken" reagieren
  function mausKlick(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const opt = { bubbles: true, cancelable: true, button: 0, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opt, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', opt));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opt, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', opt));
    el.click();
  }

  function knopf(text, wurzel = document) {
    return [...wurzel.querySelectorAll('button')].find(
      (b) => b.innerText.trim() === text && b.getClientRects().length && !b.closest('#cf-makro-panel'));
  }

  function eingabeSetzen(el, wert) {
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, wert);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------- Werte aus dem rechten Detailbereich ----------
  function detailWert(label) {
    const dt = [...document.querySelectorAll('dt')].find((e) => e.textContent.trim() === label);
    return dt && dt.nextElementSibling ? dt.nextElementSibling.textContent.trim() : null;
  }

  function schadenursache() {
    let feld = null;
    // alter Aufbau: <div class="row"> mit zwei Spalten
    const row = [...document.querySelectorAll('div.row')].find(
      (r) => r.querySelectorAll(':scope > .col').length === 2);
    if (row) feld = row.children[1];
    // neuer Aufbau (ab Nov. 2026): Raster mit zwei Spalten über "Erstreserve" –
    // links Produkt (z. B. "LAS-Standard / Sach"), rechts Ursache (darunter z. B. "Unbestätigt")
    if (!feld) {
      const erstreserve = [...document.querySelectorAll('dt')].find((x) => x.textContent.trim() === 'Erstreserve');
      const raster = [...document.querySelectorAll('div.grid')].find((d) => d.children.length === 2
        && !d.querySelector('dt') && d.getClientRects().length
        && (!erstreserve || (d.compareDocumentPosition(erstreserve) & Node.DOCUMENT_POSITION_FOLLOWING)));
      if (raster) feld = raster.children[1];
    }
    if (!feld) return '';
    // nur die erste Zeile = die Ursache
    const t = (feld.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
    // "-", "unbekannt", "keine Angabe" usw. zählen als "keine Ursache ermittelt"
    return /^(-+|–|unbekannt|keine angabe|nicht bekannt|n\/a)?$/i.test(t) ? '' : t;
  }

  // leer, "-" oder 0 → 0,00 ; sonst Betrag ohne €
  function selbstbeteiligung(roh) {
    const z = (roh || '').replace(/[^\d,.]/g, '');
    return z && /[1-9]/.test(z) ? z : '0,00';
  }

  async function rechterReiter(name) {
    const el = await warteAuf(() => elementMitText(name), 'Reiter ' + name);
    mausKlick(el.closest('button, [role=tab]') || el);
    await sleep(1200);
  }

  // ---------- Navigation ----------
  function seitenLink(endung) {
    return [...document.querySelectorAll('a[href]')].find(
      (a) => new RegExp('/claims/[^/]+/' + endung + '$').test(a.getAttribute('href')));
  }

  const imBericht = () => /\/investigations\/[0-9a-f-]{20,}/.test(location.pathname);

  function aufnahmeKarte() {
    return [...document.querySelectorAll('div')].reverse().find(
      (d) => d.innerText && d.innerText.startsWith('Aufnahme') && elementMitText('Bearbeiten', d));
  }

  async function zurBewertung() {
    if (/\/investigations$/.test(location.pathname)) return;
    const link = await warteAuf(() => seitenLink('investigations'), 'Link Bewertung');
    klick(link);
    await warteAuf(() => /\/investigations$/.test(location.pathname), 'Bewertungsseite');
  }

  // Liest den Namen der Aufnahme (Bewertungsseite)
  async function aufnahmeName() {
    const karte = await warteAuf(aufnahmeKarte, 'Aufnahme mit Button Bearbeiten');
    return karte.innerText;
  }

  async function berichtOeffnen() {
    if (imBericht()) return;
    await zurBewertung();
    const karte = await warteAuf(aufnahmeKarte, 'Button Bearbeiten');
    const btn = elementMitText('Bearbeiten', karte);
    klick(btn.closest('button, a') || btn);
    await warteAuf(imBericht, 'Bericht');
    await warteAuf(() => elementMitText('Verdachtsmomente / Unstimmigkeiten'), 'Bericht geladen');
    await sleep(1000);
  }

  // ---------- Bericht ----------
  async function sektion(name) {
    status('Sektion: ' + name);
    const el = await warteAuf(() => {
      const e = elementMitText(name);
      return e && !e.closest('[role=menu]') ? e : null;
    }, 'Sektion ' + name);
    klick(el);
    await sleep(1000);
  }

  async function radio(id, wert) {
    const gruppe = await warteAuf(() => document.getElementById(id), 'Frage ' + id);
    const btn = [...gruppe.querySelectorAll('button[role=radio]')].find(
      (b) => (b.closest('label') || b.parentElement).innerText.trim() === wert);
    if (!btn) throw new Error(`Antwort "${wert}" bei ${id} nicht gefunden`);
    if (btn.getAttribute('data-state') !== 'checked') { klick(btn); await sleep(600); }
  }

  async function haken(label) {
    const cb = await warteAuf(() => [...document.querySelectorAll('button[role=checkbox]')].find(
      (b) => (b.closest('label') || b.parentElement).innerText.trim() === label), 'Kästchen ' + label);
    if (cb.getAttribute('data-state') !== 'checked') { klick(cb); await sleep(600); }
  }

  async function warteAufSpeichern() {
    await sleep(1500);
    await warteAuf(() => elementMitText('Gespeichert'), 'Speichern der Seite', 15000)
      .catch(() => status('⚠ Speicher-Anzeige nicht gesehen – fahre fort'));
    await sleep(2000);
  }

  function editor(id) { return window.tinymce && window.tinymce.get(id); }
  function editorText(id) { const ed = editor(id); return ed ? ed.getContent({ format: 'text' }).trim() : ''; }

  function editorSetzen(id, html) {
    const ed = editor(id);
    ed.setContent(html);
    ed.fire('change'); ed.fire('input'); ed.save(); ed.nodeChanged();
  }

  // Schadenursache: ist je nach Bericht ein Eingabefeld oder ein Texteditor
  async function schadenursacheEintragen(ursache) {
    if (!ursache) { status('Keine Schadenursache ermittelt – Feld übersprungen'); await sleep(800); return; }
    await warteAuf(() => document.getElementById('root_causes'), 'Feld Schadenursache');
    const el = document.getElementById('root_causes');
    if (el.tagName === 'INPUT') {
      eingabeSetzen(el, ursache); el.blur();
    } else {
      await warteAuf(() => editor('root_causes'), 'Editor Schadenursache');
      await sleep(1500);
      if (editorText('root_causes') === '') editorSetzen('root_causes', '<p>' + ursache + '</p>');
    }
    await warteAufSpeichern();
  }

  // Textbaustein über den letzten Button der Editor-Werkzeugleiste einfügen
  async function textbaustein(editorId, auswahl /* Zahl (0 = erster) oder Textanfang */) {
    await warteAuf(() => editor(editorId), 'Editor ' + editorId);
    await sleep(1500); // gespeicherten Inhalt laden lassen
    if (editorText(editorId) !== '') { status('Textbaustein übersprungen (Feld schon gefüllt)'); return; }
    const ifr = await warteAuf(() => document.getElementById(editorId + '_ifr'), 'Editor-Feld');
    let c = ifr;
    for (let i = 0; i < 10 && c; i++) { c = c.parentElement; if (c.querySelectorAll('button').length >= 10) break; }
    const knoepfe = c.querySelectorAll('button');
    klick(knoepfe[knoepfe.length - 1]);
    const dlg = await warteAuf(() => document.querySelector('[role=dialog] li') && document.querySelector('[role=dialog]'), 'Textbaustein-Fenster');
    const eintraege = [...dlg.querySelectorAll('li')];
    const li = typeof auswahl === 'number'
      ? eintraege[auswahl]
      : eintraege.find((l) => l.innerText.trim().startsWith(auswahl));
    if (!li) throw new Error('Textbaustein nicht gefunden: ' + auswahl);
    klick(li.querySelector('.cf-cursor-pointer') || li.querySelector('span') || li);
    await warteAuf(() => !document.querySelector('[role=dialog] li'), 'Schließen des Fensters', 5000).catch(() => {});
    await warteAuf(() => editorText(editorId) !== '', 'eingefügter Text');
    await warteAufSpeichern();
  }

  function ersetzeImEditor(id, suche, ersatz) {
    const ed = editor(id);
    if (!ed || !ed.getContent().includes(suche)) return;
    editorSetzen(id, ed.getContent().split(suche).join(ersatz));
  }

  const htmlSicher = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---------- Kalkulation ----------
  async function zurKalkulation() {
    const link = await warteAuf(() => seitenLink('calculation'), 'Link Kalkulation');
    klick(link);
    await warteAuf(() => /\/calculation$/.test(location.pathname), 'Kalkulationsseite');
    // geladen = Positionen da ODER Hinweis "Klicken Sie auf Hinzufügen"
    await warteAuf(() => document.querySelector('.expandable') || textKnotenEnthaelt(/Klicken Sie auf/), 'Kalkulation geladen', 20000);
    await sleep(1000);
  }

  function positionsZeilen() {
    return [...document.querySelectorAll('.expandable')].filter((r) => /MwSt/.test(r.innerText));
  }

  function positionsText(zeile) {
    const t = zeile.querySelector('.text-ellipsis');
    return t ? t.textContent.trim() : '';
  }

  function positionsBeschreibungen() {
    return positionsZeilen().map(positionsText).filter((t) => t && t !== 'Beschreibung hinzufügen');
  }

  // Summe aller Positionen mit Status "Zahlen" (in Cent)
  function zahlenSummeCent() {
    let cent = 0;
    for (const z of positionsZeilen()) {
      const m = z.innerText.match(/(?:^|\n)\s*Zahlen\s*\n\s*([\d.]+,\d{2})\s*EUR/);
      if (m) cent += Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * 100);
    }
    return cent;
  }

  function euroText(cent) {
    return (cent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Betrag einer Position, wenn sie auf diesem Status steht (z. B. "Freigeben"), sonst null – in Cent
  function betragBeiStatus(zeile, statusName) {
    const m = zeile.innerText.match(new RegExp('(?:^|\\n)\\s*' + statusName + '\\s*\\n\\s*([\\d.]+,\\d{2})\\s*EUR'));
    return m ? Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * 100) : null;
  }

  // ---------- Firmen erkennen (auch mit kleinen Tippfehlern) ----------
  function normText(t) {
    return t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Tippfehler-Abstand (inkl. vertauschter Buchstaben)
  function abstand(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) d[i] = [i];
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  }

  // kurze Namen (bis 3 Buchstaben) müssen exakt stimmen, bis 7 Buchstaben 1 Fehler, länger 2 Fehler
  function wortPasst(wort, firmenwort) {
    if (SPARKASSE.keineFirma.includes(wort)) return false;
    const tol = firmenwort.length <= 3 ? 0 : firmenwort.length <= 7 ? 1 : 2;
    return abstand(wort, firmenwort) <= tol;
  }

  function firmaIn(text) {
    const worte = normText(text).split(' ').filter(Boolean);
    for (const f of SPARKASSE.freigabeFirmen) {
      const fw = normText(f).split(' ');
      const zusammen = fw.join('');
      for (let i = 0; i < worte.length; i++) {
        if (i + fw.length <= worte.length && fw.every((w, k) => wortPasst(worte[i + k], w))) return f;
        if (fw.length > 1 && wortPasst(worte[i], zusammen)) return f; // z. B. "HeinrichSchmid"
      }
    }
    return null;
  }

  // Positionen auf "Freigeben", deren Beschreibung eine der Firmen enthält (Reihenfolge wie in der Kalkulation)
  function firmenFreigaben() {
    const liste = [];
    for (const z of positionsZeilen()) {
      const cent = betragBeiStatus(z, 'Freigeben');
      const text = positionsText(z);
      if (cent === null || !text) continue;
      const firma = firmaIn(text);
      if (firma) liste.push({ text, cent, firma });
    }
    return liste;
  }

  function gewerkKopf(name) {
    return [...document.querySelectorAll('.expandable, div')].find((d) => {
      const t = d.querySelector(':scope .text-ellipsis, :scope b, :scope strong');
      return d.innerText && /Reservieren/.test(d.innerText) && !/MwSt/.test(d.innerText)
        && new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(\\d+\\)').test(d.innerText.trim());
    });
  }

  function hauptHinzufuegen() {
    const panelX = (elementMitText('Details') || { getBoundingClientRect: () => ({ left: 1e9 }) }).getBoundingClientRect().left;
    return [...document.querySelectorAll('button')].find((b) => /^Hinzufügen/.test(b.innerText.trim())
      && b.getClientRects().length && b.getBoundingClientRect().left < panelX - 20);
  }

  async function gewerkHinzufuegen(name) {
    if (gewerkKopf(name)) { status('Gewerk schon vorhanden: ' + name); return; }
    status('Gewerk anlegen: ' + name);
    mausKlick(await warteAuf(hauptHinzufuegen, 'Button Hinzufügen'));
    const eintrag = await warteAuf(() => [...document.querySelectorAll('[role=menuitem]')].find((m) => m.innerText.trim() === 'Gewerk'), 'Menüpunkt Gewerk');
    mausKlick(eintrag);
    const dlg = await warteAuf(() => [...document.querySelectorAll('[role=dialog]')].find((d) => d.innerText.startsWith('Gewerk')), 'Fenster Gewerk');
    const inp = dlg.querySelector('input');
    inp.focus();
    eingabeSetzen(inp, name);
    const option = await warteAuf(() => {
      const opts = [...document.querySelectorAll('[role=option], [class*="option"]')].filter((o) => o.getClientRects().length);
      return opts.find((o) => o.innerText.trim() === name) || opts.find((o) => o.innerText.trim() === `"${name}" hinzufügen`);
    }, 'Auswahl ' + name);
    mausKlick(option);
    await sleep(500);
    mausKlick(await warteAuf(() => knopf('Bestätigen', dlg), 'Button Bestätigen'));
    await warteAuf(() => gewerkKopf(name), 'Gewerk ' + name + ' in der Liste');
    await sleep(1000);
  }

  // Positionen, die zu einem Gewerk gehören (bis zum nächsten Gewerk-Kopf)
  function zeilenUnterGewerk(name) {
    const kopf = gewerkKopf(name);
    if (!kopf) return [];
    const zeilen = positionsZeilen();
    const nachKopf = zeilen.filter((z) => kopf.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_FOLLOWING);
    const kopfAlle = [...document.querySelectorAll('div')].filter((d) => d !== kopf && /Reservieren/.test(d.innerText || '')
      && !/MwSt/.test(d.innerText) && /^\S.*\(\d+\)/.test((d.innerText || '').trim()) && (kopf.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING));
    const naechster = kopfAlle.find((d) => !kopf.contains(d));
    return naechster ? nachKopf.filter((z) => z.compareDocumentPosition(naechster) & Node.DOCUMENT_POSITION_FOLLOWING) : nachKopf;
  }

  function feldZuBeschriftung(text, selektor) {
    const l = elementMitText(text);
    if (!l) return null;
    let c = l;
    for (let i = 0; i < 6 && c; i++) {
      c = c.parentElement;
      const f = c && c.querySelector(selektor);
      if (f) return f;
    }
    return null;
  }

  async function stromPosition(S) {
    const unter = zeilenUnterGewerk(S.gewerk);
    if (unter.some((z) => positionsText(z) === S.suche)) { status(S.suche + ' schon vorhanden'); return; }
    const leer = unter.find((z) => positionsText(z) === 'Beschreibung hinzufügen');
    if (!leer) throw new Error('Keine leere Position unter ' + S.gewerk);
    status('Position: ' + S.suche + ' …');
    klick(elementMitText('Beschreibung hinzufügen', leer) || leer);
    const suche = await warteAuf(() => [...document.querySelectorAll('input')].find(
      (i) => i.placeholder === 'durchsuchen' && i.getClientRects().length), 'Preisliste durchsuchen');
    eingabeSetzen(suche, S.suche);
    const treffer = await warteAuf(() => {
      const t = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim() === S.suche && e.getClientRects().length && e !== suche);
      return t.find((e) => (e.parentElement.innerText || '').includes(S.preisEnthaelt));
    }, 'Treffer ' + S.suche + ' (' + S.preisEnthaelt + ')');
    klick(treffer);
    await sleep(1200);
    // Beschriftung kann verschieden tief verschachtelt sein → nach oben gehen, bis ein Eingabefeld dabei ist
    const menge = await warteAuf(() => feldZuBeschriftung('Menge', 'input'), 'Feld Menge');
    eingabeSetzen(menge, S.menge); menge.blur();
    await sleep(800);
    const einheit = feldZuBeschriftung('Einheit', 'button[role=combobox], button, select');
    if (einheit && !(einheit.innerText || einheit.value || '').includes(S.einheit)) status('⚠ Einheit ist nicht ' + S.einheit + ' – bitte prüfen');
    mausKlick(await warteAuf(() => knopf(S.aktion), 'Button ' + S.aktion));
    await sleep(600);
    mausKlick(await warteAuf(() => knopf('Speichern'), 'Button Speichern'));
    await warteAuf(() => textKnotenEnthaelt(/Kalkulation gespeichert/), 'Bestätigung Kalkulation gespeichert', 10000)
      .catch(() => status('⚠ Speicher-Meldung nicht gesehen'));
    await sleep(1500);
  }

  // ---------- Formular (PDF) ----------
  function pdfFelder() {
    const f = [...document.querySelectorAll('iframe')].find((x) => x.id && x.id.startsWith('webviewer'));
    const inst = f && f.contentWindow && f.contentWindow.instance;
    if (!inst) return null;
    const am = inst.Core.annotationManager;
    const fm = am.getFieldManager();
    return fm.getField('DatumRow1') ? { am, fm } : null;
  }

  function pdfSetze(pdf, name, wert) {
    const fl = pdf.fm.getField(name);
    if (!fl) throw new Error('PDF-Feld ' + name + ' nicht gefunden');
    let v = wert;
    if (fl.options && fl.options.length) {
      const o = fl.options.find((o) => (o.displayValue || o.value) === wert);
      if (o) v = o.value;
    }
    fl.setValue(v);
    pdf.am.trigger('fieldChanged', [fl, v]);
    pdf.am.trigger('annotationChanged', [fl.widgets || [], 'modify', { imported: false }]);
  }

  const MONATE = { januar: 1, februar: 2, 'märz': 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7,
    august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };

  function verlaufDaten() {
    const el = textKnotenEnthaelt(/Termin wurde hinzugef/);
    if (!el) return null;
    let c = el, ueber = null;
    for (let i = 0; i < 5 && c && !ueber; i++) {
      c = c.parentElement;
      const m = c.innerText.match(/-\s*(\d{2}\.\d{2}\.\d{4}),\s*\d{1,2}:\d{2}/);
      if (m && c.innerText.indexOf(m[0]) < c.innerText.indexOf('Termin wurde')) ueber = m[1];
    }
    const txt = el.innerText + ' ' + (el.parentElement ? el.parentElement.innerText : '');
    const t = txt.match(/(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\s+(\d{4})/);
    const unter = t && MONATE[t[2].toLowerCase()]
      ? String(t[1]).padStart(2, '0') + '.' + String(MONATE[t[2].toLowerCase()]).padStart(2, '0') + '.' + t[3]
      : null;
    return ueber && unter ? { ueber, unter } : null;
  }

  /* ========================= ABLAUF A: SPARKASSE ========================= */
  async function ablaufSparkasse(daten) {
    const E = SPARKASSE;

    await sektion('Verdachtsmomente / Unstimmigkeiten');
    await radio('root_discrepanciesPresent', E.verdacht);

    await sektion('Schadenbeschreibung');
    await schadenursacheEintragen(daten.ursache);
    status('Schadenhergang: Textbaustein …');
    await textbaustein('root_damageDescription', 0);
    ersetzeImEditor('root_damageDescription', '[Datum]', daten.schadendatum);
    await warteAufSpeichern();

    // NEU: Beschreibungen aus der Kalkulation als Stichpunkte unten im Schadenhergang
    // Kalkulation einmal lesen: Beschreibungen (für Stichpunkte) + Summe "Zahlen" (für Vorschusszahlung)
    status('Lese Kalkulation …');
    await zurKalkulation();
    // NEU: leere Kalkulation bei Leitungswasser & Co. → gleiche Kalkulation wie beim LAS-Bericht anlegen
    if (!daten.ursache) status('Keine Schadenursache – es wird keine Kalkulation angelegt');
    else if (E.leereKalkulationAnlegen && kalkulationLeer() && LAS.kalkulationBei.test(daten.ursache)) {
      status('Kalkulation leer – lege Standard-Kalkulation an …');
      await standardKalkulationAnlegen();
    }
    const texte = positionsBeschreibungen();
    const zahlenCent = zahlenSummeCent();
    const freigaben = firmenFreigaben();
    status(texte.length + ' Position(en), "Zahlen": ' + euroText(zahlenCent) + ' €, Firmen-Freigaben: ' + freigaben.length);
    await berichtOeffnen();

    if (E.kalkulationAlsStichpunkte && !E.stichpunkteNurBei.test(daten.ursache)) {
      status('Stichpunkte übersprungen (kein Sturm/Hagel: ' + daten.ursache + ')');
    } else if (E.kalkulationAlsStichpunkte) {
      await sektion('Schadenbeschreibung');
      await warteAuf(() => editor('root_damageDescription'), 'Editor Schadenhergang');
      await sleep(1500);
      const vorhanden = editorText('root_damageDescription');
      const neu = texte.filter((t) => !vorhanden.includes(t));
      if (neu.length) {
        const ed = editor('root_damageDescription');
        editorSetzen('root_damageDescription',
          ed.getContent() + '<ul>' + neu.map((t) => '<li>' + htmlSicher(t) + '</li>').join('') + '</ul>');
        await warteAufSpeichern();
      } else if (texte.length) status('Stichpunkte schon vorhanden');
    }

    await sektion('Abstimmung mit VN');
    const vn = ['root_noAdditionalInsurance', 'root_acknowledgementCalculation', 'root_serviceDescription', 'root_contractReorganization'];
    for (let i = 0; i < vn.length; i++) await radio(vn[i], E.abstimmungVN[i]);

    await sektion('Weitere Informationen');
    const wi = ['root_deviations', 'root_reasonsReplacementObligations', 'root_insuredRisk', 'root_contactDetails',
      'root_noteFAQ', 'root_claimsHandling', 'root_claimSettlementStatementProvided', 'root_picturesProvided', 'root_bankDetailsChecked'];
    for (let i = 0; i < wi.length; i++) await radio(wi[i], E.weitereInfos[i]);

    await sektion('Regress');
    await radio('root_regressPossible', E.regress);
    status('Regress: Textbaustein …');
    await textbaustein('root_NoRegressCause', E.regressBaustein);

    await sektion('Mehrfachversicherung');
    await radio('root_isDoubleInsured', E.mehrfachversicherung[0]);
    await radio('root_decorativeDamage', E.mehrfachversicherung[1]);

    await sektion('Handlungsempfehlung');
    await radio('root_expertRequired', E.handlungsempfehlung[0]);
    await radio('root_finalClaimSettlement', E.handlungsempfehlung[1]);

    await sektion('Zahlungsempfehlung');
    await radio('root_vatDeduction', E.vorsteuerabzug);
    await radio('root_grantApproval', E.freigabeErteilt);
    await warteAuf(() => document.getElementById('root_deduction'), 'Feld Selbstbeteiligung');
    const sb = document.getElementById('root_deduction');
    eingabeSetzen(sb, daten.sb); sb.blur();
    // NEU: Vorschusszahlung = Summe aller Kalkulations-Positionen auf "Zahlen"
    if (zahlenCent > 0) {
      await sleep(800);
      const erl = document.getElementById('root_upfrontPaymentReason');
      const hoehe = document.getElementById('root_upfrontPayment');
      if (!erl || !hoehe) throw new Error('Felder Vorschusszahlung nicht gefunden');
      eingabeSetzen(erl, E.vorschussText); erl.blur();
      await sleep(500);
      eingabeSetzen(hoehe, euroText(zahlenCent)); hoehe.blur();
      status('Vorschusszahlung: ' + euroText(zahlenCent) + ' €');
    }
    // NEU: Freigabe 1–3 = Positionen auf "Freigeben" mit einer der Firmen
    if (freigaben.length) {
      await sleep(800);
      for (let i = 0; i < Math.min(freigaben.length, 3); i++) {
        const an = await warteAuf(() => document.getElementById('root_recipientApprovalPayment' + (i + 1)), 'Feld Freigabe ' + (i + 1) + ' an');
        const hoehe = document.getElementById('root_amountApprovalPayment' + (i + 1));
        eingabeSetzen(an, freigaben[i].text); an.blur();
        await sleep(500);
        eingabeSetzen(hoehe, euroText(freigaben[i].cent)); hoehe.blur();
        await sleep(500);
        status('Freigabe ' + (i + 1) + ': ' + freigaben[i].firma + ' – ' + euroText(freigaben[i].cent) + ' €');
      }
      if (freigaben.length > 3) status('⚠ ' + freigaben.length + ' Firmen-Freigaben, nur 3 Felder – bitte Rest prüfen');
    }
    status('Warte auf Speichern …');
    await warteAufSpeichern();

    // Stundenabrechnung
    status('Zurück zur Bewertung …');
    await zurBewertung();
    status('Öffne ' + E.formularName + ' …');
    const oeffnen = await warteAuf(() => {
      const titel = [...document.querySelectorAll('*')].find(
        (e) => e.children.length === 0 && e.textContent.includes(E.formularName) && e.getClientRects().length);
      if (!titel) return null;
      let k = titel;
      for (let i = 0; i < 6 && k; i++) { k = k.parentElement; const b = k && elementMitText('Öffnen', k); if (b) return b; }
      return null;
    }, 'Formular ' + E.formularName);
    klick(oeffnen.closest('button') || oeffnen);
    await warteAuf(() => /\/forms\//.test(location.pathname), 'Formularseite');

    status('Lese Verlauf …');
    await rechterReiter('Verlauf');
    const v = await warteAuf(verlaufDaten, 'Termin im Verlauf');

    status('Fülle Stundenabrechnung …');
    const fm = await warteAuf(pdfFelder, 'PDF-Formular', 30000);
    pdfSetze(fm, 'DatumRow1', v.ueber);
    pdfSetze(fm, 'DatumRow2', v.unter);
    pdfSetze(fm, 'DatumRow3', v.unter);
    for (let i = 0; i < E.stunden.length; i++) pdfSetze(fm, 'StundenRow' + (i + 1), E.stunden[i]);
    for (let i = 0; i < E.taetigkeit.length; i++) pdfSetze(fm, 'TätigkeitRow' + (i + 1), E.taetigkeit[i]);
    pdfSetze(fm, 'Gefahrenekm', E.kilometer);
    await sleep(1000);

    if (E.entwurfSpeichern) {
      status('Speichere Entwurf …');
      const sp = await warteAuf(() => { const b = knopf('Entwurf speichern'); return b && !b.disabled ? b : null; }, 'Button Entwurf speichern');
      klick(sp);
      await warteAuf(() => textKnotenEnthaelt(/erfolgreich gespeichert/), 'Speicher-Bestätigung', 10000);
    }
  }

  /* ====================== ABLAUF B: LAS-STANDARD ====================== */
  async function ablaufLAS(daten) {
    const E = LAS;

    await sektion('Ausgehändigte Formulare');
    await radio('root_obligationHint', E.ausgehaendigteFormulare[0]);
    await radio('root_compensationForm', E.ausgehaendigteFormulare[1]);

    await sektion('Verdachtsmomente / Unstimmigkeiten');
    await radio('root_discrepanciesPresent', E.verdacht);

    await sektion('Schadenbeschreibung');
    await schadenursacheEintragen(daten.ursache);
    status('Schadenhergang: Textbaustein …');
    await textbaustein('root_damageDescription', E.hergangBaustein);
    ersetzeImEditor('root_damageDescription', '[Datum]', daten.schadendatum);

    await sektion('Polizei');
    await radio('root_isPoliceContacted', E.polizei);
    await sektion('Feuerwehr');
    await radio('root_isFireDepartmentContacted', E.feuerwehr);
    await sektion('Deckung');
    await radio('root_isCoveredBasedOnTerms', E.deckung);
    await sektion('Plausibilität');
    await radio('root_isPlausible', E.plausibilitaet);
    await sektion('Obliegenheitsverletzungen');
    await radio('root_obligations', E.obliegenheiten);
    await sektion('Grobe Fahrlässigkeit');
    await radio('root_negligence', E.grobeFahrlaessigkeit);
    await sektion('Sicherheitsvorschriften');
    await radio('root_safetyRegulations', E.sicherheitsvorschriften);
    await sektion('Regress');
    await radio('root_regress', E.regress);
    await sektion('Mehrfachversicherung');
    await radio('root_isDoubleInsured', E.mehrfachversicherung);

    await sektion('Handlungsempfehlungen');
    await radio('root_expertRequired', E.handlungsempfehlungen[0]);
    await radio('root_finalClaimSettlement', E.handlungsempfehlungen[1]);
    await radio('root_hotelcosts', E.handlungsempfehlungen[2]);
    for (const h of E.handlungsHaken) await haken(h);

    await sektion('Zahlungsempfehlung');
    await warteAuf(() => document.getElementById('root_deduction'), 'Feld Selbstbeteiligung');
    const sb = document.getElementById('root_deduction');
    eingabeSetzen(sb, daten.sb); sb.blur();
    status('Warte auf Speichern …');
    await warteAufSpeichern();

    // Kalkulation nur bei Leitungswasser / Rohrbruch / Undichtigkeit / Rückstau / Elementar
    if (!daten.ursache) { status('✅ Fertig – keine Schadenursache, daher keine Kalkulation'); return; }
    if (!E.kalkulationBei.test(daten.ursache)) { status('Keine Kalkulation nötig (' + daten.ursache + ')'); return; }
    status('Wechsle in die Kalkulation …');
    await zurKalkulation();
    await standardKalkulationAnlegen();
  }

  // Gewerke + Stromverbrauch anlegen (LAS-Vorlage) – wird auch beim Sparkassen-Bericht genutzt
  async function standardKalkulationAnlegen() {
    for (const g of LAS.gewerke) {
      await gewerkHinzufuegen(g);
      if (g === LAS.strom.gewerk) await stromPosition(LAS.strom);
    }
  }

  function kalkulationLeer() {
    return !document.querySelector('.expandable') && !!textKnotenEnthaelt(/Klicken Sie auf/);
  }

  /* ============================== START ============================== */
  async function ablauf() {
    status('Lese Schadendaten …');
    await rechterReiter('Details');
    await warteAuf(() => detailWert('Schadendatum'), 'Schadendatum rechts');
    const daten = {
      ursache: schadenursache(),
      schadendatum: detailWert('Schadendatum'),
      sb: selbstbeteiligung(detailWert('Selbstbeteiligung')),
    };
    if (!daten.ursache) status('⚠ Keine Schadenursache ermittelt – wird übersprungen, keine Kalkulation');

    // Berichtsart bestimmen
    let name;
    if (imBericht()) {
      await warteAuf(() => elementMitText('Verdachtsmomente / Unstimmigkeiten'), 'Bericht geladen');
      name = (textKnotenEnthaelt(/^(Bericht |LAS-)/) || {}).textContent || '';
    } else {
      await zurBewertung();
      name = await aufnahmeName();
    }
    const sparkasse = /Sparkassenversicherung/.test(name);
    status('Berichtsart: ' + (sparkasse ? 'Sparkassenversicherung' : 'LAS-Standard / andere'));
    await sleep(800);

    await berichtOeffnen();
    if (sparkasse) await ablaufSparkasse(daten);
    else await ablaufLAS(daten);
  }

  /* ---------------------------- Start-Button ---------------------------- */
  let laeuft = false;

  function baueButton() {
    if (document.getElementById('cf-makro-panel')) return;
    if (!/\/claims\//.test(location.pathname)) return;
    const panel = document.createElement('div');
    panel.id = 'cf-makro-panel';
    panel.style.cssText = 'position:fixed;bottom:20px;left:70px;z-index:999999;font:13px sans-serif;' +
      'display:flex;flex-direction:column;align-items:flex-start;gap:6px;';
    statusEl = document.createElement('div');
    statusEl.style.cssText = 'background:#222;color:#fff;padding:5px 9px;border-radius:4px;display:none;max-width:340px;';
    const btn = document.createElement('button');
    btn.textContent = '▶ Makro starten';
    btn.style.cssText = 'background:#f07c3a;color:#fff;border:none;padding:10px 16px;border-radius:6px;' +
      'cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.3);font-weight:bold;';
    btn.addEventListener('click', async () => {
      if (laeuft) return;
      laeuft = true; btn.disabled = true; btn.style.opacity = '.6';
      try {
        await ablauf();
        status('✅ Fertig – bitte kurz kontrollieren');
      } catch (e) {
        status('❌ ' + e.message);
        console.error('[Claimsforce Makro]', e);
      } finally {
        laeuft = false; btn.disabled = false; btn.style.opacity = '1';
      }
    });
    panel.append(statusEl, btn);
    document.body.appendChild(panel);
  }

  setInterval(() => {
    const p = document.getElementById('cf-makro-panel');
    if (!/\/claims\//.test(location.pathname)) { if (p && !laeuft) p.remove(); return; }
    baueButton();
  }, 1000);
})();
