"""Capex Budget Dashboard - Flask app backed by an Excel workbook."""
from __future__ import annotations

import os
import secrets
import threading
from datetime import datetime, timedelta
from functools import wraps
from io import BytesIO
from pathlib import Path

import pandas as pd
from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    send_from_directory,
    session,
    url_for,
)
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash
from werkzeug.utils import secure_filename

APP_DIR = Path(__file__).resolve().parent
EXCEL_FILE = APP_DIR / "capex_data.xlsx"
BACKUP_DIR = APP_DIR / "backup"
DATA_DIR = APP_DIR / "data"

SHEET_PROJECTS = "Projects"
SHEET_USERS = "Users"
SHEET_COMMENTS = "Comments"
SHEET_MULTIPLE = "Multiple"
SHEET_ATTACHMENTS = "Attachments"
SHEET_LIFECYCLE = "Lifecycle"

KEY = "Sr.No."
COLUMNS = [
    "Sr.No.",
    "Project/Equipment/Investment",
    "Custodian",
    "BP-26 INR",
    "Approved Budget",
    "Ordered",
    "Balance",
    "Saving",
    "Planning Status",
    "Quotation Date",
    "Quotation Value",
    "Sourcing Request No.",
    "RBGA Work-on No. for Budget",
    "MI No.",
    "PO No.",
    "PO Value (MINR)",
    "Vendor",
    "Vendor Code",
    "Material Delivery plan date",
    "Material Delivery Actual date",
    "Execution Start",
    "Execution End",
    "Actual Fulfillment Value",
    "Ordering",
    "Fullfillment",
    "Commitment to EM",
    "Status",
    "Remarks",
]
NUMERIC_COLUMNS = [
    "BP-26 INR",
    "Approved Budget",
    "Ordered",
    "Balance",
    "Saving",
    "Quotation Value",
    "PO Value (MINR)",
    "Actual Fulfillment Value",
]
DATE_COLUMNS = [
    "Quotation Date",
    "Material Delivery plan date",
    "Material Delivery Actual date",
    "Execution Start",
    "Execution End",
    "Commitment to EM",
]
# Balance and Saving are always derived, so the workbook can never drift out of sync.
DERIVED_COLUMNS = ["Balance", "Saving"]
READONLY_COLUMNS = [KEY] + DERIVED_COLUMNS

STAGES = ["Initiation", "Planning", "Execution", "Monitoring", "Closure"]
ORDERING_OPTIONS = ["Not Started", "In Progress", "Completed"]
FULFILLMENT_OPTIONS = ["Pending", "Partial", "Completed"]
STATUS_OPTIONS = ["On Track", "Delayed", "At Risk", "Completed", "On Hold"]
MULTIPLE_COLUMNS = [KEY] + COLUMNS[COLUMNS.index("Quotation Date"):]
ATTACHMENT_COLUMNS = [KEY, "File Name", "Stored Name", "File Path", "Download Link", "Uploaded By", "Uploaded At"]

app = Flask(__name__)
# A generated key is fine for local runs, but it invalidates every session on restart in production.
app.secret_key = os.environ.get("FLASK_SECRET_KEY", secrets.token_hex(32))
app.config.update(
    TEMPLATES_AUTO_RELOAD=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
    MAX_CONTENT_LENGTH=25 * 1024 * 1024,
)

# Excel is a single file with no transactions, so every read-modify-write is serialised.
workbook_lock = threading.RLock()


@app.errorhandler(Exception)
def handle_error(error):
    if isinstance(error, HTTPException):
        if request.path.startswith("/api/"):
            return jsonify(error=error.description), error.code
        return error
    app.logger.exception("Request failed")
    if request.path.startswith("/api/"):
        return jsonify(error="The server could not complete the request."), 500
    raise error


# --------------------------------------------------------------------------- #
# Workbook helpers
# --------------------------------------------------------------------------- #
def seed_workbook():
    """Create capex_data.xlsx with demo rows the first time the app starts."""
    from seed_capex_data import build_workbook

    build_workbook(EXCEL_FILE)


def ensure_workbook():
    if not EXCEL_FILE.exists():
        seed_workbook()


