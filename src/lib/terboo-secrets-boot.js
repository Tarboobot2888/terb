// ═══════════════════════════════════════════════
// 🔐 تفعيل حماية الأسرار عند الإقلاع (يُستورد مبكراً في index.js)
// ───────────────────────────────────────────────
// يسجّل كل أسرار config.js والبيئة في سجل الإخفاء، ويجعل console.* لا يطبع أي سر.
// ═══════════════════════════════════════════════

import config from "../../config.js";
import { installConsoleRedaction, registerConfigSecrets } from "./terboo-secrets.js";

registerConfigSecrets(config);
installConsoleRedaction();
