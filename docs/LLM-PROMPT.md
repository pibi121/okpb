# Локальный LLM для сценариев / промптов (Metalnode)

Дата: **2026-08-13**  
SSH (туннель Comfy + WebUI + Prompt Composer):

```powershell
ssh -i "path/to/metalnode_id_ed25519 (7).txt" -L 8188:localhost:8188 -L 8080:localhost:8080 -L 8090:localhost:8090 root@$METALNODE_HOST -p 22022
```

## Prompt Composer (тестовый UI шаблонов)

| | |
|--|--|
| URL | **http://localhost:8090** |
| Назначение | Выбор персонажа / позы / стиля → склейка EN-промпта для Krea2 |
| Модель | `gemma4-heretic` через Ollama (`think: false`) |
| Пресеты | `/work/peachbitch/presets/prompt_presets.json` |
| Custom-персонажи | `/work/peachbitch/presets/custom_characters.json` |
| Код | `/work/peachbitch/scripts/prompt_composer_app.py` |
| Рестарт стека | `bash /work/bin/restart-llm-stack.sh` |

**Как пользоваться:**
1. Подними SSH с `-L 8090:localhost:8090`
2. Открой **http://localhost:8090**
3. Выбери: персонаж (`olh_person` LoRA / без / custom) → позу → стиль
4. Если без LoRA — кратко опиши персонажа; можно **Сохранить** как пресет
5. «Склеить промпт» → копируй итог в Comfy (`krea2_t2i_olh_nsfw_READY` и т.п.)

Первый холодный старт модели ~1–2 мин / ~24 GB VRAM; дальше ответы ~4–8 сек.

## Open WebUI (свободный чат)

| | |
|--|--|
| URL | **http://localhost:8080** |
| Авторизация | выключена (`WEBUI_AUTH=False`) |
| Модель | **`gemma4-heretic`** |
| Логи | `/work/logs/open-webui.log`, `/work/logs/ollama.log` |

## Модель

| | |
|--|--|
| Модель | **Gemma 4 31B Heretic** (uncensored) |
| Квант | Q5_K_M (~21 GB GGUF) |
| Runtime | Ollama `gemma4-heretic:latest` |
| API | `http://127.0.0.1:11434` |
| Важно | В `/api/chat` всегда передавай **`"think": false`**, иначе ответ уходит в `message.thinking` и UI «молчит» |

GGUF: `/work/llm/gguf/gemma-4-31B-it-heretic.Q5_K_M.gguf`  
Modelfile: `/work/llm/Modelfile`

## Одна GPU с Comfy

На RTX 5090 нельзя нормально держать Comfy (Krea ~13–25 GB) и LLM (~24 GB) одновременно:
- **Перед тестами промптов** — останови/выгрузи Comfy (VRAM свободно ~<1 GB)
- **Перед генерацией Krea** — можно оставить Ollama (KEEP_ALIVE 30m сам отпустит), либо `curl http://127.0.0.1:11434/api/generate -d '{"model":"gemma4-heretic","keep_alive":0}'`

Рестарт LLM-стека: `bash /work/bin/restart-llm-stack.sh`  
Supervisor: `ollama` / `open-webui` / `prompt-composer` в `/etc/supervisor/conf.d/llm.conf` (если FATAL — вручную через restart-скрипт; конфликт с уже запущенным `ollama serve`).

## Связь с продуктом

Слой **PromptComposer** (ROADMAP D): character + pose/style presets + user note → EN prompt для Krea2 / Flux / позже MiniMax. Сейчас lab-UI только для сборки первых NSFW-шаблонов.