def read_sheet(name):
    ensure_workbook()
    frame = pd.read_excel(EXCEL_FILE, sheet_name=name, engine="openpyxl")
    frame.columns = [str(column).strip() for column in frame.columns]
    return frame


def read_all():
    with workbook_lock:
        ensure_workbook()
        book = pd.read_excel(EXCEL_FILE, sheet_name=None, engine="openpyxl")
    for frame in book.values():
        frame.columns = [str(column).strip() for column in frame.columns]
    return book


def write_all(book):
    """Atomically replace the workbook, keeping a timestamped backup."""
    with workbook_lock:
        temporary = EXCEL_FILE.with_name(EXCEL_FILE.stem + "_tmp.xlsx")
        with pd.ExcelWriter(temporary, engine="openpyxl") as writer:
            for name, frame in book.items():
                frame.to_excel(writer, sheet_name=name, index=False)
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        if EXCEL_FILE.exists():
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            EXCEL_FILE.replace(BACKUP_DIR / f"capex_data_{stamp}.xlsx")
        temporary.replace(EXCEL_FILE)


def load_projects():
    frame = read_sheet(SHEET_PROJECTS)
    for column in COLUMNS:
        if column not in frame.columns:
            frame[column] = ""
    frame = frame[COLUMNS].copy()
    frame[KEY] = pd.to_numeric(frame[KEY], errors="coerce").fillna(0).astype(int)
    for column in NUMERIC_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(0.0)
    for column in DATE_COLUMNS:
        frame[column] = pd.to_datetime(frame[column], errors="coerce")
    for column in frame.columns:
        if column not in NUMERIC_COLUMNS + DATE_COLUMNS + [KEY]:
            frame[column] = frame[column].fillna("").astype(str).str.strip()
    return frame


# def as_date_text(value):
#     return "" if pd.isna(value) else pd.Timestamp(value).strftime("%Y-%m-%d")

def as_date_text(value):
    parsed = pd.to_datetime(value, errors="coerce")
    return "" if pd.isna(parsed) else pd.Timestamp(parsed).strftime("%Y-%m-%d")


def project_json(row):
    record = {}
    for column in COLUMNS:
        value = row[column]
        if column == KEY:
            record[column] = int(value)
        elif column in NUMERIC_COLUMNS:
            numeric = pd.to_numeric(value, errors="coerce")
            record[column] = 0.0 if pd.isna(numeric) else round(float(numeric), 2)
        elif column in DATE_COLUMNS:
            record[column] = as_date_text(value)
        else:
            record[column] = "" if pd.isna(value) else str(value)
    return record


def multiple_json(row):
    record = {}
    for column in MULTIPLE_COLUMNS:
        value = row[column]
        if column == KEY:
            record[column] = int(value)
        elif column in NUMERIC_COLUMNS:
            numeric = pd.to_numeric(value, errors="coerce")
            record[column] = 0.0 if pd.isna(numeric) else round(float(numeric), 2)
        elif column in DATE_COLUMNS:
            record[column] = as_date_text(value)
        else:
            record[column] = "" if pd.isna(value) else str(value)
    return record


def normalize_multiple_frame(frame):
    for column in MULTIPLE_COLUMNS:
        if column not in frame.columns:
            frame[column] = pd.NaT if column in DATE_COLUMNS else 0.0 if column in NUMERIC_COLUMNS else ""
    frame = frame[MULTIPLE_COLUMNS].copy()
    frame[KEY] = pd.to_numeric(frame[KEY], errors="coerce").fillna(0).astype(int)
    for column in NUMERIC_COLUMNS:
        if column in frame.columns:
            frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(0.0)
    for column in DATE_COLUMNS:
        if column in frame.columns:
            frame[column] = pd.to_datetime(frame[column], errors="coerce")
    for column in frame.columns:
        if column not in NUMERIC_COLUMNS + DATE_COLUMNS + [KEY]:
            frame[column] = frame[column].fillna("").astype(str).str.strip()
    return frame


def multiple_for(book, sr_no):
    frame = normalize_multiple_frame(book.get(SHEET_MULTIPLE, pd.DataFrame(columns=MULTIPLE_COLUMNS)))
    rows = frame[frame[KEY] == sr_no]
    return [multiple_json(row) for _, row in rows.iterrows()]


