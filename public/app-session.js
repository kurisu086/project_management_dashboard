export function loadDismissedPendingReview(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    return {};
  }
}

export function saveDismissedPendingReview(storageKey, value) {
  localStorage.setItem(storageKey, JSON.stringify(value));
}

export function prefillAddFormFromQuery(state) {
  const params = new URLSearchParams(window.location.search);
  state.addForm.path = params.get("path") || state.addForm.path;
  state.addForm.name = params.get("name") || state.addForm.name;
}

export function maybeOpenPendingReviewOverlay(state, snapshot) {
  const pending = snapshot?.detail?.pendingReview;
  if (!pending?.count) {
    state.pendingReviewOpen = false;
    return;
  }
  const dismissed = state.dismissedPendingReview[snapshot.project.id];
  state.pendingReviewOpen = dismissed !== pending.signature;
}

export function closePendingReviewOverlay(state, refs, storageKey, recordDismissal = true) {
  if (recordDismissal && state.activeSnapshot?.project?.id && state.activeSnapshot?.detail?.pendingReview?.signature) {
    state.dismissedPendingReview[state.activeSnapshot.project.id] = state.activeSnapshot.detail.pendingReview.signature;
    saveDismissedPendingReview(storageKey, state.dismissedPendingReview);
  }
  state.pendingReviewOpen = false;
  refs.pendingReviewOverlay.hidden = true;
}

export function renderPendingReviewOverlay(refs, html, open) {
  refs.pendingReviewContent.innerHTML = html;
  refs.pendingReviewOverlay.hidden = !open;
}

