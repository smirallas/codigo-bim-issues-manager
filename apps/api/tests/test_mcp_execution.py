import time

import pytest
from app.issues.models import IssuePlan
from app.issues.schemas import PlanContent
from pydantic import SecretStr
from sqlalchemy.orm import Session
from test_issues import ISSUE, prepare
from test_issues import issues as issues
from test_mcp_auth import SECRET, bearer


def delegated(issues):
    client, _, _ = issues
    settings = client.app.state.auth_service.settings
    settings.mcp_internal_secret = SecretStr(SECRET)
    binding = client.get("/mcp/bind", headers=bearer(settings)).json()
    return bearer(settings, "delegate", sub=binding["subject"], binding=binding["binding"])


def approval(issues, plan, **changes):
    client, _, web = issues
    return client.post(
        f"/projects/issue-plans/{plan['id']}/approve",
        headers=web,
        json={"content_digest": plan["content_digest"], **changes},
    )


def execute_mcp(issues, plan, headers):
    return issues[0].post(f"/mcp-api/projects/issue-plans/{plan['id']}/execute", headers=headers)


def test_unapproved_then_web_approval_then_replay(issues):
    client, fixture, _ = issues
    headers = delegated(issues)
    plan = prepare(issues).json()
    assert execute_mcp(issues, plan, headers).json()["error"] == "human_approval_required"
    assert fixture.writes == []
    approved = approval(issues, plan)
    assert approved.status_code == 200
    assert approved.json()["approved_at"] is not None
    assert fixture.writes == []
    first = execute_mcp(issues, plan, headers)
    assert first.status_code == 200
    assert first.json()["verified"] is True
    assert execute_mcp(issues, plan, headers).json() == first.json()
    assert len(fixture.writes) == 1
    assert (
        client.get(f"/mcp-api/projects/issue-plans/{plan['id']}", headers=headers).json()["result"]
        == first.json()
    )


def test_mcp_cannot_approve_or_claim_confirmed(issues):
    client, fixture, _ = issues
    headers = delegated(issues)
    plan = prepare(issues).json()
    assert (
        client.post(
            f"/mcp-api/projects/issue-plans/{plan['id']}/approve",
            headers=headers,
            json={"content_digest": plan["content_digest"]},
        ).status_code
        == 403
    )
    assert approval(issues, plan, confirmed=True).status_code == 422
    assert execute_mcp(issues, plan, headers).status_code == 409
    assert fixture.writes == []


def test_approval_requires_web_cookie_csrf_and_origin(issues):
    client, fixture, _ = issues
    plan = prepare(issues).json()
    path = f"/projects/issue-plans/{plan['id']}/approve"
    for headers in ({}, {"Origin": "http://127.0.0.1:5173"}, {"Origin": "https://evil.test"}):
        assert (
            client.post(
                path, headers=headers, json={"content_digest": plan["content_digest"]}
            ).status_code
            == 403
        )
    client.cookies.clear()
    assert approval(issues, plan).status_code == 401
    assert fixture.writes == []


def test_wrong_digest_never_approves(issues):
    headers = delegated(issues)
    plan = prepare(issues).json()
    assert (
        approval(issues, plan, content_digest="0" * 64).json()["error"]
        == "plan_changed_review_again"
    )
    assert execute_mcp(issues, plan, headers).status_code == 409
    assert issues[1].writes == []


@pytest.mark.parametrize("change", ["content", "expired", "permissions", "before"])
def test_approved_plan_revalidated_before_execution(issues, change):
    client, fixture, _ = issues
    headers = delegated(issues)
    plan = prepare(
        issues, operation="update", issue_id=ISSUE, subtype_id=None, title="Updated"
    ).json()
    assert approval(issues, plan).status_code == 200
    service = client.app.state.issue_service
    if change in {"content", "expired"}:
        with Session(service.engine) as db, db.begin():
            row = db.get(IssuePlan, plan["id"])
            if change == "expired":
                row.expires_at = int(time.time()) - 1
            else:
                content = PlanContent.model_validate_json(service._open(row.content_encrypted))
                content.request.title = "Not approved"
                content.payload["title"] = "Not approved"
                row.content_encrypted = service._seal(content.model_dump_json())
    elif change == "permissions":
        fixture.value["permittedAttributes"] = []
    else:
        fixture.value["title"] = "Someone changed this"
    assert execute_mcp(issues, plan, headers).status_code in {403, 409}
    assert fixture.writes == []


def test_uncertain_result_not_retried(issues):
    _, fixture, _ = issues
    headers = delegated(issues)
    plan = prepare(issues).json()
    approval(issues, plan)
    fixture.timeout = True
    assert execute_mcp(issues, plan, headers).json()["state"] == "uncertain"
    assert execute_mcp(issues, plan, headers).json()["state"] == "uncertain"
    assert len(fixture.writes) == 1
