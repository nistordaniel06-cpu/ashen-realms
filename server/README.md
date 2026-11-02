# NIDRAVEN — FORGE YOUR LEGEND · V9.0 (server + client)

**Stare:** implementat și testat LOCAL (server + 2 clienți reali). **NU este deployat nicăieri.** Niciun URL public nu există încă.

## Ce conține
- `server.js` — server autoritativ (Node 22 + `ws`), simulare la 20 Hz, snapshot-uri la 10 Hz.
- `db.js` — persistență SQLite (`node:sqlite`): conturi (scrypt+salt), sesiuni (token hash SHA-256), eroi, blocări, chat_log, audit.
- `zones.json` — date de coliziune/spawn exportate din clientul V7 (6 zone). Generate cu `tools/export-zones.js` (necesită harness-ul de test V7; fișierul generat e inclus).
- `nidraven.html` — jocul (V7 complet + mod Online). Servit de server la `/`.
- `schema.sql` — echivalent Postgres/Supabase (**netestat**).
- `test-v8.js` — 53 teste de protocol cu clienți WebSocket reali.

## Rulare locală
```
npm install
cp .env.example .env     # apoi exportă variabilele sau setează-le în shell
npm start                # http://localhost:8080  (jocul) · ws://localhost:8080 (server) · /health
npm test                 # rulează testele (server pe port aleator, DB temporar)
```
Cerințe: Node >= 22.5 (folosește `node:sqlite`, experimental).
În joc: buton glob (sus) → adresa se precompletează dacă jocul e servit de server → Cont nou → creează erou → joacă. Al doilea jucător: alt browser/telefon, alt cont.
Pentru acces din telefon în aceeași rețea: `ws://IP-ul-calculatorului:8080` (fără TLS; doar pentru test).

## Variabile de mediu (fără secrete reale)
`PORT`, `DB_PATH`, `STATIC_FILE`, `ALLOWED_ORIGINS` — vezi `.env.example`. Nu există chei API în client sau în repo.

## Deployment (NEEDEFECTUAT — pași recomandați)
Serverul ține conexiuni WebSocket persistente și un fișier SQLite, deci are nevoie de un proces permanent + volum persistent (nu funcționează pe platforme serverless).
1. Alege o platformă cu containere/procese persistente (ex. Fly.io, Railway, Render, un VPS) cu volum persistent.
2. Construiește imaginea din `Dockerfile` (`docker build -t nidraven .`), montează un volum la `/data`.
3. Platforma trebuie să ofere HTTPS; clientul va folosi automat `wss://` când pagina e încărcată prin https.
4. Setează `ALLOWED_ORIGINS` la domeniul tău. Verifică `GET /health`.
5. Backup: copiază periodic `nidraven.db` (WAL activat).
Acești pași NU au fost executați în această livrare.

## Protocol (rezumat)
Client→Server: `reg|login|tok|newchar|join|in|atk|sk|chat|zone|use|block|unblock|report|ping|logout`.
Server→Client: `auth|chars|joined|snap|inv|ev|chat|err|pong`. Serverul ignoră orice câmp necunoscut (aur, xp, daune etc. trimise de client nu sunt citite).

## Limitări cunoscute (V8)
- Server necomercial, nedeployat; o singură instanță (fără scalare orizontală); salvare la 15 s + la deconectare.
- Abilitățile online sunt simplificate: 1 = lovitură puternică, 2 = explozie în jur, 3 = vindecare (nu sunt efectele complete din single-player).
- Inventarul online = stive simple (materiale/poțiuni). Echipamentul, atributele, meșteșugurile, banca, magazinele, misiunile, dialogurile și cuferele rămân doar în single-player (online sunt blocate cu mesaj).
- Ruinele Cenușii (dungeon) nu sunt jucabile online (porți/boss locale).
- Fără ranguri GM, ghilde, party, titluri, mount-uri, battle pass, shop, i18n (V8.5–V12 — neimplementate).
- Chat: nu există canale Party/Guild/Staff; moderare = filtru + rate limit + block + report (înregistrat în audit); fără panou de administrare.
- Supabase Auth: neimplementat (autentificare proprie scrypt). `schema.sql` e doar o pregătire.
- Predicția de mișcare e simplă (reconciliere moale); pe latență mare (>300 ms) poate apărea corecție vizibilă.
- Nu s-a testat pe internet real, doar loopback; nu s-a testat încărcarea cu zeci de jucători.

## V8.0 — permisiuni și structuri pregătite
- `permissions.js`: ranguri FOUNDER > ADMINISTRATOR > HEAD_GM > GAME_MASTER > TRIAL_GM > MODERATOR > PLAYER, matrice de permisiuni, comenzi sensibile marcate „cer confirmare”. Rangul e verificat doar pe server; clientul nu poate cere un rang. FOUNDER = contul din `FOUNDER_ACCOUNT` (mediul serverului); numele rezervat se înregistrează doar cu `FOUNDER_SETUP_CODE`. Testat în `test-perms.js`.
- **Nu există încă** comenzi GM, panou admin, canal Staff sau audit viewer — doar fundația verificabilă.
- Tabele goale pregătite în SQLite (și în `schema.sql`): ghilde (rang de ghildă separat), party, titluri, echipament vizibil, skin-uri, mount-uri, Battle Pass, ledger monedă de TEST. **Nefuncționale** până la implementare (V8.5–V10).

