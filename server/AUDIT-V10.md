# NIDRAVEN V10 — Faza A: audit SQLite sincron → PostgreSQL asincron

## Dependențe între module
`server.js` → `store.js` (salvări, cache, lacăt, epoch) → adaptor: `db-postgres.js` (DATABASE_URL) sau `db-async.js`→`db.js` (SQLite, dev/teste).
`social.js` primește `db` prin contextul `server.js` (fațada `store.db`, fără `saveChar`). `catalog.js`, `permissions.js` nu ating DB-ul.

## Inventar funcție-cu-funcție (V9 → V10)
| Funcție / loc | V9 | V10 |
|---|---|---|
| `db.register`, `verify` | sync, scrypt blocant | async; scrypt în threadpool (PG); hash calculat și pentru cont inexistent |
| `db.newSession`, `session`, `endSession` | sync | async; hash SHA-256 al tokenului păstrat; purge sesiuni expirate max 1/min |
| `db.chars`, `char(id,acc)` | sync | async; proprietate prin `account_id` în WHERE |
| `db.addChar` | sync | async; 23505 → 0 |
| `db.saveChar` | sync, în bucla de joc | doar prin `store.save()`: instantaneu clonat, serializat per personaj, coalescat, retry, `WHERE id AND account_id` |
| `db.accInfo`, `role` | sync | async + cache 5 s, invalidat la `setBan/setMute/setRole` |
| `db.audit`, `log`, `addBlock`, `delBlock` | sync | async „fire-and-forget”: erorile nu ajung în gameplay, sunt numărate și păstrate în inel |
| `db.createGuild` | BEGIN/COMMIT manual | tranzacție PG (`BEGIN/COMMIT/ROLLBACK`), atomic |
| guild: `guildOf/guildMembers/add/remove/setRank/delete` | sync | async |
| `charByName`, `setBan/Mute/Role`, `audits` | sync | async |
| `mkPlayer` | citea DB intern | primește `blocks` și `accInfo` încărcate înainte (fără I/O în constructor) |
| `leave(p)` | `saveChar` sync | `store.save(snap)` (neblocant) |
| `join` | citire sync + înlocuire sesiune veche | `withLock(char)` → leave(old) → `flush(char)` → reîncărcare → `nextEpoch` (fără duplicare/stare veche) |
| handler `ws.on('message')` | sync | coadă promisiuni per socket (ordine garantată); limită de coadă (100) |
| `social.command/guildCmd/staffCmd` | sync | async; acțiunile sensibile (`/ban`, `/setrole`) rămân sub `/confirm` |
| `close()` server | `saveChar` sync | flush al tuturor salvărilor, apoi `adb.close()` |
| `/health`, `/ready` | doar `/health` | `/ready` verifică DB-ul (timeout 2,5 s, 503 la eșec) |

## Limitări cunoscute (reale)
- Cache-ul de cont (5 s): un rol schimbat direct în SQL (nu prin server) se aplică după maxim 5 s.
- Limita „3 eroi/cont” se verifică în aplicație; două sockete ale aceluiași cont care creează simultan pot depăși limita (de întărit în V10-F cu constrângere în DB).
- Serverul rulează într-o singură instanță (stare de joc în memorie); mai multe instanțe ar necesita sharding pe zone.
- Testat pe PostgreSQL 16 local. Supabase și Render NU au fost accesibile din sandbox.
