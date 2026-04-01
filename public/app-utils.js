export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function isFieldObject(value) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, "value");
}

export function getFieldValue(value) {
  return isFieldObject(value) ? value.value : value;
}

export function getFieldSourceKind(value) {
  return isFieldObject(value) ? value.sourceKind || value.source_kind || "declared" : "neutral";
}

export function getFieldSourceRef(value) {
  return isFieldObject(value) ? value.source_ref || value.source || "" : "";
}

export function getFieldConfidence(value) {
  return isFieldObject(value) ? value.confidence || "medium" : "medium";
}

export function getFieldUpdatedAt(value) {
  return isFieldObject(value) ? value.last_updated_at || value.updatedAt || "" : "";
}

export function formatDateTime(value) {
  if (!value) {
    return "unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function formatMultiline(value) {
  return escapeHtml(String(value ?? "")).replaceAll("\n", "<br />");
}

export function humanizeKey(value) {
  return String(value || "")
    .replaceAll(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function truncate(value, max = 240) {
  const text = String(value ?? "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

export function sourceTagClass(kind) {
  switch (normalizeValue(kind)) {
    case "fact":
    case "verified":
      return "source-fact";
    case "declared":
      return "source-declared";
    case "supplemental":
      return "source-supplemental";
    case "needs_confirmation":
    case "pending":
      return "source-pending";
    default:
      return "source-neutral";
  }
}

export function statusTagClass(status) {
  const value = normalizeValue(status);
  if (["done", "ready", "implemented", "verified", "passed", "updated"].includes(value)) {
    return "status-good";
  }
  if (["high", "critical", "blocked", "failed"].includes(value)) {
    return "risk-high";
  }
  if (["medium", "partial", "limited", "pending_validation", "not_run", "unknown", "needs_confirmation"].includes(value)) {
    return "risk-medium";
  }
  return "source-neutral";
}

export function renderTag(text, className = "source-neutral") {
  if (!text) {
    return "";
  }
  return `<span class="tag ${className}">${escapeHtml(text)}</span>`;
}

export function renderSourcePill(kind, label) {
  return renderTag(label || kind || "unknown", sourceTagClass(kind));
}

export function renderStatusPill(status, label) {
  return renderTag(label || status || "unknown", statusTagClass(status));
}

export function renderRiskPill(level, label) {
  const normalized = normalizeValue(level);
  const className = normalized === "high" || normalized === "critical" ? "risk-high" : "risk-medium";
  return renderTag(label || level || "risk", className);
}

export function renderConflictPill(count) {
  const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
  return renderTag(`来源不一致 ${safeCount}`, safeCount > 0 ? "risk-high" : "source-neutral");
}

export function renderUsageCallout(title, body, bullets = []) {
  return `
    <section class="usage-callout">
      <strong>${escapeHtml(title)}</strong>
      <p class="inline-subcopy">${escapeHtml(body)}</p>
      ${
        bullets.length
          ? `<ul>${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : ""
      }
    </section>
  `;
}

export function renderKeyValueRows(items) {
  return `
    <div class="data-list">
      ${items
        .map((item) => {
          const tags = item.tags || [];
          return `
            <div class="data-row">
              <div>
                <strong>${escapeHtml(item.label)}</strong>
                <small>${item.valueHtml ?? escapeHtml(String(item.value ?? "unknown"))}</small>
              </div>
              <div class="pill-list">${tags.join("")}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderFieldRow(label, field, options = {}) {
  const value = getFieldValue(field);
  const tags = [
    renderSourcePill(getFieldSourceKind(field), options.sourceLabel || sourceLabel(getFieldSourceKind(field))),
    renderStatusPill(getFieldConfidence(field), options.confidenceLabel || getFieldConfidence(field)),
    options.includeUpdated ? renderTag(formatDateTime(getFieldUpdatedAt(field)), "source-neutral") : ""
  ].filter(Boolean);
  return {
    label,
    valueHtml: options.multiline ? formatMultiline(value || "unknown") : escapeHtml(String(value || "unknown")),
    tags
  };
}

export function sourceLabel(kind) {
  switch (normalizeValue(kind)) {
    case "fact":
      return "已知事实";
    case "declared":
      return "项目声明";
    case "supplemental":
      return "补充来源";
    case "needs_confirmation":
      return "待确认";
    default:
      return "来源";
  }
}

export function displayValidationLabel(item, index) {
  const raw = String(item?.label || item?.title || "").trim();
  if (!raw || /^validation item\b/i.test(raw) || raw === "未命名验证项") {
    return `验证项 ${index + 1}（待命名）`;
  }
  return raw;
}

export function displayRiskTitle(item, index) {
  const raw = String(item?.title || item?.label || "").trim();
  if (!raw || /^risk item\b/i.test(raw) || /^unnamed risk$/i.test(raw) || raw === "未命名风险") {
    return `风险项 ${index + 1}（待命名）`;
  }
  return raw;
}

export async function copyText(text) {
  const value = String(text ?? "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function parseLooseJson(text) {
  const input = String(text ?? "").trim();
  if (!input) {
    throw new Error("结构化结果为空。");
  }

  const fenceMatch = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : input;

  try {
    return JSON.parse(candidate);
  } catch {}

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("未能从输入中解析出有效 JSON。");
}

export function uniqueStrings(items) {
  return [...new Set(toArray(items).filter(Boolean).map((item) => String(item)))];
}

export function joinLines(items) {
  return toArray(items).filter(Boolean).join("\n");
}

export function flattenTextList(items) {
  return toArray(items)
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (isFieldObject(item)) {
        return item.value;
      }
      if (isObject(item) && item.label) {
        return item.label;
      }
      return String(item ?? "");
    })
    .filter(Boolean);
}

export function buildEmptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

export function buildJsonPreview(value) {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}
