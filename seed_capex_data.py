"""Creates capex_data.xlsx - the Excel database used by capex_app.py.

Run directly to regenerate demo data:  python seed_capex_data.py
"""
from __future__ import annotations

import random
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from werkzeug.security import generate_password_hash

STAGES = ["Initiation", "Planning", "Execution", "Monitoring", "Closure"]
COLUMNS = [
    "Sr.No.", "Project/Equipment/Investment", "Custodian", "BP-26 INR", "Approved Budget",
    "Ordered", "Balance", "Saving", "Planning Status", "Quotation Date", "Quotation Value",
    "Sourcing Request No.", "RBGA Work-on No. for Budget", "MI No.", "PO No.", "PO Value (MINR)",
    "Vendor", "Vendor Code", "Material Delivery plan date", "Material Delivery Actual date",
    "Execution Start", "Execution End", "Actual Fulfillment Value", "Ordering", "Fullfillment",
    "Commitment to EM", "Status", "Remarks",
]

CUSTODIANS = ["Ravi Sharma", "Anita Verma", "Deepak Singh", "Neha Gupta", "Suresh Kumar"]
VENDORS = [
    ("ABC Automation Pvt. Ltd.", "VEND-1023"),
    ("Siemens India Ltd.", "VEND-2041"),
    ("Thermax Engineering", "VEND-3310"),
    ("Voltas Projects", "VEND-4128"),
    ("Kirloskar Systems", "VEND-5502"),
]
PROJECT_NAMES = [
    "Boiler Improvement Project", "HVAC System Upgrade", "Production Line Automation",
    "Water Treatment Plant", "Electrical Panel Replacement", "Compressor Room Revamp",
    "Robotic Welding Cell", "Cooling Tower Retrofit", "Warehouse Racking System",
    "Fire Safety Modernisation", "Laser Cutting Machine", "Paint Shop Oven Upgrade",
    "CNC Machining Centre", "Effluent Recycling Unit", "Solar Rooftop Phase-2",
    "Assembly Conveyor Extension", "Quality Lab Instruments", "Air Compressor Addition",
    "Substation Capacity Upgrade", "Material Handling AGVs", "Tool Room Modernisation",
    "Chiller Plant Replacement", "Packaging Line Automation", "Energy Monitoring System",
]

USERS = [
    ("admin", "admin123", "System Admin", "admin", ""),
    ("ravi", "ravi123", "Ravi Sharma", "user", "Ravi Sharma"),
    ("anita", "anita123", "Anita Verma", "user", "Anita Verma"),
    ("deepak", "deepak123", "Deepak Singh", "user", "Deepak Singh"),
    ("neha", "neha123", "Neha Gupta", "user", "Neha Gupta"),
    ("suresh", "suresh123", "Suresh Kumar", "user", "Suresh Kumar"),
]


def build_projects():
    random.seed(26)
    base = date(2026, 1, 5)
    rows = []
    for number, name in enumerate(PROJECT_NAMES, start=1):
        custodian = CUSTODIANS[(number - 1) % len(CUSTODIANS)]
        stage = STAGES[min(4, max(0, int(random.triangular(0, 4, 2))))]
        stage_index = STAGES.index(stage)
        bp = round(random.uniform(5, 32), 2)
        approved = round(bp - round(random.uniform(0.1, 2.0), 2), 2)
        ordered = 0.0 if stage_index < 2 else round(approved * random.uniform(0.4, 1.0), 2)
        vendor, vendor_code = VENDORS[(number - 1) % len(VENDORS)]
        quote_date = base + timedelta(days=number * 3)
        rows.append({
            "Sr.No.": number,
            "Project/Equipment/Investment": name,
            "Custodian": custodian,
            "BP-26 INR": bp,
            "Approved Budget": approved,
            "Ordered": ordered,
            "Balance": round(approved - ordered, 2),
            "Saving": round(bp - approved, 2),
            "Planning Status": stage,
            "Quotation Date": quote_date,
            "Quotation Value": round(approved * 1.05, 2),
            "Sourcing Request No.": f"SRC/26/{100 + number:05d}",
            "RBGA Work-on No. for Budget": f"RBGA/BUD/26/{440 + number}",
            "MI No.": f"MI/26/{140 + number}",
            "PO No.": f"PO/26/{90 + number:04d}" if ordered else "",
            "PO Value (MINR)": ordered,
            "Vendor": vendor if ordered else "",
            "Vendor Code": vendor_code if ordered else "",
            "Material Delivery plan date": quote_date + timedelta(days=45),
            "Material Delivery Actual date": quote_date + timedelta(days=48) if stage_index >= 3 else pd.NaT,
            "Execution Start": quote_date + timedelta(days=11) if stage_index >= 2 else pd.NaT,
            "Execution End": quote_date + timedelta(days=95) if stage_index >= 4 else pd.NaT,
            "Actual Fulfillment Value": ordered if stage_index >= 4 else 0.0,
            "Ordering": ["Not Started", "Not Started", "In Progress", "Completed", "Completed"][stage_index],
            "Fullfillment": ["Pending", "Pending", "Pending", "Partial", "Completed"][stage_index],
            "Commitment to EM": date(2026, 4, 30),
            "Status": ["On Track", "On Track", "On Track", "Delayed", "Completed"][stage_index],
            "Remarks": "",
        })
    return pd.DataFrame(rows, columns=COLUMNS)


def build_lifecycle(projects):
    rows = []
    for _, project in projects.iterrows():
        start = pd.Timestamp(project["Quotation Date"])
        current = STAGES.index(project["Planning Status"])
        for index, stage in enumerate(STAGES):
            planned = (start + pd.Timedelta(days=index * 40)).date()
            rows.append({
                "Sr.No.": int(project["Sr.No."]),
                "Stage": stage,
                "Date": planned if index <= current else pd.NaT,
                "Planned Date": planned,
            })
    return pd.DataFrame(rows, columns=["Sr.No.", "Stage", "Date", "Planned Date"])


def build_users():
    return pd.DataFrame(
        [
            {
                "Username": username,
                "Password Hash": generate_password_hash(password),
                "Name": name,
                "Role": role,
                "Custodian": custodian,
            }
            for username, password, name, role, custodian in USERS
        ]
    )


def build_comments():
    return pd.DataFrame(
        [
            {"Sr.No.": 3, "Author": "Deepak Singh", "Created At": pd.Timestamp("2026-09-08 09:20"),
             "Comment": "Site preparation is in progress."},
            {"Sr.No.": 3, "Author": "Vinil Kumar", "Created At": pd.Timestamp("2026-09-04 10:30"),
             "Comment": "Execution started as planned. Vendor mobilized at site."},
        ],
        columns=["Sr.No.", "Author", "Created At", "Comment"],
    )


def build_workbook(target: Path):
    projects = build_projects()
    target.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(target, engine="openpyxl") as writer:
        projects.to_excel(writer, sheet_name="Projects", index=False)
        build_users().to_excel(writer, sheet_name="Users", index=False)
        build_comments().to_excel(writer, sheet_name="Comments", index=False)
        build_lifecycle(projects).to_excel(writer, sheet_name="Lifecycle", index=False)
    return target


if __name__ == "__main__":
    path = build_workbook(Path(__file__).resolve().parent / "capex_data.xlsx")
    print(f"Created {path}")
