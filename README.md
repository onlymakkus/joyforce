# Joyforce

Statische Seite, die gegen dieselbe Supabase-Instanz läuft wie onlymakkus.de.
Kein Server, kein Build-Schritt — reine Dateien, direkt über GitHub Pages hostbar.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Das Design + die Komponenten-Logik |
| `support.js` | Runtime des Design-Exports (lädt React/Babel vom CDN) |
| `jf-data.js` | Supabase-Anbindung: Login, Einträge, Ranking |
| `schema.sql` | Die neuen Tabellen — einmal im Supabase SQL Editor ausführen |

## Schritt 1 — Datenbank

`schema.sql` im Supabase SQL Editor ausführen. Legt an:

- `jf_entries` — ein Wert pro Profil und Tag, `unique (profile_id, day)`,
  neuer Eintrag am selben Tag überschreibt den alten (upsert).
- `jf_ranking` — View: Schnitt der letzten 7 Tage je Profil, verbunden mit
  `profiles` für Name und Avatar.

`profiles` wird nur gelesen, nichts daran geändert.

Vorher einmal gegenprüfen, ob die Spaltennamen stimmen:

```sql
select * from public.profiles limit 1;
```

## Schritt 2 — GitHub Pages

```bash
git init
git add .
git commit -m "Joyforce"
git branch -M main
git remote add origin https://github.com/DEIN-USER/joyforce.git
git push -u origin main
```

Dann im Repo: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
Nach ein bis zwei Minuten liegt die Seite auf
`https://DEIN-USER.github.io/joyforce/`.

Eigene Domain: `CNAME`-Datei mit der Domain ins Repo, DNS auf GitHub zeigen
lassen, in Settings → Pages eintragen.

## Der eine Haken: Login

localStorage ist pro Origin isoliert. `github.io` ist eine andere Origin als
`onlymakkus.de`, also wird die Session **nicht** geteilt — man meldet sich hier
einmal separat an, mit demselben Namen und Passwort. Die Prüfung läuft gegen
dieselbe `profiles`-Zeile, es ist also derselbe Account, nur eine zweite
Anmeldung.

Wenn Joyforce als Subdomain von onlymakkus.de laufen soll, ändert das nichts:
`joyforce.onlymakkus.de` und `onlymakkus.de` sind für localStorage ebenfalls
getrennt. Geteilte Sessions bräuchten Cookies auf `.onlymakkus.de` statt
localStorage — machbar, aber eine Änderung auf beiden Seiten.

## Was noch offen ist

- Der `anon`-Key erlaubt Schreibzugriff auf jede Zeile in `jf_entries`, also
  auch auf fremde. Für eine Gruppe, die sich kennt, ist das in Ordnung; für
  ein öffentliches Ranking wäre eine RPC-Funktion mit Passwortprüfung sauberer.
- `index.html` lädt React und Babel zur Laufzeit von unpkg. Funktioniert, ist
  aber der langsamste Teil. Später gegen eine vorkompilierte Version tauschbar.
- Die Übungsbilder in „Technik" sind noch Platzhalter.
