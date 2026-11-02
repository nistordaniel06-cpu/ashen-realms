# NIDRAVEN V9 — Multiplayer persistent

Use NIDRAVEN V8.5 as source. Supabase existing NOVA Trade project ddhilzlkxmsgmggftwmy, private schema nidraven_game. Do not create a new project.

1. Audit synchronous DB calls in server.js and social.js.
2. Integrate async PostgreSQL adapter for auth, sessions, character load/save, roles, chat, guilds and GM commands. Await every required operation.
3. Keep DB I/O outside 50ms game tick; queue and coalesce character saves; flush on disconnect/shutdown.
4. Parameterized queries, TLS, server-only DATABASE_URL, scrypt password hashing, hashed tokens and ownership checks.
5. Preserve existing gameplay and UI.
6. Test two concurrent WebSocket players, reconnect, server restart, independent XP/gold/inventory/position persistence, and access denial across accounts.
7. Push tested code to feature/v8-multiplayer-server, deploy on Render Frankfurt free, verify HTTPS/WSS before claiming success.

Report actual changes, commit, tests and remaining blockers. Do not claim untested features work.
