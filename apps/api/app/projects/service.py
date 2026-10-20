import re
import time
from urllib.parse import urljoin, urlsplit

import httpx
from pydantic import BaseModel, Field

APS_ORIGIN = "https://developer.api.autodesk.com"
HUB_TYPE = "hubs:autodesk.bim360:Account"
PROJECT_TYPE = "projects:autodesk.bim360:Project"


class ProjectFailure(Exception):
    def __init__(self, code: str, status: int = 502) -> None:
        self.code = code
        self.status = status


class Resource(BaseModel):
    id: str
    name: str


class ResourceList(BaseModel):
    items: list[Resource]
    excluded: int
    incomplete: bool = False


class Selection(BaseModel):
    hub: Resource
    project: Resource


class Extension(BaseModel):
    type: str
    data: dict[str, object] = Field(default_factory=dict)


class Attributes(BaseModel):
    name: str = Field(min_length=1, max_length=1024)
    extension: Extension


class Entry(BaseModel):
    type: str
    id: str = Field(min_length=1, max_length=255)
    attributes: Attributes


class Link(BaseModel):
    href: str


class Page(BaseModel):
    data: list[Entry]
    links: dict[str, Link | None] = Field(default_factory=dict)
    meta: dict[str, object] = Field(default_factory=dict)


def checked_id(value: str) -> str:
    # Estos recursos de construcción usan b.; no se transforma su identificador.
    if not re.fullmatch(r"b\.[A-Za-z0-9_-]{1,200}", value):
        raise ProjectFailure("invalid_resource", 400)
    return value


class ProjectService:
    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self.transport = transport

    def _collection(self, path: str, access: str, kind: str) -> tuple[list[Entry], bool]:
        url = APS_ORIGIN + path
        visited: set[str] = set()
        entries: dict[str, Entry] = {}
        incomplete = False
        deadline = time.monotonic() + 20
        try:
            with httpx.Client(
                transport=self.transport, timeout=10, trust_env=False, follow_redirects=False
            ) as client:
                while url:
                    target = urlsplit(url)
                    # Un enlace de paginación nunca puede enviar el token a otro destino.
                    if (
                        target.scheme != "https"
                        or target.netloc != "developer.api.autodesk.com"
                        or target.path != path
                        or target.fragment
                        or url in visited
                        or len(visited) >= 100
                        or time.monotonic() >= deadline
                    ):
                        raise ProjectFailure("aps_invalid_pagination")
                    visited.add(url)
                    response = client.get(url, headers={"Authorization": f"Bearer {access}"})
                    if response.status_code == 401:
                        raise ProjectFailure("aps_reconnect_required", 401)
                    if response.status_code == 403:
                        raise ProjectFailure("aps_access_denied", 403)
                    if response.status_code == 404:
                        raise ProjectFailure("resource_unavailable", 404)
                    if response.status_code == 429:
                        raise ProjectFailure("aps_rate_limited", 429)
                    response.raise_for_status()
                    if response.status_code != 200:
                        raise ProjectFailure("aps_unavailable")
                    page = Page.model_validate(response.json())
                    incomplete = incomplete or bool(page.meta.get("warnings"))
                    for entry in page.data:
                        if entry.type != kind:
                            raise ProjectFailure("aps_invalid_response")
                        entries[entry.id] = entry
                    if len(entries) > 10000:
                        raise ProjectFailure("aps_collection_too_large")
                    next_link = page.links.get("next")
                    url = urljoin(url, next_link.href) if next_link else ""
        except httpx.HTTPError:
            raise ProjectFailure("aps_unavailable") from None
        except ValueError:
            raise ProjectFailure("aps_invalid_response") from None
        return list(entries.values()), incomplete

    def hubs(self, access: str) -> ResourceList:
        entries, incomplete = self._collection("/project/v1/hubs", access, "hubs")
        items = [
            Resource(id=checked_id(item.id), name=item.attributes.name)
            for item in entries
            if item.attributes.extension.type == HUB_TYPE
        ]
        return ResourceList(items=items, excluded=len(entries) - len(items), incomplete=incomplete)

    def _hub(self, access: str, hub_id: str) -> Resource:
        checked_id(hub_id)
        hubs = self.hubs(access)
        for hub in hubs.items:
            if hub.id == hub_id:
                return hub
        if hubs.incomplete:
            raise ProjectFailure("aps_partial_response")
        raise ProjectFailure("resource_unavailable", 404)

    def _projects(self, access: str, hub_id: str) -> ResourceList:
        entries, incomplete = self._collection(
            f"/project/v1/hubs/{hub_id}/projects", access, "projects"
        )
        items = [
            Resource(id=checked_id(item.id), name=item.attributes.name)
            for item in entries
            if item.attributes.extension.type == PROJECT_TYPE
            and item.attributes.extension.data.get("projectType") == "ACC"
        ]
        return ResourceList(items=items, excluded=len(entries) - len(items), incomplete=incomplete)

    def projects(self, access: str, hub_id: str) -> ResourceList:
        self._hub(access, hub_id)
        return self._projects(access, hub_id)

    def select(self, access: str, hub_id: str, project_id: str) -> Selection:
        checked_id(project_id)
        hub = self._hub(access, hub_id)
        # Seleccionar vuelve a consultar la colección con el usuario actual. No confiamos
        # en una lista anterior ni guardamos una autorización permanente en el navegador.
        projects = self._projects(access, hub_id)
        for project in projects.items:
            if project.id == project_id:
                return Selection(hub=hub, project=project)
        if projects.incomplete:
            raise ProjectFailure("aps_partial_response")
        raise ProjectFailure("resource_unavailable", 404)
