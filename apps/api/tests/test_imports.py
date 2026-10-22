import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from io import BytesIO
from zipfile import ZipFile

import pytest
from app.imports.models import ImportPlan
from app.imports.workbook import HEADERS, MAX_BYTES, parse, template
from app.projects.service import ProjectFailure
from openpyxl import Workbook
from sqlalchemy import update
from sqlalchemy.orm import Session
from test_issues import issues as e04_issues  # noqa: F401
from test_members import BASE


@pytest.fixture
def issues(e04_issues):  # noqa: F811 -- Inyección de la fixture E04 compartida.
    return e04_issues


def workbook(rows=None, headers=HEADERS):
    book = Workbook()
    sheet = book.active
    sheet.title = "Incidencias"
    sheet.append(headers)
    for row in rows or [("Synthetic Excel", "Test only", "Quality / General", "closed", "", "")]:
        sheet.append(row)
    result = BytesIO()
    book.save(result)
    book.close()
    return result.getvalue()


def prepare(issues, data=None):
    client, _, headers = issues
    return client.post(f"{BASE}/imports", headers=headers, content=data or workbook())


def test_template_and_native_excel_date():
    assert parse(template())[0][1]["tipo"] == "General / General"
    rows = parse(workbook([("Date", "", "Quality / General", "open", "", datetime(2026, 11, 2))]))
    assert rows[0][1]["fecha_limite"] == "2026-11-02"


@pytest.mark.parametrize(
    "data,code",
    [
        (b"not a spreadsheet", "excel_invalid"),
        (b"x" * (MAX_BYTES + 1), "excel_size_limit"),
        (workbook(headers=("titulo",)), "excel_columns_required"),
        (workbook([(str(i), "", "", "", "", "") for i in range(26)]), "excel_dimensions_limit"),
    ],
    ids=["invalid", "size", "columns", "rows"],
)
def test_invalid_files(data, code):
    with pytest.raises(ProjectFailure) as error:
        parse(data)
    assert error.value.code == code


@pytest.mark.parametrize(
    "cell,code", [("=1+1", "excel_formula_or_link"), (42, "excel_cell_invalid")]
)
def test_formula_and_nontext_cells_blocked(cell, code):
    assert parse(workbook([(cell, "", "Quality / General", "open", "", "")]))[0][2] == code


def test_bad_date_blocks_row():
    assert (
        parse(workbook([("Date", "", "Quality / General", "open", "", "02/11/2026")]))[0][2]
        == "excel_date_invalid"
    )


def test_external_links_rejected():
    buffer = BytesIO(workbook())
    with ZipFile(buffer, "a") as archive:
        archive.writestr("xl/externalLinks/test.xml", "external")
    with pytest.raises(ProjectFailure):
        parse(buffer.getvalue())


def test_false_dimensions_cannot_hide_extra_data():
    source = workbook([("Valid", "", "Quality / General", "open", "", "")])
    output = BytesIO()
    with ZipFile(BytesIO(source)) as original, ZipFile(output, "w") as changed:
        for entry in original.infolist():
            value = original.read(entry)
            if entry.filename == "xl/worksheets/sheet1.xml":
                value = re.sub(rb'<dimension ref="[^"]+"', b'<dimension ref="A1:F2"', value)
                value = value.replace(
                    b"</sheetData>",
                    b'<row r="100"><c r="A100" t="inlineStr"><is><t>Hidden</t></is>'
                    b"</c></row></sheetData>",
                )
            changed.writestr(entry, value)
    with pytest.raises(ProjectFailure) as error:
        parse(output.getvalue())
    assert error.value.code == "excel_dimensions_limit"


def test_another_authenticated_session_cannot_read_or_approve(issues):
    from test_auth import login

    client, fixture, _ = issues
    review = prepare(issues).json()
    client.cookies.clear()
    login(client)
    csrf = client.get("/auth/session").json()["csrf_token"]
    base = f"/projects/imports/{review['id']}"
    assert client.get(base).status_code == 404
    assert (
        client.post(
            base + "/approve", headers={"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": csrf}
        ).status_code
        == 404
    )
    assert fixture.writes == []


def test_prepare_does_not_write_and_requires_approval(issues):
    client, fixture, headers = issues
    response = prepare(issues)
    assert response.status_code == 200
    review = response.json()
    assert review["rows"][0]["plan"]["content"]["payload"]["status"] == "closed"
    assert fixture.writes == []
    base = f"/projects/imports/{review['id']}"
    assert client.post(base + "/rows/2/execute", headers=headers).status_code == 409
    assert fixture.writes == []
    assert client.post(base + "/approve", headers=headers).status_code == 200
    result = client.post(base + "/rows/2/execute", headers=headers).json()
    assert result["rows"][0]["plan"]["result"]["verified"]
    assert client.post(base + "/rows/2/execute", headers=headers).json() == result
    assert client.get(base).json() == result
    assert len(fixture.writes) == 1