## V8.5 — Social (implementat și testat local; nedeployat)
**Party** (în memorie, max 4): `/invite Nume`, `/accept`, `/decline`, `/leave`, `/pkick Nume`, `/plead Nume`, `/party`, canal `/p mesaj`. XP partajat între membrii aflați în aceeași regiune la ≤25 tile; loot-ul rămâne la cel care dă lovitura finală. Party-ul NU persistă după restart/deconectare.
**Ghilde** (persistente, ranguri LEADER/OFFICER/MEMBER, separate de rangurile staff): `/gcreate TAG Nume`, `/ginvite`, `/gaccept`, `/gleave`, `/gkick`, `/gpromote`, `/gdemote`, `/gleader`, `/gdisband`, `/ginfo`, canal `/g mesaj`. Tag-ul `<TAG>` apare în nameplate.
**Canale chat:** Local, World, Party, Ghildă, Șoaptă, Sistem, Staff (doar rang ≥ Moderator). Alias-uri: `/l`, `/world`, `/w Nume mesaj`, `/p`, `/g`, `/s`.
**Staff (verificat pe server, cu audit):** `/mute Nume min` și `/unmute` (Moderator), `/kick` (Trial GM), `/tp Nume` și `/announce` (GM), `/ban Nume min motiv`*, `/unban`, `/audit [n]` (Head GM), `/grantgold Nume n`* (Administrator), `/setrole Nume RANG`* (Administrator spre rang inferior; FOUNDER niciodată).
\* cer confirmare: serverul răspunde cu un cod de 4 cifre, valabil 30 s: `/confirm COD`. Nu poți acționa asupra unui rang egal sau superior. Încercările refuzate se înregistrează în audit.
**Teste:** `npm test` = 53 (protocol V8) + 13 (permisiuni) + 47 (social) teste cu clienți WebSocket reali.
**Limitări V8.5:** nu există panou vizual de administrare (doar comenzi în chat); party-ul nu persistă; ghilda nu are încă depozit/MOTD/chat istoric; moderarea e manuală (fără detectare automată); `/report` doar se înregistrează în audit; nimic testat pe internet real.

## V9.0 — Identity (implementat și testat local; nedeployat)
- **Titluri** (Novice, Explorator, Veteran, Străjer, Vânător, Ucigaș de Căpetenii), **skin-uri** (Clasic, Jar, Chiciură, Pădurar, Amurg, Aurit), **echipament vizibil** (armă, armură, coif, mănuși, cizme — 39 de piese exportate din clientul V7) și **monturi** (Cal de drum ×1.45, Lup de cenușă ×1.6).
- **Deblocările** se calculează pe server din progres (nivel, monștri învinși, boss ucis). Nu există plăți reale, cutii-surpriză sau avantaje cumpărate. Garderoba se deschide din butonul cu tricou (online).
- Piesele de echipament sunt **doar vizuale online** (nu dau statistici; lupta online depinde de nivel și clasă). Armele sunt limitate la clasa personajului.
- Montura: viteză mărită, dar **nu poți ataca călare** și **cobori dacă ești lovit**. Starea montării nu persistă.
- Protocol: `wd` (client: `get` sau `{k:gear|title|skin|mount,id}`; server: catalog + ce e deblocat + ce e echipat). Persistență în `characters.cosm`, `kills`, `bosskills`. Tabelele goale din V8.0 pentru skin/mount/echipament rămân neutilizate.
- Randare client: același `drawChar` ca în single-player (straturi: skin → armură/cizme/mănuși/coif/armă), montura desenată sub personaj.
- **Teste:** `npm test` = 53 + 13 + 47 + 22; browser: 2 pagini (echipare din panou, vizibil la celălalt jucător, montură).
- **Limitări:** nu există încă magazin/Battle Pass/monedă de test (V10); numele sunt doar în română până la V11; piesele din inventarul single-player nu se sincronizează cu garderoba online; preview-ul personajului în panou lipsește (efectul se vede direct în joc); montura și piesele noi nu au sprite-uri desenate individual (aspect prin culoare/stil).


## V10 — Persistență PostgreSQL (Faza B)
- `DATABASE_URL` setat => PostgreSQL (schema privată `nidraven_game`, creată/migrată automat, idempotent, sub advisory lock). Fără el => SQLite (`DB_PATH`).
- Toate interogările sunt parametrizate; tabelele sunt calificate cu schema; nu se atinge nicio altă schemă.
- Salvări: serializate și coalescate per personaj, retry cu backoff doar la erori tranzitorii, flush la logout/reconectare/shutdown.
- Endpoint-uri: `GET /health` (proces), `GET /ready` (verifică DB; 503 dacă nu răspunde).
- Teste: `npm test` (SQLite + PG). Partea PG cere `TEST_DATABASE_URL` către o bază DE TEST (creează și șterge o schemă `nidraven_t_*`). Fără ea, testul PG iese cu cod 1 (sau `PG_OPTIONAL=1` pentru a-l sări explicit).
- Supabase: folosește șirul de conexiune al proiectului (pooler/direct) doar ca variabilă secretă pe server. Schema `nidraven_game` e creată de server; nu modifică tabelele existente.
- CI: `.github/workflows/ci.yml` (Postgres 16 ca service). Deploy: `render.yaml` (plan gratuit, Frankfurt; instanța free adoarme după inactivitate — jocul nu e disponibil continuu).