def normalize_attachments_frame(frame):
    for column in ATTACHMENT_COLUMNS:
        if column not in frame.columns:
            frame[column] = pd.NaT if column == "Uploaded At" else ""
    frame = frame[ATTACHMENT_COLUMNS].copy()
    frame[KEY] = pd.to_numeric(frame[KEY], errors="coerce").fillna(0).astype(int)
    frame["Uploaded At"] = pd.to_datetime(frame["Uploaded At"], errors="coerce")
    for column in ["File Name", "Stored Name", "File Path", "Download Link", "Uploaded By"]:
        frame[column] = frame[column].fillna("").astype(str).str.strip()
    return frame


def attachment_json(row):
    return {
        KEY: int(row[KEY]),
        "file_name": str(row["File Name"]).strip(),
        "stored_name": str(row["Stored Name"]).strip(),
        "file_path": str(row["File Path"]).strip(),
        "download_link": str(row["Download Link"]).strip(),
        "uploaded_by": str(row["Uploaded By"]).strip(),
        "uploaded_at": as_date_text(row["Uploaded At"]),
    }


def attachments_for(book, sr_no):
    frame = normalize_attachments_frame(book.get(SHEET_ATTACHMENTS, pd.DataFrame(columns=ATTACHMENT_COLUMNS)))
    rows = frame[frame[KEY] == sr_no]
    return [attachment_json(row) for _, row in rows.iterrows()]


def coerce_value(column, value):
    if column in NUMERIC_COLUMNS:
        try:
            return round(float(str(value).strip() or 0), 2)
        except (TypeError, ValueError):
            raise ValueError(f"{column} must be a number.")
    if column in DATE_COLUMNS:
        parsed = pd.to_datetime(str(value).strip(), errors="coerce") if str(value).strip() else pd.NaT
        if str(value).strip() and pd.isna(parsed):
            raise ValueError(f"{column} is not a valid date.")
        return parsed
    return str(value).strip()


def lifecycle_for(book, sr_no, stage):
    frame = book.get(SHEET_LIFECYCLE, pd.DataFrame(columns=[KEY, "Stage", "Date", "Planned Date"]))
    rows = frame[pd.to_numeric(frame[KEY], errors="coerce") == sr_no] if len(frame) else frame
    dates = {str(row["Stage"]).strip(): row for _, row in rows.iterrows()}
    current = STAGES.index(stage) if stage in STAGES else 0
    timeline = []
    for index, name in enumerate(STAGES):
        entry = dates.get(name)
        actual = as_date_text(pd.to_datetime(entry["Date"], errors="coerce")) if entry is not None else ""
        planned = as_date_text(pd.to_datetime(entry["Planned Date"], errors="coerce")) if entry is not None else ""
        if index < current:
            state = "Completed"
        elif index == current:
            state = "In Progress"
        else:
            state = "Not Started"
        timeline.append({"stage": name, "index": index + 1, "state": state, "date": actual, "planned": planned})
    return timeline


def stamp_lifecycle(book, sr_no, stage):
    """Fill in actual dates for every stage the project has already reached."""
    frame = book.get(SHEET_LIFECYCLE)
    if frame is None or not len(frame) or stage not in STAGES:
        return
    reached = STAGES[: STAGES.index(stage) + 1]
    keys = pd.to_numeric(frame[KEY], errors="coerce")
    today = pd.Timestamp.today().normalize()
    for index in frame.index[(keys == sr_no) & frame["Stage"].astype(str).str.strip().isin(reached)]:
        if pd.isna(pd.to_datetime(frame.at[index, "Date"], errors="coerce")):
            frame.at[index, "Date"] = today
    book[SHEET_LIFECYCLE] = frame


def set_lifecycle_date(book, sr_no, stage, value):
    if stage not in STAGES or not str(value or "").strip():
        return
    date_value = coerce_value("Quotation Date", value)
    frame = book.get(SHEET_LIFECYCLE, pd.DataFrame(columns=[KEY, "Stage", "Date", "Planned Date"]))
    for column in [KEY, "Stage", "Date", "Planned Date"]:
        if column not in frame.columns:
            frame[column] = pd.NaT if column in ["Date", "Planned Date"] else ""
    keys = pd.to_numeric(frame[KEY], errors="coerce")
    stages = frame["Stage"].astype(str).str.strip()
    target = frame.index[(keys == sr_no) & (stages == stage)]
    if target.empty:
        frame = pd.concat([frame, pd.DataFrame([{KEY: sr_no, "Stage": stage, "Date": date_value, "Planned Date": pd.NaT}])], ignore_index=True)
    else:
        frame.at[target[0], "Date"] = date_value
    book[SHEET_LIFECYCLE] = frame


