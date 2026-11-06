(() => {
  "use strict";

  const main = document.getElementById("detailMain");
  const srNo = main.dataset.sr;
  const editButton = document.getElementById("editButton");
  const saveButton = document.getElementById("saveButton");
  const cancelButton = document.getElementById("cancelButton");
  const saveNote = document.getElementById("saveNote") || document.getElementById("multipleSaveNote");
  const commentList = document.getElementById("commentList");
  const commentInput = document.getElementById("commentInput");
  const addCommentButton = document.getElementById("addCommentButton");
  const multipleRows = document.getElementById("multipleRows");
  const addMultipleRowButton = document.getElementById("addMultipleRowButton");
  const saveMultipleButton = document.getElementById("saveMultipleButton");
  const multipleSaveNote = document.getElementById("multipleSaveNote");
  const attachmentInput = document.getElementById("attachmentInput");
  const attachmentList = document.getElementById("attachmentList");
  const attachmentNote = document.getElementById("attachmentNote");
  const lifecycleModal = document.getElementById("lifecycleModal");
  const updateLifecycleButton = document.getElementById("updateLifecycleButton");
  const lifecycleStageSelect = document.getElementById("lifecycleStageSelect");
  const lifecycleMatrixRows = document.getElementById("lifecycleMatrixRows");
  const lifecycleNote = document.getElementById("lifecycleNote");
  const saveLifecycleButton = document.getElementById("saveLifecycleButton");
  const LIFECYCLE_FIELDS = ["planned_start", "planned_end", "actual_start", "actual_end"];
  const LIFECYCLE_LABELS = {
    planned_start: "planned start",
    planned_end: "planned end",
    actual_start: "actual start",
    actual_end: "actual end",
  };

  const inputs = [...main.querySelectorAll('[data-role="input"]')];
  const NUMERIC = new Set(["BP-26 INR", "Approved Budget", "Ordered", "Quotation Value", "PO Value (MINR)", "Actual Fulfillment Value"]);
  const DATE = new Set(["Quotation Date", "Material Delivery plan date", "Material Delivery Actual date", "Execution Start", "Execution End", "Commitment to EM"]);
   const STAGES = ["Initiation", "Planning", "Execution", "Monitoring", "Closure"];
   const STAGE_DESCRIPTIONS = JSON.parse(document.getElementById("stageDescriptions").textContent || "{}");
  const multipleColumns = JSON.parse(document.getElementById("multipleColumns")?.textContent || "[]");
  const multipleOptions = window.CAPEX_DETAIL_OPTIONS || {};
  const slug = (value) => String(value || "").toLowerCase().replace(/\s+/g, "-");

  let snapshot = captureValues();
  let multipleEntries = JSON.parse(document.getElementById("multipleData")?.textContent || "[]");
  let attachments = JSON.parse(document.getElementById("attachmentData")?.textContent || "[]");

  function captureValues() {
    return Object.fromEntries(inputs.map((input) => [input.name, input.value]));
  }

  function setEditing(on) {
    main.classList.toggle("is-editing", on);
    if (on) inputs[0]?.focus();
  }

  function note(message, kind) {
    saveNote.textContent = message;
    saveNote.className = `save-note ${kind || ""}`.trim();
  }

  async function request(url, options) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  }

  function paint(project) {
    main.querySelectorAll(".info-item").forEach((item) => {
      const name = item.dataset.field;
      const target = item.querySelector('[data-role="value"]');
      const value = project[name];
      if (NUMERIC.has(name) || name === "Balance" || name === "Saving") {
        target.textContent = `₹ ${Number(value || 0).toFixed(2)}`;
      } else {
        target.textContent = value === "" || value === null ? "–" : value;
      }
    });
    main.querySelector('[data-role="title"]').textContent = project["Project/Equipment/Investment"];
    main.querySelector('.metric.custodian [data-role="value"]').textContent = project["Custodian"];
    main.querySelectorAll("[data-money]").forEach((node) => {
      node.textContent = `₹ ${Number(project[node.dataset.money] || 0).toFixed(2)}`;
    });
    const badge = main.querySelector('[data-role="stage-badge"]');
    badge.textContent = project["Planning Status"];
    badge.className = `badge-status stage-${slug(project["Planning Status"])}`;
    document.title = `Capex | ${project["Project/Equipment/Investment"]}`;
  }

  function paintTimeline(timeline) {
    const steps = main.querySelectorAll(".lifecycle-step");
    timeline.forEach((step, index) => {
      const node = steps[index];
      if (!node) return;
      node.className = `lifecycle-step state-${step.state_class}`;
      node.dataset.stage = step.stage;
      node.dataset.completed = String(step.completed);
      node.dataset.plannedStart = step.planned_start || "";
      node.dataset.plannedEnd = step.planned_end || "";
      node.dataset.actualStart = step.actual_start || "";
      node.dataset.actualEnd = step.actual_end || "";
      node.querySelector(".step-mark").innerHTML =
        step.completed ? '<i class="bi bi-check-circle-fill"></i>' : '<i class="bi bi-circle"></i>';
      node.querySelector(".step-state").textContent = step.state;
      const dateNode = node.querySelector(".step-date");
      dateNode.replaceChildren();
      if (step.completed) {
        [["Planned start", step.planned_start], ["Planned end", step.planned_end],
          ["Actual start", step.actual_start], ["Actual end", step.actual_end]].forEach(([label, value]) => {
          const date = document.createElement("span");
          date.textContent = `${label}: ${value || "–"}`;
          dateNode.append(date);
        });
      }
    });
  }

  function localDateText(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function lifecycleNoteText(message, kind) {
    lifecycleNote.textContent = message;
    lifecycleNote.className = `save-note ${kind || ""}`.trim();
  }

  function savedPhaseDates(stage) {
    const step = main.querySelector(`.lifecycle-step[data-stage="${stage}"]`);
    return {
      planned_start: step?.dataset.plannedStart || "",
      planned_end: step?.dataset.plannedEnd || "",
      actual_start: step?.dataset.actualStart || "",
      actual_end: step?.dataset.actualEnd || "",
    };
  }

  function renderLifecycleMatrix() {
    const typed = Object.fromEntries([...lifecycleMatrixRows.querySelectorAll("input")].map((input) => [`${input.dataset.stage}|${input.dataset.field}`, input.value]));
    const selectedIndex = STAGES.indexOf(lifecycleStageSelect.value);
    const today = localDateText();
    lifecycleMatrixRows.replaceChildren();
    STAGES.slice(0, selectedIndex + 1).forEach((stage) => {
      const saved = savedPhaseDates(stage);
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = `HG${STAGES.indexOf(stage) + 1}.${stage}`;
      name.title = STAGE_DESCRIPTIONS[stage] || "";
      row.append(name);
      LIFECYCLE_FIELDS.forEach((field) => {
        const cell = document.createElement("td");
        const input = document.createElement("input");
        input.type = "date";
        input.dataset.stage = stage;
        input.dataset.field = field;
        input.value = typed[`${stage}|${field}`] ?? saved[field];
        input.setAttribute("aria-label", `${stage} ${LIFECYCLE_LABELS[field]} date`);
        if (field.startsWith("actual_")) input.max = today;
        cell.append(input);
        row.append(cell);
      });
      lifecycleMatrixRows.append(row);
    });
  }

  function lifecycleValues() {
    const phases = {};
    lifecycleMatrixRows.querySelectorAll("input").forEach((input) => {
      phases[input.dataset.stage] ||= {};
      phases[input.dataset.stage][input.dataset.field] = input.value;
    });
    return phases;
  }

  function validateLifecycle(stage, phases) {
    const selectedIndex = STAGES.indexOf(stage);
    const today = localDateText();
    const stages = STAGES.slice(0, selectedIndex + 1);
    stages.forEach((name, index) => {
      const values = phases[name];
      const required = index < selectedIndex ? LIFECYCLE_FIELDS : ["planned_start", "planned_end"];
      const missing = required.filter((field) => !values[field]);
      if (missing.length) throw new Error(`${name}: ${missing.map((field) => LIFECYCLE_LABELS[field]).join(", ")} required.`);
      if (values.planned_end < values.planned_start) throw new Error(`${name} planned end date cannot be before planned start date.`);
      if (values.actual_start && values.actual_end && values.actual_end < values.actual_start) {
        throw new Error(`${name} actual end date cannot be before actual start date.`);
      }
      if ([values.actual_start, values.actual_end].some((date) => date && date > today)) {
        throw new Error(`${name} actual dates cannot be in the future.`);
      }
    });
    stages.slice(1).forEach((name, index) => {
      const previousName = stages[index];
      const previous = phases[previousName];
      const current = phases[name];
      if (current.planned_start < previous.planned_end) {
        throw new Error(`${name} planned start cannot be before ${previousName}'s planned end.`);
      }
      if (current.actual_start && previous.actual_end && current.actual_start < previous.actual_end) {
        throw new Error(`${name} actual start cannot be before ${previousName}'s actual end.`);
      }
    });
  }

  function openLifecycleModal() {
    lifecycleStageSelect.value = main.querySelector('[data-role="stage-badge"]').textContent.trim();
    lifecycleMatrixRows.replaceChildren();
    renderLifecycleMatrix();
    lifecycleNoteText("");
    lifecycleModal.hidden = false;
    lifecycleStageSelect.focus();
  }

  function closeLifecycleModal() {
    lifecycleModal.hidden = true;
    updateLifecycleButton.focus();
  }

  updateLifecycleButton.addEventListener("click", openLifecycleModal);
  lifecycleStageSelect.addEventListener("change", () => {
    renderLifecycleMatrix();
    lifecycleNoteText("");
  });
  document.getElementById("closeLifecycleModal").addEventListener("click", closeLifecycleModal);
  document.getElementById("cancelLifecycleModal").addEventListener("click", closeLifecycleModal);
  lifecycleModal.addEventListener("click", (event) => {
    if (event.target === lifecycleModal) closeLifecycleModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !lifecycleModal.hidden) closeLifecycleModal();
  });

  saveLifecycleButton.addEventListener("click", async () => {
    const stage = lifecycleStageSelect.value;
    const phases = lifecycleValues();
    try {
      validateLifecycle(stage, phases);
    } catch (error) {
      lifecycleNoteText(error.message, "error");
      return;
    }
    saveLifecycleButton.disabled = true;
    lifecycleNoteText("Saving...");
    try {
      const result = await request(`/api/projects/${srNo}/lifecycle`, {
        method: "PUT",
        body: JSON.stringify({ stage, phases }),
      });
      paint(result.project);
      paintTimeline(result.timeline);
      lifecycleNoteText(`Saved to Excel at ${result.saved_at}.`, "ok");
      closeLifecycleModal();
    } catch (error) {
      lifecycleNoteText(error.message, "error");
    } finally {
      saveLifecycleButton.disabled = false;
    }
  });

  if (editButton && saveButton && cancelButton) {
    editButton.addEventListener("click", () => {
      snapshot = captureValues();
      note("");
      setEditing(true);
    });

    cancelButton.addEventListener("click", () => {
      inputs.forEach((input) => { input.value = snapshot[input.name]; });
      note("");
      setEditing(false);
    });

    saveButton.addEventListener("click", async () => {
      const fields = {};
      inputs.forEach((input) => {
        if (input.value !== snapshot[input.name]) fields[input.name] = input.value;
      });
      if (!Object.keys(fields).length) {
        setEditing(false);
        note("No changes to save.");
        return;
      }
      saveButton.disabled = true;
      note("Saving...");
      try {
        const result = await request(`/api/projects/${srNo}`, {
          method: "PUT",
          body: JSON.stringify({ fields }),
        });
        paint(result.project);
        paintTimeline(result.timeline);
        snapshot = captureValues();
        setEditing(false);
        note(`Saved to Excel at ${result.saved_at}.`, "ok");
      } catch (error) {
        note(error.message, "error");
      } finally {
        saveButton.disabled = false;
      }
    });
  }

  function multipleNote(message, kind) {
    multipleSaveNote.textContent = message;
    multipleSaveNote.className = `save-note ${kind || ""}`.trim();
  }

  function attachmentStatus(message, kind) {
    attachmentNote.textContent = message;
    attachmentNote.className = `save-note ${kind || ""}`.trim();
  }

  function blankMultipleEntry() {
    return Object.fromEntries(multipleColumns.map((column) => [column, NUMERIC.has(column) ? 0 : ""]));
  }

  function multipleInput(column, value) {
    const label = document.createElement("label");
    label.textContent = column;
    let input;
    if (multipleOptions[column]) {
      input = document.createElement("select");
      multipleOptions[column].forEach((option) => {
        const choice = document.createElement("option");
        choice.value = option;
        choice.textContent = option;
        choice.selected = option === value;
        input.append(choice);
      });
    } else {
      input = document.createElement("input");
      input.type = DATE.has(column) ? "date" : NUMERIC.has(column) ? "number" : "text";
      if (NUMERIC.has(column)) input.step = "0.01";
      input.value = NUMERIC.has(column) ? Number(value || 0).toFixed(2) : value || "";
    }
    input.name = column;
    label.append(input);
    return label;
  }

  function renderMultipleRows() {
    multipleRows.replaceChildren();
    if (!multipleEntries.length) {
      const empty = document.createElement("p");
      empty.className = "multiple-empty";
      empty.textContent = "No quotation or PO details added yet.";
      multipleRows.append(empty);
      return;
    }
    multipleEntries.forEach((entry, index) => {
      const card = document.createElement("article");
      card.className = "multiple-row";
      const header = document.createElement("div");
      header.className = "multiple-row-head";
      const title = document.createElement("h4");
      title.textContent = `Quotation / PO ${index + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-delete-comment";
      remove.title = "Remove row";
      remove.innerHTML = '<i class="bi bi-trash"></i>';
      remove.addEventListener("click", () => {
        multipleEntries = collectMultipleRows();
        multipleEntries.splice(index, 1);
        renderMultipleRows();
      });
      header.append(title, remove);
      const grid = document.createElement("div");
      grid.className = "multiple-grid";
      multipleColumns.forEach((column) => grid.append(multipleInput(column, entry[column])));
      card.append(header, grid);
      multipleRows.append(card);
    });
  }

  function collectMultipleRows() {
    return [...multipleRows.querySelectorAll(".multiple-row")].map((card) => {
      const row = {};
      card.querySelectorAll("input, select").forEach((input) => { row[input.name] = input.value; });
      return row;
    });
  }

  addMultipleRowButton.addEventListener("click", () => {
    multipleEntries = collectMultipleRows();
    multipleEntries.push(blankMultipleEntry());
    renderMultipleRows();
    multipleRows.querySelector(".multiple-row:last-child input, .multiple-row:last-child select")?.focus();
  });

  saveMultipleButton.addEventListener("click", async () => {
    saveMultipleButton.disabled = true;
    multipleNote("Saving...");
    try {
      const result = await request(`/api/projects/${srNo}/multiple`, {
        method: "PUT",
        body: JSON.stringify({ rows: collectMultipleRows() }),
      });
      multipleEntries = result.rows;
      renderMultipleRows();
      multipleNote(`Saved to Excel at ${result.saved_at}.`, "ok");
    } catch (error) {
      multipleNote(error.message, "error");
    } finally {
      saveMultipleButton.disabled = false;
    }
  });

  function renderAttachments() {
    attachmentList.replaceChildren();
    if (!attachments.length) {
      const empty = document.createElement("li");
      empty.className = "attachment-empty";
      empty.textContent = "No files attached yet.";
      attachmentList.append(empty);
      return;
    }
    attachments.forEach((attachment) => {
      const item = document.createElement("li");
      item.className = "attachment-item";
      const icon = document.createElement("i");
      icon.className = "bi bi-paperclip";
      const link = document.createElement("a");
      link.href = attachment.download_link;
      link.textContent = attachment.file_name;
      const meta = document.createElement("span");
      meta.textContent = [attachment.uploaded_by, attachment.uploaded_at].filter(Boolean).join(" - ");
      item.append(icon, link, meta);
      attachmentList.append(item);
    });
  }

  attachmentInput.addEventListener("change", async () => {
    const files = [...attachmentInput.files];
    if (!files.length) return;
    const body = new FormData();
    files.forEach((file) => body.append("files", file));
    attachmentInput.disabled = true;
    attachmentStatus("Uploading...");
    try {
      const response = await fetch(`/api/projects/${srNo}/attachments`, { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Upload failed.");
      attachments = payload.attachments;
      renderAttachments();
      attachmentInput.value = "";
      attachmentStatus(`Saved to Excel at ${payload.saved_at}.`, "ok");
    } catch (error) {
      attachmentStatus(error.message, "error");
    } finally {
      attachmentInput.disabled = false;
    }
  });

  function renderComments(comments) {
    commentList.replaceChildren();
    if (!comments.length) {
      const empty = document.createElement("li");
      empty.className = "comment-empty";
      empty.textContent = "No comments yet.";
      commentList.append(empty);
      return;
    }
    comments.forEach((comment) => {
      const item = document.createElement("li");
      item.className = "comment-item";

      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = comment.initials;

      const body = document.createElement("div");
      const head = document.createElement("div");
      head.className = "comment-head";
      const author = document.createElement("strong");
      author.textContent = comment.author;
      const time = document.createElement("time");
      time.textContent = comment.created_at;
      head.append(author, time);
      const text = document.createElement("p");
      text.className = "comment-text";
      text.textContent = comment.text;
      body.append(head, text);
      item.append(avatar, body);

      if (window.CAPEX_IS_ADMIN || comment.author === window.CAPEX_USER) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn-delete-comment";
        remove.title = "Delete comment";
        remove.innerHTML = '<i class="bi bi-trash"></i>';
        remove.addEventListener("click", async () => {
          try {
            const result = await request(`/api/projects/${srNo}/comments/${comment.id}`, { method: "DELETE" });
            renderComments(result.comments);
          } catch (error) {
            note(error.message, "error");
          }
        });
        item.append(remove);
      }
      commentList.append(item);
    });
  }

  addCommentButton.addEventListener("click", async () => {
    const text = commentInput.value.trim();
    if (!text) return;
    addCommentButton.disabled = true;
    try {
      const result = await request(`/api/projects/${srNo}/comments`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      commentInput.value = "";
      renderComments(result.comments);
    } catch (error) {
      note(error.message, "error");
    } finally {
      addCommentButton.disabled = false;
    }
  });

  renderMultipleRows();
  renderAttachments();
  renderComments(JSON.parse(document.getElementById("commentData").textContent || "[]"));
})();
