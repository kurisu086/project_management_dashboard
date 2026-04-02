const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPendingReviewModel
} = require("./state-generator-pending-review");

test("pending cleanup prompt explicitly tells Codex to write back .codex-control files", () => {
  const result = buildPendingReviewModel({
    overviewSources: {
      superpowers: {
        workflow: {}
      }
    },
    verificationMatrix: [
      { label: "Validation item 1", note: "Rename this placeholder verification target." }
    ],
    mergedRisks: [
      { title: "Risk item 1", detail: "Rename this placeholder risk title." }
    ],
    conflicts: [
      { level: "medium", message: "Version target differs across sources." }
    ]
  });

  assert.match(result.codexCleanupPrompt, /directly update the matching files under \.codex-control\//i);
  assert.match(result.codexCleanupPrompt, /Do not only reply in chat/i);
  assert.match(result.codexCleanupPrompt, /\.codex-control files you updated/i);
  assert.match(result.codexCleanupPrompt, /project_brief\.json/i);
  assert.match(result.codexCleanupPrompt, /project_state\.json/i);
});