def comments_for(book, sr_no):
    frame = book.get(SHEET_COMMENTS)
    if frame is None or not len(frame):
        return []
    rows = frame[pd.to_numeric(frame[KEY], errors="coerce") == sr_no]
    records = []
    for index, row in rows.iterrows():
        created = pd.to_datetime(row.get("Created At"), errors="coerce")
        records.append({
            "id": int(index),
            "author": str(row.get("Author", "")).strip(),
            "initials": initials_of(str(row.get("Author", "")).strip()),
            "created_at": "" if pd.isna(created) else pd.Timestamp(created).strftime("%d-%b-%Y %I:%M %p"),
            "sort_key": "" if pd.isna(created) else pd.Timestamp(created).isoformat(),
            "text": str(row.get("Comment", "")).strip(),
        })
    records.sort(key=lambda item: item["sort_key"])
    return records


def initials_of(name):
    parts = [part for part in name.split() if part]
    return ("".join(part[0] for part in parts[:2]) or "?").upper()


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
def find_user(username):
    frame = read_sheet(SHEET_USERS)
    match = frame[frame["Username"].astype(str).str.strip().str.casefold() == username.strip().casefold()]
    if match.empty:
        return None
    row = match.iloc[0]
    return {
        "username": str(row["Username"]).strip(),
        "password_hash": str(row["Password Hash"]).strip(),
        "name": str(row["Name"]).strip(),
        "role": str(row["Role"]).strip().casefold() or "user",
        "custodian": str(row["Custodian"]).strip(),
    }


def current_user():
    return session.get("user")


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user():
            if request.path.startswith("/api/"):
                return jsonify(error="Session expired. Please sign in again."), 401
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def visible_projects(frame):
    """Non-admin users only ever see the projects they are custodian for."""
    user = current_user()
    if user["role"] == "admin":
        return frame
    return frame[frame["Custodian"].str.casefold() == user["custodian"].casefold()]


def can_access_project(sr_no):
    return not visible_projects(load_projects())[lambda frame: frame[KEY] == sr_no].empty


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/favicon.ico")
def favicon():
    return "", 204


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        user = find_user(username)
        if user and check_password_hash(user["password_hash"], password):
            session["user"] = {key: user[key] for key in ("username", "name", "role", "custodian")}
            return redirect(url_for("dashboard"))
        return render_template("login.html", error="Invalid username or password."), 401
    if current_user():
        return redirect(url_for("dashboard"))
    return render_template("login.html")


@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.get("/")
@login_required
def dashboard():
    frame = visible_projects(load_projects())
    projects = [project_json(row) for _, row in frame.iterrows()]
    custodians = sorted({project["Custodian"] for project in projects if project["Custodian"]})
    return render_template(
        "capex_dashboard.html",
        user=current_user(),
        projects=projects,
        add_project_custodians=user_custodians(),
        custodians=custodians,
        stages=STAGES,
    )


@app.get("/project/<int:sr_no>")
@login_required
def project_detail(sr_no):
    book = read_all()
    frame = visible_projects(load_projects())
    match = frame[frame[KEY] == sr_no]
    if match.empty:
        abort(404, description="Project not found or not assigned to you.")
    project = project_json(match.iloc[0])
    return render_template(
        "capex_project.html",
        user=current_user(),
        project=project,
        timeline=lifecycle_for(book, sr_no, project["Planning Status"]),
        comments=comments_for(book, sr_no),
        stages=STAGES,
        ordering_options=ORDERING_OPTIONS,
        fulfillment_options=FULFILLMENT_OPTIONS,
        status_options=STATUS_OPTIONS,
        multiple_rows=multiple_for(book, sr_no),
        attachments=attachments_for(book, sr_no),
        multiple_columns=MULTIPLE_COLUMNS[1:],
        numeric_columns=NUMERIC_COLUMNS,
        date_columns=DATE_COLUMNS,
        readonly_columns=READONLY_COLUMNS,
    )


