<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Git

Перед работой и перед заливкой: `git pull` → правки → коммит → `git push`.

Force-push в `main` нельзя. Если push отклонён — снова `git pull`, при конфликте разобрать файл (не затирать чужое целиком), затем `git push`.

Не коммитить: `HANDOFF/` (только локально), `.env`, ключи, `infra/metalnode.local.json`.
