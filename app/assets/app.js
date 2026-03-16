(function () {
  const API_BASE = "/api/v1";

  const state = {
    jobs: [],
    aiStatus: null,
    currentRoute: "dashboard",
    selectedJobId: null,
    selectedNodeId: null,
    refreshTimer: null,
    isBusy: false
  };

  const elements = {
    navLinks: Array.from(document.querySelectorAll(".nav-link")),
    views: {
      dashboard: document.getElementById("view-dashboard"),
      review: document.getElementById("view-review"),
      history: document.getElementById("view-history")
    },
    heroMetrics: document.getElementById("heroMetrics"),
    aiStatusBanner: document.getElementById("aiStatusBanner"),
    aiStatusText: document.getElementById("aiStatusText"),
    dashboardJobList: document.getElementById("dashboardJobList"),
    historyTableBody: document.getElementById("historyTableBody"),
    historyStatusFilter: document.getElementById("historyStatusFilter"),
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("fileInput"),
    selectFileButton: document.getElementById("selectFileButton"),
    simulateUploadButton: document.getElementById("simulateUploadButton"),
    uploadProgress: document.getElementById("uploadProgress"),
    progressTitle: document.getElementById("progressTitle"),
    progressPercent: document.getElementById("progressPercent"),
    progressFill: document.getElementById("progressFill"),
    progressStep: document.getElementById("progressStep"),
    openNextReviewButton: document.getElementById("openNextReviewButton"),
    reviewSubtitle: document.getElementById("reviewSubtitle"),
    hierarchyTree: document.getElementById("hierarchyTree"),
    inspectorContent: document.getElementById("inspectorContent"),
    approveButton: document.getElementById("approveButton"),
    reprocessButton: document.getElementById("reprocessButton"),
    reviewStatusBadge: document.getElementById("reviewStatusBadge"),
    pageBadge: document.getElementById("pageBadge"),
    documentHighlight: document.getElementById("documentHighlight"),
    highlightLabel: document.getElementById("highlightLabel"),
    documentGlhValue: document.getElementById("documentGlhValue"),
    toastStack: document.getElementById("toastStack"),
    seedResetButton: document.getElementById("seedResetButton"),
    jobCardTemplate: document.getElementById("jobCardTemplate"),
    treeNodeTemplate: document.getElementById("treeNodeTemplate")
  };

  init().catch((error) => {
    pushToast("Startup failed", error.message || "Unable to load the application state.");
  });

  async function init() {
    bindEvents();
    await refreshAiStatus();
    await refreshJobs();
    renderAll();
    startPolling();
  }

  function bindEvents() {
    elements.navLinks.forEach((button) => {
      button.addEventListener("click", () => navigate(button.dataset.route));
    });

    elements.selectFileButton.addEventListener("click", () => elements.fileInput.click());
    elements.fileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (file) {
        await startUpload(file);
      }
      event.target.value = "";
    });

    elements.simulateUploadButton.addEventListener("click", async () => {
      await startUpload("Pearson_Qualification_Specification.pdf");
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      elements.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        elements.dropzone.classList.add("is-dragover");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      elements.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        elements.dropzone.classList.remove("is-dragover");
      });
    });

    elements.dropzone.addEventListener("drop", async (event) => {
      const file = event.dataTransfer.files[0];
      if (file) {
        await startUpload(file);
      }
    });

    elements.dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        elements.fileInput.click();
      }
    });

    elements.openNextReviewButton.addEventListener("click", () => {
      const job = getNextReviewJob();
      if (!job) {
        pushToast("No review jobs", "All extraction jobs are either processing or already persisted.");
        return;
      }
      state.selectedJobId = job.id;
      state.selectedNodeId = null;
      navigate("review");
    });

    elements.historyStatusFilter.addEventListener("change", renderHistory);
    elements.approveButton.addEventListener("click", () => void handleApprove());
    elements.reprocessButton.addEventListener("click", () => void handleReprocess());
    elements.seedResetButton.addEventListener("click", () => void resetDemo());
  }

  function navigate(route) {
    state.currentRoute = route;
    elements.navLinks.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.route === route);
    });
    Object.entries(elements.views).forEach(([key, view]) => {
      view.classList.toggle("is-active", key === route);
    });
    if (route === "review") {
      renderReview();
    }
  }

  function renderAll() {
    renderAiStatus();
    renderHeroMetrics();
    renderDashboardJobs();
    renderHistory();
    renderReview();
    navigate(state.currentRoute);
  }

  function renderHeroMetrics() {
    const metrics = [
      {
        label: "Jobs in queue",
        value: state.jobs.filter((job) => job.status === "review" || job.status === "processing").length
      },
      {
        label: "Persisted today",
        value: state.jobs.filter((job) => job.status === "persisted").length
      },
      {
        label: "Average confidence",
        value: `${Math.round(average(state.jobs.filter((job) => job.confidence > 0).map((job) => job.confidence)))}%`
      }
    ];

    elements.heroMetrics.innerHTML = "";
    metrics.forEach((metric) => {
      const card = document.createElement("div");
      card.className = "metric-card";
      card.innerHTML = `<span>${metric.label}</span><strong>${metric.value}</strong>`;
      elements.heroMetrics.appendChild(card);
    });
  }

  function renderAiStatus() {
    const aiStatus = state.aiStatus;
    if (!aiStatus) {
      elements.aiStatusBanner.className = "status-banner status-banner-neutral";
      elements.aiStatusText.textContent = "Checking provider configuration...";
      return;
    }

    const source = aiStatus.provider === "foundry"
      ? `Azure AI Foundry (${aiStatus.model})`
      : `${aiStatus.provider} (${aiStatus.model})`;

    if (aiStatus.configured) {
      elements.aiStatusBanner.className = "status-banner status-banner-success";
      elements.aiStatusText.textContent = `${source} is configured and ready for extraction.`;
      return;
    }

    elements.aiStatusBanner.className = "status-banner status-banner-warning";
    elements.aiStatusText.textContent = `${source} is not ready. ${aiStatus.issues.join(" ")} Fallback extraction remains available.`;
  }

  function renderDashboardJobs() {
    elements.dashboardJobList.innerHTML = "";
    [...state.jobs].sort(sortByUpdatedDesc).forEach((job) => {
      elements.dashboardJobList.appendChild(createJobCard(job));
    });
  }

  function renderHistory() {
    const filter = elements.historyStatusFilter.value;
    const jobs = [...state.jobs]
      .filter((job) => (filter === "all" ? true : job.status === filter))
      .sort(sortByUpdatedDesc);

    elements.historyTableBody.innerHTML = "";
    jobs.forEach((job) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>
          <strong>${escapeHtml(job.fileName)}</strong>
          <span>${escapeHtml(job.qualificationCode || "Not assigned")}</span>
        </td>
        <td>${createBadgeMarkup(getStatusLabel(job.status), getStatusVariant(job.status))}</td>
        <td>${job.confidence ? `${job.confidence}%` : "In progress"}</td>
        <td>${job.attempts}</td>
        <td>${formatDate(job.updatedAt)}</td>
        <td><button class="secondary-button" type="button">${job.status === "persisted" ? "View" : "Open"}</button></td>
      `;
      row.querySelector("button").addEventListener("click", () => openJob(job.id));
      elements.historyTableBody.appendChild(row);
    });
  }

  function renderReview() {
    const job = getSelectedJob();
    if (!job) {
      elements.reviewSubtitle.textContent = "Select a job from the queue to begin verification.";
      elements.hierarchyTree.innerHTML = "";
      elements.inspectorContent.className = "inspector-content empty-state";
      elements.inspectorContent.innerHTML = "<h4>No job selected</h4><p>Choose a job from Extract or History to open the review workspace.</p>";
      elements.approveButton.disabled = true;
      elements.reprocessButton.disabled = true;
      return;
    }

    elements.reviewSubtitle.textContent = `${job.fileName} | Qualification code ${job.qualificationCode || "Pending"} | Attempt ${job.attempts} | Source ${describeExtractionSource(job)}`;
    elements.pageBadge.textContent = `Page ${job.pages.current} of ${job.pages.total}`;
    setReviewBadge(job);
    updateDocumentFocus(job.documentFocus, job.reviewReady);
    elements.documentGlhValue.textContent = getUnitGlh(job);

    elements.approveButton.disabled = job.status !== "review" || !job.reviewReady || state.isBusy;
    elements.reprocessButton.disabled = job.status === "processing" || state.isBusy;

    if (!state.selectedNodeId) {
      const firstAttentionNode = findFirstAttentionNode(job.qualification) || job.qualification;
      state.selectedNodeId = firstAttentionNode ? firstAttentionNode.id : null;
    }

    renderTree(job);
    renderInspector(job);
  }

  function renderTree(job) {
    elements.hierarchyTree.innerHTML = "";
    if (!job.qualification) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = "<h4>Extraction is still running</h4><p>The review tree will populate once schema mapping and validation complete.</p>";
      elements.hierarchyTree.appendChild(empty);
      return;
    }
    elements.hierarchyTree.appendChild(createTreeNode(job.qualification));
  }

  function createTreeNode(node) {
    const fragment = elements.treeNodeTemplate.content.firstElementChild.cloneNode(true);
    const toggle = fragment.querySelector(".tree-toggle");
    const card = fragment.querySelector(".tree-card");
    const childrenWrap = fragment.querySelector(".tree-children");

    fragment.dataset.nodeId = node.id;
    fragment.classList.toggle("is-leaf", !node.children || !node.children.length);
    card.dataset.nodeId = node.id;
    card.querySelector(".tree-kind").textContent = node.kind;
    card.querySelector(".tree-title").textContent = node.title;
    card.querySelector(".tree-summary").textContent = node.summary || "";

    const badge = card.querySelector(".tree-badge");
    badge.outerHTML = createBadgeMarkup(confidenceLabel(node), confidenceVariant(node.confidence));

    if (!node.children || !node.children.length) {
      toggle.classList.add("hidden");
    } else {
      toggle.addEventListener("click", () => {
        const collapsed = childrenWrap.classList.toggle("is-collapsed");
        toggle.textContent = collapsed ? "+" : "-";
        toggle.setAttribute("aria-expanded", String(!collapsed));
      });
      node.children.forEach((child) => childrenWrap.appendChild(createTreeNode(child)));
    }

    card.addEventListener("click", () => selectNode(node.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(node.id);
      }
    });

    if (state.selectedNodeId === node.id) {
      card.classList.add("is-selected");
    }

    return fragment;
  }

  function selectNode(nodeId) {
    state.selectedNodeId = nodeId;
    renderReview();
  }

  function renderInspector(job) {
    const node = findNodeById(job.qualification, state.selectedNodeId) || job.qualification;
    if (!node) {
      elements.inspectorContent.className = "inspector-content empty-state";
      elements.inspectorContent.innerHTML = "<h4>No node selected</h4><p>Select a hierarchy item to inspect the extracted fields.</p>";
      return;
    }

    const fieldsMarkup = Object.entries(node.fields || {}).map(([key, value]) => {
      const editable = node.id === "unit-3" && key === "glh";
      return `
        <label class="inspector-field">
          <span>${startCase(key)}</span>
          <input data-field="${key}" value="${escapeAttribute(value)}" ${editable ? "" : "readonly"}>
        </label>
      `;
    }).join("");

    const artifactButtonMarkup = job.artifact ? "<button class=\"secondary-button\" id=\"openArtifactButton\" type=\"button\">Open uploaded PDF</button>" : "";

    elements.inspectorContent.className = "inspector-content";
    elements.inspectorContent.innerHTML = `
      <div class="inspector-block">
        <p class="panel-kicker">${escapeHtml(node.kind)}</p>
        <h4>${escapeHtml(node.title)}</h4>
        <p class="muted">${escapeHtml(node.summary || "No summary available")}</p>
        ${createBadgeMarkup(confidenceLabel(node), confidenceVariant(node.confidence))}
      </div>
      <div class="inspector-block">
        <div class="inspector-grid">${fieldsMarkup}</div>
      </div>
      <div class="inspector-block">
        <p class="inspector-note">${escapeHtml(node.guidance || "No validation warning for this node.")}</p>
        <div class="inspector-actions">
          ${node.id === "unit-3" ? "<button class=\"primary-button\" id=\"verifyNodeButton\" type=\"button\">Verify field</button>" : ""}
          <button class="secondary-button" id="focusNodeButton" type="button">Highlight source</button>
          ${artifactButtonMarkup}
        </div>
      </div>
    `;

    document.getElementById("focusNodeButton").addEventListener("click", () => {
      const focus = node.focus || job.documentFocus;
      updateDocumentFocus(focus, node.confidence >= 90);
      pushToast("Source linked", `${node.title} has been highlighted in the PDF context panel.`);
    });

    const artifactButton = document.getElementById("openArtifactButton");
    if (artifactButton) {
      artifactButton.addEventListener("click", () => {
        window.open(`${API_BASE}/jobs/${job.id}/artifact`, "_blank", "noopener,noreferrer");
      });
    }

    const verifyButton = document.getElementById("verifyNodeButton");
    if (verifyButton) {
      verifyButton.addEventListener("click", () => void verifyUnitGlh(job.id));
    }

    const glhInput = elements.inspectorContent.querySelector("input[data-field='glh']");
    if (glhInput) {
      glhInput.addEventListener("change", (event) => void updateUnitGlh(job.id, event.target.value));
    }
  }

  function setReviewBadge(job) {
    const label = job.status === "persisted"
      ? "Persisted"
      : job.reviewReady
        ? "Ready to persist"
        : job.status === "processing"
          ? "Processing"
          : "Needs validation";
    elements.reviewStatusBadge.className = `badge ${getStatusVariant(job.reviewReady ? "persisted" : job.status)}`;
    elements.reviewStatusBadge.textContent = label;
  }

  function updateDocumentFocus(focus, verified) {
    const top = focus && typeof focus.top === "number" ? focus.top : 31;
    const height = focus && typeof focus.height === "number" ? focus.height : 13;
    elements.documentHighlight.style.top = `${top}%`;
    elements.documentHighlight.style.height = `${height}%`;
    elements.highlightLabel.textContent = focus && focus.label ? focus.label : "Focus: selected node";
    elements.documentHighlight.classList.toggle("is-verified", Boolean(verified));
  }

  async function startUpload(input) {
    if (state.isBusy) {
      return;
    }

    const fileName = typeof input === "string" ? input : input.name;
    state.isBusy = true;
    setBusyState(true, `Uploading ${fileName}`);

    try {
      let response;
      if (typeof input === "string") {
        response = await apiFetch(`${API_BASE}/jobs/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: input })
        });
      } else {
        const formData = new FormData();
        formData.append("file", input, input.name);
        response = await apiFetch(`${API_BASE}/jobs/upload`, {
          method: "POST",
          body: formData,
          isMultipart: true
        });
      }

      state.selectedJobId = response.item.id;
      state.selectedNodeId = null;
      await refreshJobs();
      renderAll();
      pushToast("Upload accepted", `${fileName} has entered the extraction queue.`);
    } catch (error) {
      pushToast("Upload failed", error.message || "Unable to create extraction job.");
    } finally {
      state.isBusy = false;
      setBusyState(false);
    }
  }

  function openJob(jobId) {
    state.selectedJobId = jobId;
    state.selectedNodeId = null;
    navigate("review");
  }

  async function handleApprove() {
    const job = getSelectedJob();
    if (!job) {
      return;
    }
    if (!job.reviewReady) {
      pushToast("Review incomplete", "Verify the low-confidence node before persisting this qualification.");
      return;
    }

    try {
      setReviewButtons(true);
      await apiFetch(`${API_BASE}/jobs/${job.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" } });
      await refreshJobs();
      renderAll();
      pushToast("Persistence complete", `${job.fileName} has been approved and sent to the persistence API.`);
      navigate("history");
    } catch (error) {
      pushToast("Approve failed", error.message || "Unable to persist the review job.");
    } finally {
      setReviewButtons(false);
    }
  }

  async function handleReprocess() {
    const job = getSelectedJob();
    if (!job) {
      return;
    }

    try {
      setReviewButtons(true);
      await apiFetch(`${API_BASE}/jobs/${job.id}/reprocess`, { method: "POST", headers: { "Content-Type": "application/json" } });
      state.selectedNodeId = null;
      await refreshJobs();
      renderAll();
      navigate("dashboard");
      pushToast("Reprocess started", `${job.fileName} has been queued for another extraction attempt.`);
    } catch (error) {
      pushToast("Reprocess failed", error.message || "Unable to reprocess the job.");
    } finally {
      setReviewButtons(false);
    }
  }

  async function verifyUnitGlh(jobId) {
    try {
      await apiFetch(`${API_BASE}/jobs/${jobId}/nodes/unit-3/verify`, { method: "POST", headers: { "Content-Type": "application/json" } });
      await refreshJobs();
      renderAll();
      pushToast("Field verified", "Unit 3 GLH has been confirmed and the job is ready to persist.");
    } catch (error) {
      pushToast("Verification failed", error.message || "Unable to verify the field.");
    }
  }

  async function updateUnitGlh(jobId, value) {
    try {
      await apiFetch(`${API_BASE}/jobs/${jobId}/nodes/unit-3`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "glh", value })
      });
      await refreshJobs();
      renderReview();
    } catch (error) {
      pushToast("Update failed", error.message || "Unable to update the GLH field.");
    }
  }

  async function resetDemo() {
    try {
      await apiFetch(`${API_BASE}/reset`, { method: "POST", headers: { "Content-Type": "application/json" } });
      state.selectedNodeId = null;
      await refreshJobs();
      state.selectedJobId = state.jobs[0] ? state.jobs[0].id : null;
      renderAll();
      navigate("dashboard");
      setBusyState(false);
      pushToast("Demo reset", "The MVP state has been reset to the seeded PRD/spec demo data.");
    } catch (error) {
      pushToast("Reset failed", error.message || "Unable to reset the demo state.");
    }
  }

  function getSelectedJob() {
    return state.jobs.find((job) => job.id === state.selectedJobId) || null;
  }

  function getNextReviewJob() {
    return state.jobs.find((job) => job.status === "review") || null;
  }

  function createJobCard(job) {
    const card = elements.jobCardTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector(".job-name").textContent = job.fileName;
    const uploadMeta = job.artifact ? ` | ${Math.round(job.artifact.sizeBytes / 1024)} KB uploaded` : "";
    card.querySelector(".job-meta").textContent = `${getStatusLabel(job.status)} | Confidence ${job.confidence || 0}% | Attempt ${job.attempts}${uploadMeta} | Source ${describeExtractionSource(job)} | Updated ${formatDate(job.updatedAt)}`;

    const statusEl = card.querySelector(".job-status");
    statusEl.className = `badge job-status ${getStatusVariant(job.status)}`;
    statusEl.textContent = getStatusLabel(job.status);

    const action = card.querySelector(".job-action");
    action.textContent = job.status === "persisted" ? "View" : job.status === "processing" ? "Track" : "Review";
    action.addEventListener("click", () => openJob(job.id));
    return card;
  }

  function createBadgeMarkup(label, variantClass) {
    return `<span class="badge ${variantClass}">${escapeHtml(label)}</span>`;
  }

  function getStatusLabel(status) {
    return {
      review: "Review pending",
      persisted: "Persisted",
      processing: "Processing"
    }[status] || startCase(status);
  }

  function getStatusVariant(status) {
    return {
      review: "badge",
      persisted: "badge-success",
      processing: "badge-neutral"
    }[status] || "badge-neutral";
  }

  function describeExtractionSource(job) {
    if (!job || !job.extractionMeta) {
      return "pending";
    }

    const provider = job.extractionMeta.provider || job.extractionMeta.requestedProvider || "unknown";
    if (provider === "fallback") {
      return job.extractionMeta.parser ? `fallback:${job.extractionMeta.parser}` : "fallback";
    }
    if (job.extractionMeta.model) {
      return `${provider}:${job.extractionMeta.model}`;
    }
    return provider;
  }

  function confidenceLabel(node) {
    if (node.confidence >= 90) {
      return `High ${node.confidence}%`;
    }
    if (node.confidence >= 75) {
      return `Medium ${node.confidence}%`;
    }
    return `Low ${node.confidence}%`;
  }

  function confidenceVariant(confidence) {
    if (confidence >= 90) {
      return "badge-success";
    }
    if (confidence >= 75) {
      return "badge-neutral";
    }
    return "badge-danger";
  }

  function getUnitGlh(job) {
    const unit = job.qualification ? findNodeById(job.qualification, "unit-3") : null;
    return unit && unit.fields ? unit.fields.glh : "120?";
  }

  function findNodeById(node, nodeId) {
    if (!node) {
      return null;
    }
    if (node.id === nodeId) {
      return node;
    }
    for (const child of node.children || []) {
      const found = findNodeById(child, nodeId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function findFirstAttentionNode(node) {
    if (!node) {
      return null;
    }
    if (node.needsAttention) {
      return node;
    }
    for (const child of node.children || []) {
      const found = findFirstAttentionNode(child);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function average(numbers) {
    if (!numbers.length) {
      return 0;
    }
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  }

  function sortByUpdatedDesc(a, b) {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  }

  function formatDate(value) {
    const date = new Date(value);
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function pushToast(title, message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    elements.toastStack.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 3400);
  }

  function startCase(value) {
    return value
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (match) => match.toUpperCase())
      .trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  async function refreshJobs() {
    const response = await apiFetch(`${API_BASE}/jobs`);
    state.jobs = response.items || [];
    if (!state.selectedJobId || !state.jobs.some((job) => job.id === state.selectedJobId)) {
      const firstReview = state.jobs.find((job) => job.status === "review");
      state.selectedJobId = firstReview ? firstReview.id : (state.jobs[0] ? state.jobs[0].id : null);
    }
  }

  async function refreshAiStatus() {
    const response = await apiFetch(`${API_BASE}/ai-status`);
    state.aiStatus = response.item || null;
  }

  function startPolling() {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = window.setInterval(async () => {
      if (state.isBusy) {
        return;
      }
      if (!state.jobs.some((job) => job.status === "processing")) {
        return;
      }
      try {
        await refreshJobs();
        renderAll();
        if (!state.jobs.some((job) => job.status === "processing")) {
          setBusyState(false);
        }
      } catch (error) {
        pushToast("Refresh failed", error.message || "Unable to refresh processing job state.");
      }
    }, 1500);
  }

  async function apiFetch(url, options = {}) {
    const config = { ...options };
    const isMultipart = Boolean(config.isMultipart);
    delete config.isMultipart;

    if (!isMultipart && !config.headers) {
      config.headers = {};
    }

    const response = await fetch(url, config);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || payload.title || "Request failed");
    }
    return payload;
  }

  function setBusyState(isBusy, title) {
    state.isBusy = isBusy;
    elements.uploadProgress.classList.toggle("hidden", !isBusy);
    if (isBusy) {
      elements.progressTitle.textContent = title || "Processing";
      elements.progressPercent.textContent = "Queued";
      elements.progressFill.style.width = "65%";
      elements.progressStep.textContent = "The server is running extraction and will move the job into review automatically.";
      return;
    }
    elements.progressTitle.textContent = "Analyzing document";
    elements.progressPercent.textContent = "0%";
    elements.progressFill.style.width = "0";
    elements.progressStep.textContent = "Validating upload payload";
  }

  function setReviewButtons(disabled) {
    elements.approveButton.disabled = disabled;
    elements.reprocessButton.disabled = disabled;
  }
})();