@app.put("/api/projects/<int:sr_no>")
@login_required
def update_project(sr_no):
    payload = request.get_json(silent=True) or {}
    changes = payload.get("fields", {})
    lifecycle_dates = payload.get("lifecycle_dates", {})
    if not isinstance(changes, dict):
        return jsonify(error="Invalid payload."), 400
    if not isinstance(lifecycle_dates, dict):
        return jsonify(error="Invalid lifecycle date payload."), 400

    with workbook_lock:
        book = read_all()
        frame = load_projects()
        target = frame.index[frame[KEY] == sr_no]
        if target.empty:
            return jsonify(error="Project not found."), 404
        index = target[0]
        user = current_user()
        if user["role"] != "admin" and frame.at[index, "Custodian"].casefold() != user["custodian"].casefold():
            return jsonify(error="You can only edit your own projects."), 403

        for column, value in changes.items():
            if column not in COLUMNS or column in READONLY_COLUMNS:
                continue
            try:
                frame.at[index, column] = coerce_value(column, value)
            except ValueError as error:
                return jsonify(error=str(error)), 400

        if not frame.at[index, "Project/Equipment/Investment"]:
            return jsonify(error="Project name cannot be blank."), 400
        if frame.at[index, "Planning Status"] not in STAGES:
            return jsonify(error="Planning Status must be one of: " + ", ".join(STAGES)), 400

        frame.at[index, "Balance"] = round(
            float(frame.at[index, "Approved Budget"]) - float(frame.at[index, "Ordered"]), 2
        )
        frame.at[index, "Saving"] = round(
            float(frame.at[index, "BP-26 INR"]) - float(frame.at[index, "Approved Budget"]), 2
        )

        book[SHEET_PROJECTS] = frame
        stamp_lifecycle(book, sr_no, frame.at[index, "Planning Status"])
        set_lifecycle_date(book, sr_no, lifecycle_dates.get("previous_stage"), lifecycle_dates.get("previous_closed_date"))
        set_lifecycle_date(book, sr_no, lifecycle_dates.get("current_stage"), lifecycle_dates.get("current_start_date"))
        write_all(book)
        updated = project_json(frame.loc[index])
        timeline = lifecycle_for(book, sr_no, updated["Planning Status"])
    return jsonify(ok=True, project=updated, timeline=timeline, saved_at=datetime.now().strftime("%d-%b-%Y %H:%M"))


@app.put("/api/projects/<int:sr_no>/multiple")
@login_required
def save_multiple(sr_no):
    payload = request.get_json(silent=True) or {}
    rows = payload.get("rows", [])
    if not isinstance(rows, list):
        return jsonify(error="Invalid payload."), 400

    with workbook_lock:
        book = read_all()
        projects = load_projects()
        match = projects.index[projects[KEY] == sr_no]
        if match.empty:
            return jsonify(error="Project not found."), 404
        user = current_user()
        if user["role"] != "admin" and projects.at[match[0], "Custodian"].casefold() != user["custodian"].casefold():
            return jsonify(error="You can only edit your own projects."), 403

        saved_rows = []
        for row in rows:
            if not isinstance(row, dict):
                return jsonify(error="Invalid quotation row."), 400
            entry = {column: "" for column in MULTIPLE_COLUMNS}
            entry[KEY] = sr_no
            for column in NUMERIC_COLUMNS:
                if column in entry:
                    entry[column] = 0.0
            for column in DATE_COLUMNS:
                if column in entry:
                    entry[column] = pd.NaT
            for column in MULTIPLE_COLUMNS[1:]:
                if column in row:
                    try:
                        entry[column] = coerce_value(column, row[column])
                    except ValueError as error:
                        return jsonify(error=str(error)), 400
            saved_rows.append(entry)

        multiple = normalize_multiple_frame(book.get(SHEET_MULTIPLE, pd.DataFrame(columns=MULTIPLE_COLUMNS)))
        multiple = multiple[multiple[KEY] != sr_no]
        if saved_rows:
            multiple = pd.concat([multiple, pd.DataFrame(saved_rows, columns=MULTIPLE_COLUMNS)], ignore_index=True)
        book[SHEET_MULTIPLE] = multiple
        write_all(book)
        records = multiple_for(book, sr_no)
    return jsonify(ok=True, rows=records, saved_at=datetime.now().strftime("%d-%b-%Y %H:%M"))


