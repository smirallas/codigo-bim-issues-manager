"""Plantilla deliberadamente pequeña: datos, nunca fórmulas, macros ni rutas externas."""

import re
from datetime import date, datetime
from io import BytesIO
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile, ZipFile

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import fromstring
from openpyxl import Workbook, load_workbook

from app.projects.service import ProjectFailure

HEADERS = ("titulo", "descripcion", "tipo", "estado", "responsable", "fecha_limite")
MAX_BYTES = 1024 * 1024
MAX_ROWS = 25


def template() -> bytes:
    """Genera un ejemplo descargable reproducible, sin datos de proyectos ni usuarios."""
    book = Workbook()
    sheet = book.active
    sheet.title = "Incidencias"
    sheet.append(HEADERS)
    sheet.append(
        (
            "Ejemplo sintético · revisar",
            "No representa un defecto real",
            "General / General",
            "closed",
            "",
            "",
        )
    )
    sheet.freeze_panes = "A2"
    for col, width in zip("ABCDEF", (40, 65, 30, 18, 35, 22), strict=True):
        sheet.column_dimensions[col].width = width
    result = BytesIO()
    book.save(result)
    book.close()
    return result.getvalue()


def parse(data: bytes) -> list[tuple[int, dict[str, str], str | None]]:
    """Limita el contenedor y normaliza celdas; devuelve errores con su fila original."""
    if not data or len(data) > MAX_BYTES:
        raise ProjectFailure("excel_size_limit", 413)
    try:
        # Se limita también el contenido descomprimido antes de leer sus XML.
        with ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 100 or sum(e.file_size for e in entries) > 8 * MAX_BYTES:
                raise ProjectFailure("excel_size_limit", 413)
            if any(
                "vbaproject" in e.filename.lower() or "externallinks/" in e.filename.lower()
                for e in entries
            ):
                raise ProjectFailure("excel_active_content", 422)
            for entry in entries:
                if entry.filename.startswith("xl/worksheets/") and entry.filename.endswith(".xml"):
                    # No confiamos en dimension: puede ocultar filas fuera del rango declarado.
                    root = fromstring(archive.read(entry))
                    for cell in root.iter(
                        "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"
                    ):
                        match = re.fullmatch(r"([A-F])([1-9][0-9]?)", cell.attrib.get("r", ""))
                        if not match or int(match[2]) > MAX_ROWS + 1:
                            raise ProjectFailure("excel_dimensions_limit", 422)
                if entry.filename.endswith(".rels"):
                    relations = fromstring(archive.read(entry))
                    if any(node.attrib.get("TargetMode") == "External" for node in relations):
                        raise ProjectFailure("excel_active_content", 422)
        book = load_workbook(BytesIO(data), read_only=True, data_only=False, keep_links=False)
        try:
            if book.sheetnames != ["Incidencias"]:
                raise ProjectFailure("excel_sheet_required", 422)
            sheet = book["Incidencias"]
            if (sheet.max_row or 0) > MAX_ROWS + 1 or (sheet.max_column or 0) > len(HEADERS):
                raise ProjectFailure("excel_dimensions_limit", 422)
            cells = list(sheet.iter_rows(max_row=MAX_ROWS + 2, max_col=len(HEADERS) + 1))
            if tuple(c.value for c in cells[0][: len(HEADERS)]) != HEADERS:
                raise ProjectFailure("excel_columns_required", 422)
            rows = []
            for number, source in enumerate(cells[1:], 2):
                if all(c.value is None for c in source):
                    continue
                if number > MAX_ROWS + 1 or source[-1].value is not None:
                    raise ProjectFailure("excel_dimensions_limit", 422)
                values: dict[str, str] = {}
                error = None
                for name, cell in zip(HEADERS, source[: len(HEADERS)], strict=True):
                    value = cell.value
                    if cell.data_type in {"f", "e"} or getattr(cell, "hyperlink", None):
                        error = "excel_formula_or_link"
                    if value is None:
                        values[name] = ""
                    elif name == "fecha_limite" and isinstance(value, date):
                        values[name] = (
                            value.date() if isinstance(value, datetime) else value
                        ).isoformat()
                    elif isinstance(value, str) and len(value) <= 2000:
                        values[name] = value.strip()
                    else:
                        error = "excel_cell_invalid"
                        values[name] = ""
                if values.get("fecha_limite"):
                    try:
                        value = values["fecha_limite"]
                        if date.fromisoformat(value).isoformat() != value:
                            raise ValueError
                    except ValueError:
                        error = "excel_date_invalid"
                rows.append((number, values, error))
            if not rows:
                raise ProjectFailure("excel_empty", 422)
            return rows
        finally:
            book.close()
    except ProjectFailure:
        raise
    except (
        BadZipFile,
        ValueError,
        KeyError,
        OSError,
        TypeError,
        SyntaxError,
        ParseError,
        DefusedXmlException,
        IndexError,
        RuntimeError,
        NotImplementedError,
        OverflowError,
    ):
        raise ProjectFailure("excel_invalid", 422) from None
