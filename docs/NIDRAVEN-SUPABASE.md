# NIDRAVEN — Supabase persistence

Supabase project: `ddhilzlkxmsgmggftwmy` (existing NOVA Trade project). Private schema: `nidraven_game`.

Applied and verified migrations:
- `nidraven_game_private_persistence_v1`: accounts, sessions, characters, blocks, chat_log, audit.
- `nidraven_social_and_progression_schema_v1`: guilds, guild_members, parties, party_members, titles, character_titles, character_equipment, skins, character_skins, mounts, character_mounts, bp_seasons, bp_progress, currency_ledger.

The schema has grants revoked from `anon` and `authenticated`; only the trusted server should access it using a server-side PostgreSQL connection. Do not expose database credentials in browser code or GitHub.

IMPORTANT: Existing `db.js` uses synchronous `node:sqlite`; this is NOT yet wired to PostgreSQL. Convert its interface and callers (`server.js` and `social.js`) to asynchronous database operations, retaining account hashing, session semantics, character ownership checks, and atomic guild operations. Test two simultaneous clients and reconnect persistence before deploying as production multiplayer. SQLite on Render free has ephemeral disk and must not be relied on for permanent saves.
