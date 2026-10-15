// لوحات نصية قصيرة (دليل أمر · حالة) مبنية على محرّك التصميم الموحّد (§33–§36):
// عنوان المحرّك، صفوف «> ◈»، فاصل خفيف وتذييل — بلا backticks ولا زخارف قديمة.
import config from "../../config.js";
import * as UI from "./terboo-ui-theme.js";

function getFooter() {
  return config.bot?.name || "Bot Terboo";
}

function formatTextPanel({ icon = "✦", title, lines = [], footer = getFooter() } = {}) {
  const rows = lines
    .filter((line) => line !== undefined && line !== null && String(line).trim())
    .map((line) => UI.quote(`${UI.MARK.row} ${String(line).trim()}`));
  return UI.card({ title: title || getFooter(), icon, blocks: [rows.length ? rows : [UI.quote(`${UI.MARK.row} —`)]], footer });
}

function commandGuide({ icon = "📌", title, command, example, note, footer } = {}) {
  const lines = [];
  if (note) lines.push(note);
  if (command) lines.push(`*الاستخدام:* ${UI.code(command)}`);
  if (example) lines.push(`*مثال:* ${UI.code(example)}`);
  return formatTextPanel({ icon, title, lines, footer });
}

function statusPanel({ icon = "✅", title, details = [], footer } = {}) {
  return formatTextPanel({ icon, title, lines: details, footer });
}

export { getFooter, formatTextPanel, commandGuide, statusPanel };