@app.post("/api/projects/<int:sr_no>/attachments")
@login_required
def upload_attachments(sr_no):
    if not can_access_project(sr_no):
        return jsonify(error="Project not found or not assigned to you."), 404

    files = request.files.getlist("files")
    files = [file for file in files if file and file.filename]
    if not files:
        return jsonify(error="Select at least one file to upload."), 400

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with workbook_lock:
        book = read_all()
        attachments = normalize_attachments_frame(book.get(SHEET_ATTACHMENTS, pd.DataFrame(columns=ATTACHMENT_COLUMNS)))
        uploaded_at = pd.Timestamp.now().floor("s")
        new_rows = []
        for file in files:
            original_name = Path(file.filename).name
            safe_name = secure_filename(original_name) or "attachment"
            stored_name = f"{sr_no}_{uploaded_at:%Y%m%d%H%M%S}_{secrets.token_hex(4)}_{safe_name}"
            target = DATA_DIR / stored_name
            file.save(target)
            try:
                file_path = str(target.relative_to(APP_DIR))
            except ValueError:
                file_path = str(target)
            new_rows.append({
                KEY: sr_no,
                "File Name": original_name,
                "Stored Name": stored_name,
                "File Path": file_path,
                "Download Link": url_for("download_attachment", stored_name=stored_name, _external=True),
                "Uploaded By": current_user()["name"],
                "Uploaded At": uploaded_at,
            })

        book[SHEET_ATTACHMENTS] = pd.concat([attachments, pd.DataFrame(new_rows, columns=ATTACHMENT_COLUMNS)], ignore_index=True)
        write_all(book)
        records = attachments_for(book, sr_no)
    return jsonify(ok=True, attachments=records, saved_at=datetime.now().strftime("%d-%b-%Y %H:%M"))


@app.get("/attachments/<path:stored_name>")
@login_required
def download_attachment(stored_name):
    safe_name = Path(stored_name).name
    book = read_all()
    attachments = normalize_attachments_frame(book.get(SHEET_ATTACHMENTS, pd.DataFrame(columns=ATTACHMENT_COLUMNS)))
    match = attachments[attachments["Stored Name"] == safe_name]
    if match.empty:
        abort(404, description="Attachment not found.")
    sr_no = int(match.iloc[0][KEY])
    if not can_access_project(sr_no):
        abort(404, description="Attachment not found.")
    return send_from_directory(DATA_DIR, safe_name, as_attachment=True, download_name=match.iloc[0]["File Name"])


@app.post("/api/projects/<int:sr_no>/comments")
@login_required
def add_comment(sr_no):
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text", "")).strip()
    if not text:
        return jsonify(error="Comment cannot be empty."), 400
    if len(text) > 2000:
        return jsonify(error="Comment is too long."), 400

    with workbook_lock:
        book = read_all()
        frame = load_projects()
        if frame[frame[KEY] == sr_no].empty:
            return jsonify(error="Project not found."), 404
        comments = book.get(SHEET_COMMENTS, pd.DataFrame(columns=[KEY, "Author", "Created At", "Comment"]))
        entry = {
            KEY: sr_no,
            "Author": current_user()["name"],
            "Created At": pd.Timestamp.now().floor("s"),
            "Comment": text,
        }
        book[SHEET_COMMENTS] = pd.concat([comments, pd.DataFrame([entry])], ignore_index=True)
        write_all(book)
        records = comments_for(book, sr_no)
    return jsonify(ok=True, comments=records)


@app.delete("/api/projects/<int:sr_no>/comments/<int:comment_id>")
@login_required
def delete_comment(sr_no, comment_id):
    with workbook_lock:
        book = read_all()
        comments = book.get(SHEET_COMMENTS)
        if comments is None or comment_id not in comments.index:
            return jsonify(error="Comment not found."), 404
        row = comments.loc[comment_id]
        if int(pd.to_numeric(row[KEY], errors="coerce")) != sr_no:
            return jsonify(error="Comment not found."), 404
        user = current_user()
        if user["role"] != "admin" and str(row["Author"]).strip() != user["name"]:
            return jsonify(error="You can only delete your own comments."), 403
        book[SHEET_COMMENTS] = comments.drop(index=comment_id).reset_index(drop=True)
        write_all(book)
        records = comments_for(book, sr_no)
    return jsonify(ok=True, comments=records)


