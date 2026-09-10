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
  const lifecycleDatePanel = document.getElementById("lifecycleDatePanel");
  const previousStageLabel = document.getElementById("previousStageLabel");
  const previousClosedDate = document.getElementById("previousClosedDate");
  const currentStageLabel = document.getElementById("currentStageLabel");
  const currentStartDate = document.getElementById("currentStartDate");

  const inputs = [...main.querySelectorAll('[data-role="input"]')];
  const NUMERIC = new Set(["BP-26 INR", "Approved Budget", "Ordered", "Quotation Value", "PO Value (MINR)", "Actual Fulfillment Value"]);
  const DATE = new Set(["Quotation Date", "Material Delivery plan date", "Material Delivery Actual date", "Execution Start", "Execution End", "Commitment to EM"]);
  const STAGES = ["Initiation", "Planning", "Execution", "Monitoring", "Closure"];
  const multipleColumns = JSON.parse(document.getElementById("multipleColumns")?.textContent || "[]");
  const multipleOptions = window.CAPEX_DETAIL_OPTIONS || {};
  const statusInput = main.querySelector('[name="Planning Status"]');
  const slug = (value) => String(value || "").toLowerCase().replace(/\s+/g, "-");

  let snapshot = captureValues();
  let multipleEntries = JSON.parse(document.getElementById("multipleData")?.textContent || "[]");
  let attachments = JSON.parse(document.getElementById("attachmentData")?.textContent || "[]");

  function captureValues() {
    return Object.fromEntries(inputs.map((input) => [input.name, input.value]));
  }

  function setEditing(on) {
    main.classList.toggle("is-editing", on);
    updateLifecycleDatePanel();
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
      node.className = `lifecycle-step state-${slug(step.state)}`;
      node.querySelector(".step-mark").innerHTML =
        step.state === "Completed" ? '<i class="bi bi-check-circle-fill"></i>' : '<i class="bi bi-circle"></i>';
      node.querySelector(".step-state").textContent = step.state;
      node.querySelector(".step-date").textContent =
        step.state === "Completed" ? (step.date || step.planned)
          : step.state === "In Progress" ? `Start: ${step.date || step.planned}`
            : `Planned Start: ${step.planned || "–"}`;
    });
  }

  function updateLifecycleDatePanel() {
    if (!lifecycleDatePanel || !statusInput) return;
    const oldStage = snapshot["Planning Status"];
    const newStage = statusInput.value;
    const statusChanged = main.classList.contains("is-editing") && oldStage && newStage && oldStage !== newStage;
    lifecycleDatePanel.hidden = !statusChanged;
    if (!statusChanged) return;
    previousStageLabel.textContent = `${oldStage} Closed Date`;
    currentStageLabel.textContent = `${newStage} Start Date`;
    if (!previousClosedDate.value) previousClosedDate.valueAsDate = new Date();
    if (!currentStartDate.value) currentStartDate.valueAsDate = new Date();
  }

  function lifecycleDatePayload(fields) {
    if (!fields["Planning Status"]) return null;
    const previousStage = snapshot["Planning Status"];
    const currentStage = fields["Planning Status"];
    if (!STAGES.includes(previousStage) || !STAGES.includes(currentStage) || previousStage === currentStage) return null;
    return {
      previous_stage: previousStage,
      previous_closed_date: previousClosedDate.value,
      current_stage: currentStage,
      current_start_date: currentStartDate.value,
    };
  }

  if (editButton && saveButton && cancelButton) {
    editButton.addEventListener("click", () => {
      snapshot = captureValues();
      note("");
      previousClosedDate.value = "";
      currentStartDate.value = "";
      setEditing(true);
    });

    cancelButton.addEventListener("click", () => {
      inputs.forEach((input) => { input.value = snapshot[input.name]; });
      note("");
      previousClosedDate.value = "";
      currentStartDate.value = "";
      setEditing(false);
    });

    statusInput?.addEventListener("change", updateLifecycleDatePanel);

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
        const lifecycleDates = lifecycleDatePayload(fields);
        const result = await request(`/api/projects/${srNo}`, {
          method: "PUT",
          body: JSON.stringify({ fields, lifecycle_dates: lifecycleDates || {} }),
        });
        paint(result.project);
        paintTimeline(result.timeline);
        snapshot = captureValues();
        previousClosedDate.value = "";
        currentStartDate.value = "";
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
