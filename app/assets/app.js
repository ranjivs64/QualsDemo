(function () {
  const API_BASE = "/api/v1";

  const state = {
    jobs: [],
    aiStatus: null,
    currentRoute: "dashboard",
    selectedJobId: null,
    selectedQualificationId: null,
    selectedNodeId: null,
    collapsedNodeIds: {},
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
    pageBadge: document.getElementById("pageBadge"),
    reviewStatusBadge: document.getElementById("reviewStatusBadge"),
    documentCanvas: document.getElementById("documentCanvas"),
    validationRail: document.getElementById("validationRail"),
    qualificationTabs: document.getElementById("qualificationTabs"),
    hierarchyTree: document.getElementById("hierarchyTree"),
    inspectorContent: document.getElementById("inspectorContent"),
    approvalPanel: document.getElementById("approvalPanel"),
    approveButton: document.getElementById("approveButton"),
    reprocessButton: document.getElementById("reprocessButton"),
    toastStack: document.getElementById("toastStack"),
    seedResetButton: document.getElementById("seedResetButton")
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
      openJob(job.id);
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
        label: "Qualifications staged",
        value: state.jobs.reduce((sum, job) => sum + getCounts(job).qualifications, 0)
      },
      {
        label: "Shared units detected",
        value: state.jobs.reduce((sum, job) => sum + getCounts(job).sharedUnits, 0)
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
      card.innerHTML = `<span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong>`;
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
    elements.aiStatusText.textContent = `${source} is not ready. ${aiStatus.issues.join(" ")} AI extraction requires a configured provider and an uploaded PDF artifact.`;
  }

  function renderDashboardJobs() {
    const jobs = [...state.jobs].sort(sortByUpdatedDesc);
    elements.dashboardJobList.innerHTML = "";

    if (!jobs.length) {
      elements.dashboardJobList.innerHTML = "<div class=\"empty-state\"><h4>No jobs yet</h4><p>Upload a qualification PDF to create the first extraction workspace.</p></div>";
      return;
    }

    jobs.forEach((job) => {
      const counts = getCounts(job);
      const actionLabel = job.status === "persisted" ? "View" : job.status === "processing" ? "Track" : "Review";
      const card = document.createElement("article");
      card.className = "job-card";
      card.innerHTML = `
        <div class="job-card-main">
          <div class="job-icon" aria-hidden="true"></div>
          <div>
            <h4 class="job-name">${escapeHtml(job.fileName)}</h4>
            <p class="job-meta">${escapeHtml(getStatusLabel(job.status))} | ${counts.qualifications} qualification${counts.qualifications === 1 ? "" : "s"} discovered | ${counts.sharedUnits} shared unit${counts.sharedUnits === 1 ? "" : "s"}</p>
            <p class="job-meta">Confidence ${job.confidence || 0}% | Attempt ${job.attempts} | Source ${escapeHtml(describeExtractionSource(job))} | Updated ${escapeHtml(formatDate(job.updatedAt))}</p>
          </div>
        </div>
        <div class="job-card-side">
          ${createBadgeMarkup(getReviewStateLabel(job), getReviewStateVariant(job))}
          <button class="secondary-button job-action" type="button">${escapeHtml(actionLabel)}</button>
        </div>
      `;
      card.querySelector(".job-action").addEventListener("click", () => openJob(job.id));
      elements.dashboardJobList.appendChild(card);
    });
  }

  function renderHistory() {
    const filter = elements.historyStatusFilter.value;
    const jobs = [...state.jobs]
      .filter((job) => (filter === "all" ? true : job.status === filter))
      .sort(sortByUpdatedDesc);

    elements.historyTableBody.innerHTML = "";
    jobs.forEach((job) => {
      const counts = getCounts(job);
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>
          <strong>${escapeHtml(job.fileName)}</strong>
          <span>${escapeHtml(job.qualificationCode || "Not assigned")}</span>
        </td>
        <td>${createBadgeMarkup(getReviewStateLabel(job), getReviewStateVariant(job))}</td>
        <td>${counts.qualifications}</td>
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
      elements.reviewSubtitle.textContent = "Select a job from the queue to inspect the discovered qualification structures.";
      elements.pageBadge.textContent = "Awaiting review";
      elements.reviewStatusBadge.className = "badge badge-neutral";
      elements.reviewStatusBadge.textContent = "No job selected";
      elements.documentCanvas.innerHTML = "<div class=\"empty-state\"><h4>No document selected</h4><p>Choose a job from Extract or History to open the review workspace.</p></div>";
      elements.validationRail.innerHTML = "<div class=\"empty-state\"><h4>No specification summary</h4><p>A structure summary appears here once a review job is opened.</p></div>";
      elements.qualificationTabs.innerHTML = "";
      elements.hierarchyTree.innerHTML = "<div class=\"empty-state\"><h4>No hierarchy available</h4><p>The structure tree will populate after extraction finishes.</p></div>";
      elements.inspectorContent.className = "inspector-content empty-state";
      elements.inspectorContent.innerHTML = "<h4>No node selected</h4><p>Select a qualification, unit, outcome, or criterion to inspect extracted details.</p>";
      elements.approvalPanel.innerHTML = "";
      elements.approveButton.disabled = true;
      elements.reprocessButton.disabled = true;
      return;
    }

    const qualifications = getQualifications(job);
    if (!state.selectedQualificationId || !qualifications.some((qualification) => qualification.id === state.selectedQualificationId)) {
      state.selectedQualificationId = qualifications[0] ? qualifications[0].id : null;
    }

    const selectedQualification = getSelectedQualification(job);
    const selectedNode = getSelectedNode(job, selectedQualification);
    const counts = getCounts(job);

    elements.reviewSubtitle.textContent = `${job.fileName} | Discovered ${counts.qualifications} qualification${counts.qualifications === 1 ? "" : "s"} in this specification | ${counts.sharedUnits} shared unit${counts.sharedUnits === 1 ? "" : "s"} | Source ${describeExtractionSource(job)}`;
    elements.pageBadge.textContent = job.pages ? `Page ${job.pages.current} of ${job.pages.total}` : "Page pending";
    setReviewBadge(job);
    renderDocumentPanel(job, selectedNode);
    renderValidationRail(job);
    renderQualificationTabs(job);
    renderTree(job, selectedQualification);
    renderInspector(job, selectedQualification, selectedNode);
    renderApprovalPanel(job);

    elements.approveButton.disabled = job.status !== "review" || !job.reviewReady || state.isBusy;
    elements.reprocessButton.disabled = job.status === "processing" || state.isBusy;
  }

  function renderDocumentPanel(job, selectedNode) {
    const focus = selectedNode && selectedNode.focus ? selectedNode.focus : job.documentFocus || { top: 30, height: 14, label: "Focus pending" };
    const sharedInfo = selectedNode ? getSharedUnitInfo(job, selectedNode.id) : null;

    elements.documentCanvas.innerHTML = `
      <div class="source-sheet">
        <div class="source-sheet-header">
          <div>
            <p class="document-section-label">Current focus</p>
            <h4>${escapeHtml(selectedNode ? selectedNode.title : job.fileName)}</h4>
          </div>
          ${sharedInfo ? `<span class="badge badge-neutral">Shared across ${sharedInfo.count} qualifications</span>` : ""}
        </div>
        <div class="source-frame">
          <div class="source-focus ${selectedNode && selectedNode.confidence >= 90 ? "is-verified" : ""}" style="top:${Number(focus.top || 31)}%;height:${Number(focus.height || 13)}%;">
            <span>${escapeHtml(focus.label || "Focus: selected node")}</span>
          </div>
          <div class="source-columns">
            <div>
              <p class="document-section-label">Qualification code</p>
              <p class="document-emphasis">${escapeHtml(job.qualificationCode || "Pending")}</p>
            </div>
            <div>
              <p class="document-section-label">Review state</p>
              <p class="document-emphasis">${escapeHtml(getReviewStateLabel(job))}</p>
            </div>
          </div>
          <p class="source-excerpt-title">Source excerpt</p>
          <p class="source-excerpt-copy">${escapeHtml(job.sourceTextExcerpt || "No source excerpt is available for this upload yet. Open the uploaded PDF to inspect the original document directly.")}</p>
        </div>
      </div>
    `;
  }

  function renderValidationRail(job) {
    const summary = job.validationSummary || { counts: getCounts(job) };
    elements.validationRail.innerHTML = `
      <div class="validation-summary-head">
        <div>
          <p class="panel-kicker">Specification summary</p>
          <h4>${summary.counts.qualifications} qualification${summary.counts.qualifications === 1 ? "" : "s"} discovered</h4>
        </div>
        <div class="tree-badges">
          ${createBadgeMarkup(`${summary.counts.sharedUnits} shared unit${summary.counts.sharedUnits === 1 ? "" : "s"}`, "badge-neutral")}
          ${createBadgeMarkup(`${summary.counts.units} unit${summary.counts.units === 1 ? "" : "s"}`, "badge-neutral")}
        </div>
      </div>
      <div class="summary-grid">
        <div class="summary-card">
          <span>Units</span>
          <strong>${summary.counts.units}</strong>
        </div>
        <div class="summary-card">
          <span>Learning outcomes</span>
          <strong>${summary.counts.learningOutcomes}</strong>
        </div>
        <div class="summary-card">
          <span>Assessment criteria</span>
          <strong>${summary.counts.assessmentCriteria}</strong>
        </div>
        <div class="summary-card">
          <span>Ready to persist</span>
          <strong>${job.status === "review" ? "Yes" : "After extraction"}</strong>
        </div>
      </div>
    `;
  }

  function renderQualificationTabs(job) {
    const qualifications = getQualifications(job);
    if (!qualifications.length) {
      elements.qualificationTabs.innerHTML = "";
      return;
    }

    elements.qualificationTabs.innerHTML = qualifications.map((qualification) => {
      const code = qualification.fields && (qualification.fields.code || qualification.fields.qualificationCode)
        ? (qualification.fields.code || qualification.fields.qualificationCode)
        : "Code pending";
      const groupCount = (qualification.children || []).length;
      return `
        <button class="qualification-tab ${qualification.id === state.selectedQualificationId ? "is-active" : ""}" type="button" role="tab" aria-selected="${qualification.id === state.selectedQualificationId ? "true" : "false"}" data-qualification-id="${escapeAttribute(qualification.id)}">
          <span class="qualification-tab-title">${escapeHtml(qualification.title)}</span>
          <span class="qualification-tab-meta">${escapeHtml(code)} | ${groupCount} group${groupCount === 1 ? "" : "s"}</span>
        </button>
      `;
    }).join("");

    elements.qualificationTabs.querySelectorAll(".qualification-tab").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedQualificationId = button.dataset.qualificationId;
        state.selectedNodeId = null;
        renderReview();
      });
    });
  }

  function renderTree(job, qualification) {
    elements.hierarchyTree.innerHTML = "";
    if (!qualification) {
      elements.hierarchyTree.innerHTML = "<div class=\"empty-state\"><h4>Extraction is still running</h4><p>The hierarchy appears here once mapping completes.</p></div>";
      return;
    }

    const sharedUnitIndex = buildSharedUnitIndex(job);
    elements.hierarchyTree.appendChild(createTreeNode(qualification, sharedUnitIndex));
  }

  function createTreeNode(node, sharedUnitIndex) {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-node";
    wrapper.dataset.nodeId = node.id;

    const row = document.createElement("div");
    row.className = "tree-row";

    const hasChildren = Boolean(node.children && node.children.length);
    const isCollapsed = Boolean(state.collapsedNodeIds[node.id]);

    if (hasChildren) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "tree-toggle";
      toggle.setAttribute("aria-expanded", String(!isCollapsed));
      toggle.setAttribute("aria-label", `${isCollapsed ? "Expand" : "Collapse"} ${node.title}`);
      toggle.innerHTML = `<span class="tree-toggle-icon">${isCollapsed ? "+" : "-"}</span>`;
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        state.collapsedNodeIds[node.id] = !state.collapsedNodeIds[node.id];
        renderReview();
      });
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement("div");
      spacer.className = "tree-toggle-spacer";
      row.appendChild(spacer);
    }

    const card = document.createElement("button");
    card.type = "button";
    card.className = `tree-card ${state.selectedNodeId === node.id ? "is-selected" : ""}`;
    card.innerHTML = `
      <div class="tree-card-head">
        <span class="tree-kind">${escapeHtml(node.kind)}</span>
        <div class="tree-badges">
          ${createBadgeMarkup(confidenceLabel(node), confidenceVariant(node.confidence || 0))}
          ${sharedUnitIndex.has(node.id) ? createBadgeMarkup(`Shared ${sharedUnitIndex.get(node.id).count}x`, "badge-neutral") : ""}
        </div>
      </div>
      <h4 class="tree-title">${escapeHtml(node.title)}</h4>
      <p class="tree-summary">${escapeHtml(node.summary || "No summary available")}</p>
    `;
    card.addEventListener("click", () => {
      state.selectedNodeId = node.id;
      renderReview();
    });
    row.appendChild(card);
    wrapper.appendChild(row);

    if (hasChildren) {
      const children = document.createElement("div");
      children.className = `tree-children ${isCollapsed ? "is-collapsed" : ""}`;
      children.dataset.parentNodeId = node.id;
      node.children.forEach((child) => {
        children.appendChild(createTreeNode(child, sharedUnitIndex));
      });
      wrapper.appendChild(children);
    }

    return wrapper;
  }

  function renderInspector(job, qualification, node) {
    if (!node) {
      elements.inspectorContent.className = "inspector-content empty-state";
      elements.inspectorContent.innerHTML = "<h4>No node selected</h4><p>Select a hierarchy item to inspect extracted fields and available actions.</p>";
      return;
    }

    const sharedInfo = getSharedUnitInfo(job, node.id);
    const childPreview = (node.children || []).map((child) => `<li>${escapeHtml(child.kind)}: ${escapeHtml(child.title)}</li>`).join("");
    const fields = Object.entries(node.fields || {});

    elements.inspectorContent.className = "inspector-content";
    elements.inspectorContent.innerHTML = `
      <div class="inspector-block detail-header-block">
        <div class="detail-header">
          <div>
            <p class="panel-kicker">${escapeHtml(node.kind)}</p>
            <h4>${escapeHtml(node.title)}</h4>
            <p class="muted">${escapeHtml(node.summary || "No summary available")}</p>
          </div>
          <div class="detail-header-badges">
            ${createBadgeMarkup(confidenceLabel(node), confidenceVariant(node.confidence || 0))}
          </div>
        </div>
        <div class="detail-meta-grid">
          <div><span>Qualification</span><strong>${escapeHtml(qualification ? qualification.title : "Unknown")}</strong></div>
          <div><span>Children</span><strong>${node.children ? node.children.length : 0}</strong></div>
          <div><span>Shared usage</span><strong>${sharedInfo ? `${sharedInfo.count} qualifications` : "Single qualification"}</strong></div>
        </div>
      </div>
      <div class="inspector-block">
        ${fields.length ? `
          <div class="inspector-grid">
            ${fields.map(([field, value]) => `
              <label class="inspector-field">
                <span>${escapeHtml(startCase(field))}</span>
                <input data-field="${escapeAttribute(field)}" value="${escapeAttribute(value)}">
              </label>
            `).join("")}
          </div>
        ` : "<p class=\"muted\">This node does not expose editable fields.</p>"}
      </div>
      ${sharedInfo ? `
        <div class="inspector-block">
          <p class="panel-kicker">Shared unit context</p>
          <h4>Linked qualifications</h4>
          <ul class="linked-list">
            ${sharedInfo.qualificationTitles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
      ${(node.children || []).length ? `
        <div class="inspector-block">
          <p class="panel-kicker">Nested entities</p>
          <ul class="linked-list">${childPreview}</ul>
        </div>
      ` : ""}
      <div class="inspector-block">
        <p class="inspector-note">${escapeHtml(node.guidance || "Review the extracted fields and source context before persisting.")}</p>
        <div class="inspector-actions">
          <button class="secondary-button" id="focusNodeButton" type="button">Highlight source</button>
          ${job.artifact ? "<button class=\"secondary-button\" id=\"openArtifactButton\" type=\"button\">Open uploaded PDF</button>" : ""}
        </div>
      </div>
    `;

    elements.inspectorContent.querySelectorAll("input[data-field]").forEach((input) => {
      input.addEventListener("change", async (event) => {
        const nextValue = event.target.value;
        try {
          await updateNodeField(job.id, node.id, event.target.dataset.field, nextValue);
          pushToast("Field updated", `${startCase(event.target.dataset.field)} was saved for ${node.title}.`);
        } catch (error) {
          pushToast("Update failed", error.message || "Unable to save the field update.");
        }
      });
    });

    document.getElementById("focusNodeButton").addEventListener("click", () => {
      renderDocumentPanel(job, node);
      pushToast("Source linked", `${node.title} is now focused in the document panel.`);
    });

    const artifactButton = document.getElementById("openArtifactButton");
    if (artifactButton) {
      artifactButton.addEventListener("click", () => {
        window.open(`${API_BASE}/jobs/${job.id}/artifact`, "_blank", "noopener,noreferrer");
      });
    }
  }

  function renderApprovalPanel(job) {
    const summary = job.validationSummary || { counts: getCounts(job) };
    const approvalHeadline = job.reviewReady ? "Ready to persist" : "Waiting for extraction";
    const approvalCopy = job.reviewReady
      ? "Review the discovered qualification structures, expand the groups you need, and persist when ready."
      : "Persistence becomes available after extraction finishes and at least one qualification structure is available.";

    elements.approvalPanel.innerHTML = `
      <div class="approval-card">
        <div class="approval-header">
          <div>
            <p class="panel-kicker">Approval gate</p>
            <h4>${escapeHtml(approvalHeadline)}</h4>
          </div>
          ${createBadgeMarkup(getReviewStateLabel(job), getReviewStateVariant(job))}
        </div>
        <p class="muted">${escapeHtml(approvalCopy)}</p>
        <div class="approval-metrics">
          <div><span>Qualifications</span><strong>${summary.counts.qualifications}</strong></div>
          <div><span>Shared units</span><strong>${summary.counts.sharedUnits}</strong></div>
          <div><span>Units</span><strong>${summary.counts.units}</strong></div>
          <div><span>Criteria</span><strong>${summary.counts.assessmentCriteria}</strong></div>
        </div>
        <div class="inspector-actions">
          <span class="badge badge-neutral">${summary.counts.learningOutcomes} learning outcome${summary.counts.learningOutcomes === 1 ? "" : "s"}</span>
          <span class="badge badge-neutral">${summary.counts.assessmentCriteria} assessment criteria</span>
        </div>
      </div>
    `;
  }

  function setReviewBadge(job) {
    elements.reviewStatusBadge.className = `badge ${getReviewStateVariant(job)}`;
    elements.reviewStatusBadge.textContent = getReviewStateLabel(job);
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
      state.selectedQualificationId = null;
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
    state.selectedQualificationId = null;
    state.selectedNodeId = null;
    navigate("review");
  }

  async function handleApprove() {
    const job = getSelectedJob();
    if (!job) {
      return;
    }
    if (!job.reviewReady) {
      pushToast("Review unavailable", "Wait for extraction to finish before persisting the discovered structures.");
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
      state.selectedQualificationId = null;
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

  async function verifyNode(jobId, nodeId) {
    try {
      await apiFetch(`${API_BASE}/jobs/${jobId}/nodes/${nodeId}/verify`, { method: "POST", headers: { "Content-Type": "application/json" } });
      await refreshJobs();
      renderReview();
      pushToast("Node verified", "The selected node has been marked as manually verified.");
    } catch (error) {
      pushToast("Verification failed", error.message || "Unable to verify the selected node.");
    }
  }

  async function updateNodeField(jobId, nodeId, field, value) {
    await apiFetch(`${API_BASE}/jobs/${jobId}/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value })
    });
    await refreshJobs();
    renderReview();
  }

  async function saveApprovalOverride(jobId, enabled, rationale) {
    await apiFetch(`${API_BASE}/jobs/${jobId}/approval-override`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, rationale })
    });
    await refreshJobs();
    renderReview();
    pushToast("Override saved", enabled ? "Approval override policy has been updated." : "Approval override has been cleared.");
  }

  async function resetDemo() {
    try {
      await apiFetch(`${API_BASE}/reset`, { method: "POST", headers: { "Content-Type": "application/json" } });
      state.selectedJobId = null;
      state.selectedQualificationId = null;
      state.selectedNodeId = null;
      await refreshJobs();
      renderAll();
      navigate("dashboard");
      setBusyState(false);
      pushToast("Workspace cleared", "The application state has been reset to an empty workspace.");
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

  function getQualifications(job) {
    if (!job) {
      return [];
    }
    if (Array.isArray(job.qualifications) && job.qualifications.length) {
      return job.qualifications;
    }
    return job.qualification ? [job.qualification] : [];
  }

  function getSelectedQualification(job) {
    const qualifications = getQualifications(job);
    return qualifications.find((qualification) => qualification.id === state.selectedQualificationId) || qualifications[0] || null;
  }

  function getSelectedNode(job, qualification) {
    if (!qualification) {
      state.selectedNodeId = null;
      return null;
    }

    let selected = state.selectedNodeId ? findNodeById(qualification, state.selectedNodeId) : null;
    if (!selected && state.selectedNodeId) {
      for (const candidate of getQualifications(job)) {
        selected = findNodeById(candidate, state.selectedNodeId);
        if (selected) {
          break;
        }
      }
    }

    if (!selected) {
      selected = qualification;
      state.selectedNodeId = selected ? selected.id : null;
    }

    return selected;
  }

  function findFirstIssueNode(job, qualificationId) {
    const summary = job.validationSummary || { blockers: [], warnings: [] };
    return [...summary.blockers, ...summary.warnings].find((item) => item.qualificationId === qualificationId) || null;
  }

  function buildIssueCountIndex(items) {
    const map = new Map();
    items.forEach((item) => {
      map.set(item.qualificationId, (map.get(item.qualificationId) || 0) + 1);
    });
    return map;
  }

  function buildNodeIssueIndex(job) {
    const map = new Map();
    const summary = job.validationSummary || { blockers: [], warnings: [] };
    summary.warnings.forEach((item) => {
      map.set(item.nodeId, { label: "Warning", variant: "badge-neutral" });
    });
    summary.blockers.forEach((item) => {
      map.set(item.nodeId, { label: "Blocker", variant: "badge-danger" });
    });
    return map;
  }

  function buildSharedUnitIndex(job) {
    const map = new Map();
    const summary = job.validationSummary || { sharedUnits: [] };
    summary.sharedUnits.forEach((entry) => {
      entry.nodeIds.forEach((nodeId) => {
        map.set(nodeId, entry);
      });
    });
    return map;
  }

  function getSharedUnitInfo(job, nodeId) {
    return buildSharedUnitIndex(job).get(nodeId) || null;
  }

  function getCounts(job) {
    return job && job.validationSummary && job.validationSummary.counts
      ? job.validationSummary.counts
      : { qualifications: 0, sharedUnits: 0, blockers: 0, warnings: 0, learningOutcomes: 0, assessmentCriteria: 0 };
  }

  function getReviewStateLabel(job) {
    if (job.status === "persisted") {
      return "Persisted";
    }
    if (job.status === "processing") {
      return "Processing";
    }
    if (job.reviewReady) {
      return "Ready to persist";
    }
    return "Review pending";
  }

  function getReviewStateVariant(job) {
    const label = getReviewStateLabel(job);
    if (label === "Persisted" || label === "Ready to persist") {
      return "badge-success";
    }
    return "badge-neutral";
  }

  function getStatusLabel(status) {
    return {
      review: "Review pending",
      persisted: "Persisted",
      processing: "Processing"
    }[status] || startCase(status);
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
    if ((node.confidence || 0) >= 90) {
      return `High ${node.confidence}%`;
    }
    if ((node.confidence || 0) >= 75) {
      return `Medium ${node.confidence}%`;
    }
    return `Low ${node.confidence || 0}%`;
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
    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function createBadgeMarkup(label, variantClass) {
    return `<span class="badge ${variantClass}">${escapeHtml(label)}</span>`;
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
    return String(value)
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
      if (state.isBusy || !state.jobs.some((job) => job.status === "processing")) {
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
      elements.progressStep.textContent = "The server is resolving qualifications, shared units, and nested structure for review.";
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