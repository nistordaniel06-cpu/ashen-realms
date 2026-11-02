# NIDRAVEN V10 — Faza C, patch 2

- Conexiunile PostgreSQL remote validează certificatul TLS implicit.
- Migrarea automată refuză să ruleze pe tabele NIDRAVEN preexistente fără versiune în schema_migrations; nu șterge și nu rescrie date.
- Nu s-a făcut migrare live Supabase. Este necesară reconcilierea explicită a structurii existente.
- Teste: node --check db-postgres.js (passed). Nu au fost rulate teste PG/WS.
