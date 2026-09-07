#!/usr/bin/env python3
from pathlib import Path

for rel in [
    "/workspace/train/ai-toolkit/toolkit/config_modules.py",
    "/workspace/train/ai-toolkit/toolkit/dataloader_mixins.py",
]:
    p = Path(rel)
    t = p.read_text(encoding="utf-8")
    # fix broken literal \n patch
    bad = "try:\\n    import torchaudio\\nexcept Exception:\\n    torchaudio = None  # optional for image LoRA"
    bad2 = "try:\\n    import torchaudio\\nexcept Exception:\\n    torchaudio = None"
    good = "try:\n    import torchaudio\nexcept Exception:\n    torchaudio = None  # optional for image LoRA"
    if bad in t:
        t = t.replace(bad, good)
        print("fixed literal", p)
    elif bad2 in t:
        t = t.replace(bad2, good)
        print("fixed literal2", p)
    elif "import torchaudio" in t and "torchaudio = None" not in t:
        t = t.replace(
            "import torchaudio",
            "try:\n    import torchaudio\nexcept Exception:\n    torchaudio = None  # optional for image LoRA",
            1,
        )
        print("patched fresh", p)
    else:
        print("ok/skip", p)
    p.write_text(t, encoding="utf-8")
    # verify compiles
    compile(t, str(p), "exec")
    print("compile ok", p)
