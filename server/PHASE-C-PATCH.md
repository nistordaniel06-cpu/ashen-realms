# NIDRAVEN V10 — Faza C, patch 1

## Modificări
- `server.js`: crearea personajelor este serializată per cont în aceeași instanță (`store.withLock`).
- `db-postgres.js`: tranzacție cu advisory lock per cont și verificarea limitei de 3 personaje în aceeași tranzacție. Returnează -1 pentru limită atinsă, 0 pentru nume deja existent.

## Verificări executate
- `node --check server.js`: trecut.
- `node --check db-postgres.js`: trecut.
- `node test-perms.js`: blocat (`ws` nu este instalat în mediul curent).

## Limitări
- Nu au fost rulate teste PostgreSQL pentru acest patch. Nu s-a făcut deployment, nu s-a modificat Supabase sau GitHub.
- Compatibilitatea adaptorului V10 cu schema Supabase existentă trebuie verificată înainte de conectare: migrarea automată V10 presupune o schemă proprie, în timp ce `nidraven_game` conține deja tabele din migrarea anterioară.
- Advisory lock folosește identificatorul contului convertit la integer; pentru ID-uri care depășesc int32 trebuie adoptat un lock key bigint.
