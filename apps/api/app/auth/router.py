from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.responses import Response

from app.auth.schemas import AuthConfigResponse, DisconnectResponse, SessionResponse, UserIdentity
from app.auth.service import AuthFailure, AuthService

SESSION_COOKIE = "issues_session"
LOGIN_COOKIE = "issues_login"
router = APIRouter(prefix="/auth", tags=["authentication"])


def auth_service(request: Request) -> AuthService:
    service: AuthService = request.app.state.auth_service
    return service


def set_cookie(response: Response, service: AuthService, name: str, value: str, age: int) -> None:
    response.set_cookie(
        name,
        value,
        max_age=age,
        httponly=True,
        samesite="lax",
        secure=service.settings.cookie_secure,
        path="/",
    )


@router.get("/config")
def auth_config(request: Request) -> AuthConfigResponse:
    return AuthConfigResponse(configured=auth_service(request).settings.login_configured)


@router.get("/login")
def login(request: Request) -> Response:
    """Inicia el recorrido en el backend; nunca devuelve tokens APS al navegador."""
    service = auth_service(request)
    try:
        url, browser = service.start_login()
    except AuthFailure as exc:
        return JSONResponse({"error": exc.code}, status_code=exc.status)
    response = RedirectResponse(url, status_code=303)
    set_cookie(response, service, LOGIN_COOKIE, browser, 600)
    return response


@router.get("/autodesk/callback")
def callback(request: Request) -> Response:
    """Valida state y su cookie antes de procesar incluso una cancelación del proveedor."""
    service = auth_service(request)
    query = request.query_params
    state = query.get("state", "")
    browser = request.cookies.get(LOGIN_COOKIE, "")
    session_id: str | None = None
    failure: AuthFailure | None = None
    try:
        if (
            not state
            or not browser
            or len(state) > 128
            or len(browser) > 128
            or any(len(query.getlist(key)) > 1 for key in ("state", "code", "error"))
            or (query.get("code") and query.get("error"))
            or len(query.get("code", "")) > 8192
        ):
            raise AuthFailure("invalid_callback", 400)
        session_id = service.complete_login(
            state,
            browser,
            query.get("code"),
            query.get("error"),
            request.cookies.get(SESSION_COOKIE),
        )
    except AuthFailure as exc:
        failure = exc
    destination = service.settings.web_origin.rstrip("/") + "/"
    if failure:
        destination += f"?auth_error={failure.code}"
    response = RedirectResponse(destination, status_code=303)
    if not failure or failure.code != "invalid_callback":
        response.delete_cookie(LOGIN_COOKIE, path="/")
    if session_id:
        set_cookie(
            response, service, SESSION_COOKIE, session_id, service.settings.session_ttl_seconds
        )
    return response


@router.get("/session", response_model=SessionResponse)
def current_session(request: Request) -> Response:
    service = auth_service(request)
    try:
        session_id = request.cookies.get(SESSION_COOKIE)
        if not session_id:
            raise AuthFailure("unauthenticated")
        info = service.session_info(session_id)
        payload = SessionResponse(
            user=UserIdentity(subject=info.subject, email=info.email, name=info.name),
            csrf_token=info.csrf_token,
            expires_at=info.expires_at,
        )
        return JSONResponse(payload.model_dump())
    except AuthFailure as exc:
        response = JSONResponse({"error": exc.code}, status_code=exc.status)
        if exc.status == 401 or exc.code == "access_denied":
            response.delete_cookie(SESSION_COOKIE, path="/")
        return response


@router.post("/logout", response_model=DisconnectResponse)
def logout(request: Request) -> Response:
    """Exige origen exacto y CSRF antes de desconectar esta sesión y su conexión APS."""
    service = auth_service(request)
    try:
        if request.headers.get("origin") != service.settings.web_origin.rstrip("/"):
            raise AuthFailure("invalid_origin", 403)
        session_id = request.cookies.get(SESSION_COOKIE)
        if not session_id:
            raise AuthFailure("unauthenticated")
        confirmed = service.disconnect(session_id, request.headers.get("x-csrf-token", ""))
        response = JSONResponse(
            DisconnectResponse(
                provider_revocation="confirmed" if confirmed else "unconfirmed",
            ).model_dump()
        )
        response.delete_cookie(SESSION_COOKIE, path="/")
        return response
    except AuthFailure as exc:
        return JSONResponse({"error": exc.code}, status_code=exc.status)
