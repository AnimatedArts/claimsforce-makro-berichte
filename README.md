# Claimsforce Makro – Berichte

Tampermonkey-Skript, das auf **web.claimsforce.com** Berichte per Knopfdruck ausfüllt:

- **Bericht Sparkassenversicherung** – alle Sektionen, Stichpunkte aus der Kalkulation (bei Sturm/Hagel), Vorschusszahlung und Firmen-Freigaben aus der Kalkulation, SV-Stundenabrechnung
- **LAS-Standard (z. B. VHV)** – alle Sektionen, bei Leitungswasser/Rohrbruch/Undichtigkeit/Rückstau/Elementar zusätzlich die Standard-Kalkulation

## Installieren (einmalig)

1. In Chrome die Erweiterung **Tampermonkey** installieren.
2. In Chrome `chrome://extensions` öffnen → bei Tampermonkey **„Details“** → **„Nutzerskripts zulassen“** einschalten (bei manchen Versionen stattdessen oben rechts den **Entwicklermodus**).
3. Diesen Link öffnen und in Tampermonkey auf **„Installieren“** klicken:

   **https://raw.githubusercontent.com/AnimatedArts/claimsforce-makro-berichte/main/claimsforce-makro.user.js**

4. Eine Claimsforce-Schadenseite öffnen – unten links erscheint **„▶ Makro starten“**.

Ältere Claimsforce-Skripte in Tampermonkey bitte ausschalten, damit sich nichts in die Quere kommt.

## Aktualisieren

Neben **„▶ Makro starten“** steht ein kleiner Button mit der installierten Version (z. B. **„⟳ v3.10“**).
Gibt es eine neuere Version, wird er **blau** und zeigt **„⟳ Update auf v…“** an.

**Aktualisieren:** auf diesen Button klicken → in Tampermonkey **„Aktualisieren“** klicken → Claimsforce-Seite neu laden (F5).

Tampermonkey sucht außerdem von selbst etwa einmal am Tag nach neuen Versionen.

## Benutzen

Auf einer Schadenseite (am besten **Bewertung**) auf **„▶ Makro starten“** klicken. Neben dem Button steht, was das Makro gerade macht. Am Ende „✅ Fertig – bitte kurz kontrollieren“. Bleibt es hängen, steht dort „❌ …“ mit dem Grund.