@app.get("/export")
@login_required
def export_projects():
    frame = visible_projects(load_projects()).copy()
    for column in DATE_COLUMNS:
        frame[column] = frame[column].map(as_date_text)
    stream = BytesIO()
    with pd.ExcelWriter(stream, engine="openpyxl") as writer:
        frame.to_excel(writer, sheet_name=SHEET_PROJECTS, index=False)
    stream.seek(0)
    return send_file(
        stream,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=f"capex_projects_{datetime.now():%Y%m%d_%H%M}.xlsx",
    )

def user_custodians():
    frame = read_sheet(SHEET_USERS)

    # Your seed file uses "Role". If your Excel file has "Type", this supports that too.
    role_column = "Type" if "Type" in frame.columns else "Role"

    rows = frame[
        frame[role_column].astype(str).str.strip().str.casefold() == "user"
    ]

    return sorted({
        str(row["Custodian"]).strip()
        for _, row in rows.iterrows()
        if str(row.get("Custodian", "")).strip()
    })


@app.post("/api/projects")
@login_required
def create_project():
    payload = request.get_json(silent=True) or {}
    fields = payload.get("fields", {})
    if not isinstance(fields, dict):
        return jsonify(error="Invalid payload."), 400

    with workbook_lock:
        book = read_all()
        frame = load_projects()

        sr_no = int(frame[KEY].max()) + 1 if len(frame) else 1
        user = current_user()

        row = {column: "" for column in COLUMNS}

        for column in NUMERIC_COLUMNS:
            row[column] = 0.0

        for column in DATE_COLUMNS:
            row[column] = pd.NaT

        row[KEY] = sr_no
        row["Planning Status"] = fields.get("Planning Status") or "Initiation"

        for column in COLUMNS:
            if column in READONLY_COLUMNS:
                continue
            if column in fields:
                try:
                    row[column] = coerce_value(column, fields[column])
                except ValueError as error:
                    return jsonify(error=str(error)), 400

        if user["role"] != "admin":
            row["Custodian"] = user["custodian"]

        if not row["Project/Equipment/Investment"]:
            return jsonify(error="Project name cannot be blank."), 400
        if not row["Custodian"]:
            return jsonify(error="Custodian cannot be blank."), 400
        if row["Planning Status"] not in STAGES:
            return jsonify(error="Planning Status must be one of: " + ", ".join(STAGES)), 400

        row["Balance"] = round(float(row["Approved Budget"] or 0) - float(row["Ordered"] or 0), 2)
        row["Saving"] = round(float(row["BP-26 INR"] or 0) - float(row["Approved Budget"] or 0), 2)

        frame = pd.concat([frame, pd.DataFrame([row], columns=COLUMNS)], ignore_index=True)
        book[SHEET_PROJECTS] = frame

        lifecycle = book.get(SHEET_LIFECYCLE, pd.DataFrame(columns=[KEY, "Stage", "Date", "Planned Date"]))
        start = pd.Timestamp.today().normalize()
        lifecycle_rows = []
        current_stage = STAGES.index(row["Planning Status"])
        for index, stage in enumerate(STAGES):
            planned = start + pd.Timedelta(days=index * 40)
            lifecycle_rows.append({
                KEY: sr_no,
                "Stage": stage,
                "Date": planned if index <= current_stage else pd.NaT,
                "Planned Date": planned,
            })
        book[SHEET_LIFECYCLE] = pd.concat([lifecycle, pd.DataFrame(lifecycle_rows)], ignore_index=True)

        write_all(book)
        created = project_json(frame.iloc[-1])

    return jsonify(ok=True, project=created, saved_at=datetime.now().strftime("%d-%b-%Y %H:%M")), 201


if __name__ == "__main__":
    ensure_workbook()
    app.run(host="127.0.0.1", port=5000, debug=True)
