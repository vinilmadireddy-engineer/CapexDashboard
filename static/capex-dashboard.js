(() => {
  "use strict";

  const PAGE_SIZE = 5;
  const STAGES = ["Initiation", "Planning", "Execution", "Monitoring", "Closure"];
  const MONEY_KEYS = ["BP-26 INR", "Approved Budget", "Ordered", "Balance", "Saving"];

  //const projects = JSON.parse(document.getElementById("projectData").textContent || "[]");
  let projects = JSON.parse(document.getElementById("projectData").textContent || "[]");
  const detailBase = window.CAPEX_DETAIL_URL.replace(/0$/, "");
  const rowsBody = document.getElementById("projectRows");
  const rangeLabel = document.getElementById("rangeLabel");
  const pager = document.getElementById("pager");
  const searchInput = document.getElementById("searchInput");
  const custodianFilter = document.getElementById("custodianFilter");
  const statusFilter = document.getElementById("statusFilter");

  let page = 1;

  const money = (value) => `₹ ${Number(value || 0).toFixed(2)}`;
  const slug = (value) => String(value || "").toLowerCase().replace(/\s+/g, "-");

  function filtered() {
    const term = searchInput.value.trim().toLowerCase();
    const custodian = custodianFilter.value;
    const status = statusFilter.value;
    return projects.filter((project) => {
      if (custodian && project["Custodian"] !== custodian) return false;
      if (status && project["Planning Status"] !== status) return false;
      if (!term) return true;
      return [
        project["Project/Equipment/Investment"],
        project["Custodian"],
        project["PO No."],
        project["Vendor"],
      ].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }

  function renderStats(rows) {
    document.querySelector('[data-stat="total"]').textContent = rows.length;
    STAGES.forEach((stage) => {
      const node = document.querySelector(`[data-stat="${stage}"]`);
      if (node) node.textContent = rows.filter((row) => row["Planning Status"] === stage).length;
    });
    MONEY_KEYS.forEach((key) => {
      const total = rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
      document.querySelector(`[data-money="${key}"]`).textContent = money(total);
    });
  }

  function cell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function renderRows(rows) {
    rowsBody.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.className = "empty-row";
      const td = document.createElement("td");
      td.colSpan = 10;
      td.textContent = "No projects match the current filters.";
      tr.append(td);
      rowsBody.append(tr);
      return;
    }
    rows.forEach((project) => {
      const tr = document.createElement("tr");
      tr.append(
        cell(project["Sr.No."], "center"),
        cell(project["Project/Equipment/Investment"]),
        cell(project["Custodian"]),
        cell(Number(project["BP-26 INR"]).toFixed(2), "num"),
        cell(Number(project["Approved Budget"]).toFixed(2), "num"),
        cell(Number(project["Ordered"]).toFixed(2), "num"),
        cell(Number(project["Balance"]).toFixed(2), "num"),
        cell(Number(project["Saving"]).toFixed(2), "num saving"),
      );

      const statusCell = document.createElement("td");
      statusCell.className = "center";
      const badge = document.createElement("span");
      badge.className = `badge-status stage-${slug(project["Planning Status"])}`;
      badge.textContent = project["Planning Status"];
      statusCell.append(badge);

      const actionCell = document.createElement("td");
      actionCell.className = "center";
      const link = document.createElement("a");
      link.className = "btn-view";
      link.href = detailBase + project["Sr.No."];
      link.textContent = "View Details";
      actionCell.append(link);

      tr.append(statusCell, actionCell);
      rowsBody.append(tr);
    });
  }

  function pageButton(label, targetPage, options = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (options.active) button.classList.add("active");
    if (options.disabled) button.disabled = true;
    button.addEventListener("click", () => {
      page = targetPage;
      render();
    });
    return button;
  }

  function renderPager(totalPages) {
    pager.replaceChildren();
    if (totalPages <= 1) return;
    pager.append(pageButton("‹", Math.max(1, page - 1), { disabled: page === 1 }));
    const shown = new Set([1, totalPages, page, page - 1, page + 1]);
    let previous = 0;
    [...shown].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b).forEach((value) => {
      if (value - previous > 1) {
        const gap = document.createElement("span");
        gap.className = "gap";
        gap.textContent = "...";
        pager.append(gap);
      }
      pager.append(pageButton(String(value), value, { active: value === page }));
      previous = value;
    });
    pager.append(pageButton("›", Math.min(totalPages, page + 1), { disabled: page === totalPages }));
  }

  function render() {
    const rows = filtered();
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    page = Math.min(page, totalPages);
    const start = (page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    renderStats(rows);
    renderRows(pageRows);
    renderPager(totalPages);
    rangeLabel.textContent = rows.length
      ? `Showing ${start + 1} to ${start + pageRows.length} of ${rows.length} projects`
      : "No projects to show";
  }

  [searchInput, custodianFilter, statusFilter].forEach((control) => {
    control.addEventListener("input", () => {
      page = 1;
      render();
    });
  });

  const addProjectButton = document.getElementById("addProjectButton");
const addProjectModal = document.getElementById("addProjectModal");
const addProjectForm = document.getElementById("addProjectForm");
const addProjectNote = document.getElementById("addProjectNote");
const closeAddProject = document.getElementById("closeAddProject");
const cancelAddProject = document.getElementById("cancelAddProject");

function openAddProject() {
  addProjectForm.reset();
  addProjectNote.textContent = "";
  addProjectModal.hidden = false;
  addProjectForm.querySelector("input")?.focus();
}

function closeAddProjectModal() {
  addProjectModal.hidden = true;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

addProjectButton.addEventListener("click", openAddProject);
closeAddProject.addEventListener("click", closeAddProjectModal);
cancelAddProject.addEventListener("click", closeAddProjectModal);

addProjectForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const fields = Object.fromEntries(new FormData(addProjectForm).entries());
  addProjectNote.textContent = "Saving...";

  try {
    const result = await postJson("/api/projects", { fields });
    projects = [result.project, ...projects];
    page = 1;
    closeAddProjectModal();
    render();
  } catch (error) {
    addProjectNote.textContent = error.message;
    addProjectNote.className = "save-note error";
  }
});

  render();
})();