def test_partial_validation_only_sends_valid_row(issues):
    client, fixture, headers = issues
    data = workbook(
        [
            ("Valid", "", "Quality / General", "closed", "", ""),
            ("", "", "Quality / General", "closed", "", ""),
        ]
    )
    review = prepare(issues, data).json()
    assert review["rows"][1]["error"] == "excel_row_invalid"
    base = f"/projects/imports/{review['id']}"
    client.post(base + "/approve", headers=headers)
    assert client.post(base + "/rows/3/execute", headers=headers).status_code == 409
    assert client.post(base + "/rows/2/execute", headers=headers).status_code == 200
    assert len(fixture.writes) == 1


def test_ambiguous_assignee_and_unknown_type(issues):
    client, fixture, _ = issues
    # Dos miembros con el mismo nombre no se resuelven eligiendo el primero.
    fixture.users[1]["name"] = fixture.users[0]["name"]
    name = fixture.users[0]["name"]
    review = prepare(
        issues,
        workbook(
            [
                ("Test", "", "Quality / General", "closed", name, ""),
                ("Type", "", "Missing", "closed", "", ""),
            ]
        ),
    ).json()
    assert [r["error"] for r in review["rows"]] == [
        "excel_assignee_not_unique",
        "excel_type_not_unique",
    ]
    assert (
        client.post(f"/projects/imports/{review['id']}/approve", headers=issues[2]).status_code
        == 409
    )
    assert fixture.writes == []


def test_private_encrypted_and_expiring(issues):
    client, fixture, headers = issues
    review = prepare(issues).json()
    base = f"/projects/imports/{review['id']}"
    engine = client.app.state.database_engine
    with Session(engine) as db:
        row = db.get(ImportPlan, review["id"])
        assert "Synthetic Excel" not in row.content_encrypted
        db.execute(update(ImportPlan).values(expires_at=int(time.time()) - 1))
        db.commit()
    assert client.post(base + "/approve", headers=headers).status_code == 409
    client.cookies.clear()
    assert client.get(base).status_code == 401
    assert fixture.writes == []


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://foreign.test", "X-CSRF-Token": "bad"}])
def test_write_protection(issues, headers):
    client, fixture, _ = issues
    assert client.post(f"{BASE}/imports", headers=headers, content=workbook()).status_code == 403
    assert fixture.writes == []


def test_timeout_and_rejection_persist_without_replay(issues):
    client, fixture, headers = issues
    review = prepare(
        issues,
        workbook(
            [
                ("Uncertain", "", "Quality / General", "closed", "", ""),
                ("Rejected", "", "Quality / General", "closed", "", ""),
            ]
        ),
    ).json()
    base = f"/projects/imports/{review['id']}"
    client.post(base + "/approve", headers=headers)
    fixture.timeout = True
    client.post(base + "/rows/2/execute", headers=headers)
    fixture.timeout = False
    fixture.write_status = 403
    result = client.post(base + "/rows/3/execute", headers=headers).json()
    assert [r["plan"]["result"]["state"] for r in result["rows"]] == ["uncertain", "rejected"]
    client.post(base + "/rows/2/execute", headers=headers)
    client.post(base + "/rows/3/execute", headers=headers)
    assert len(fixture.writes) == 2


def test_concurrent_row_execution_and_permission_revalidation(issues):
    client, fixture, headers = issues
    review = prepare(issues).json()
    base = f"/projects/imports/{review['id']}"
    client.post(base + "/approve", headers=headers)
    with ThreadPoolExecutor(2) as pool:
        results = list(
            pool.map(lambda _: client.post(base + "/rows/2/execute", headers=headers), range(2))
        )
    assert all(r.status_code == 200 for r in results)
    assert len(fixture.writes) == 1


def test_due_date_uses_shared_validator(issues):
    client, fixture, _ = issues
    fixture.issue_profile["issues"]["new"]["permittedAttributes"].append("dueDate")
    review = prepare(
        issues, workbook([("Date", "", "Quality / General", "closed", "", "2026-11-02")])
    ).json()
    assert review["rows"][0]["plan"]["content"]["payload"]["dueDate"] == "2026-11-02"
    assert fixture.writes == []


def test_revoked_permission_is_blocked_without_a_write(issues):
    client, fixture, headers = issues
    review = prepare(issues).json()
    base = f"/projects/imports/{review['id']}"
    client.post(base + "/approve", headers=headers)
    fixture.issue_profile["permissionLevels"] = []
    result = client.post(base + "/rows/2/execute", headers=headers).json()
    assert result["rows"][0]["error"] == "issue_creation_not_permitted"
    fixture.issue_profile["permissionLevels"] = ["create"]
    client.post(base + "/rows/2/execute", headers=headers)
    assert fixture.writes == []
