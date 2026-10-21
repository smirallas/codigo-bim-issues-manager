import { useEffect, useRef, useState } from "react";
import {
  assigneeReasons,
  queryMembers,
  type AssigneeCheck,
  type Capabilities,
  type Member,
} from "./members";
import type { Selection } from "./projects";

type State<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "No se ha podido completar la consulta.";

export function ProjectMembers({ selection }: { selection: Selection }) {
  const [revision, setRevision] = useState(0);
  const [members, setMembers] = useState<State<Member[]>>({
    status: "loading",
  });
  const [permissions, setPermissions] = useState<State<Capabilities>>({
    status: "loading",
  });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [check, setCheck] = useState<State<AssigneeCheck> | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setMembers({ status: "loading" });
    setPermissions({ status: "loading" });
    setSelected("");
    setCheck(null);
    pending.current?.abort();
    void queryMembers(
      selection.hub.id,
      selection.project.id,
      "members",
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setMembers({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setMembers({ status: "error", message: errorMessage(error) });
      });
    void queryMembers(
      selection.hub.id,
      selection.project.id,
      "capabilities",
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted)
          setPermissions({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setPermissions({ status: "error", message: errorMessage(error) });
      });
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, [selection, revision]);

  async function validate() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setCheck({ status: "loading" });
    try {
      const data = await queryMembers(
        selection.hub.id,
        selection.project.id,
        "assignee-check",
        controller.signal,
        selected,
      );
      if (!controller.signal.aborted) setCheck({ status: "ready", data });
    } catch (error) {
      if (!controller.signal.aborted)
        setCheck({ status: "error", message: errorMessage(error) });
    }
  }

  const visible =
    members.status === "ready"
      ? members.data.filter((m) =>
          `${m.name} ${m.email ?? ""} ${m.company_name ?? ""}`
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase()),
        )
      : [];
  const currentMembers =
    members.status === "ready" && permissions.status === "ready"
      ? members.data.filter(
          (member) => member.autodesk_id === permissions.data.user_id,
        )
      : [];
  const current = currentMembers.length === 1 ? currentMembers[0] : undefined;
  const level = (value: boolean | null | undefined) =>
    value === true ? "sí" : value === false ? "no" : "no informado";
  return (
    <section className="members-panel" aria-labelledby="members-title">
      <h3 id="members-title">Miembros y capacidades de incidencias</h3>
      <p>
        Consulta de lectura para {selection.project.name}. Pertenecer al
        proyecto, poder leer sus miembros y poder asignar incidencias son
        comprobaciones distintas.
      </p>
      <button
        onClick={() => {
          pending.current?.abort();
          setCheck(null);
          setRevision((v) => v + 1);
        }}
      >
        Actualizar miembros y capacidades
      </button>
      {permissions.status === "loading" && (
        <p role="status">Consultando tus capacidades en Issues…</p>
      )}
      {permissions.status === "error" && (
        <p role="alert">{permissions.message}</p>
      )}
      {permissions.status === "ready" && (
        <div className="project-selection">
          <p>
            <strong>Capacidades de tu cuenta en Issues</strong>
          </p>
          {current && (
            <p>
              Según Admin: administrador de la cuenta:{" "}
              {level(current.account_admin)}; administrador del proyecto:{" "}
              {level(current.project_admin)}.
            </p>
          )}
          <p>
            Administrador del proyecto según Issues:{" "}
            {permissions.data.project_admin ? "sí" : "no"}.
          </p>
          <p>
            Creación de incidencias confirmada:{" "}
            {permissions.data.can_create ? "sí" : "no"}.
          </p>
          <p>
            Asignación:{" "}
            {permissions.data.assignment === "all"
              ? "a miembros de cualquier empresa"
              : permissions.data.assignment === "same_company"
                ? "solo a miembros de tu empresa"
                : "no confirmada por las capacidades recibidas"}
            .
          </p>
          <p>
            Estados permitidos:{" "}
            {permissions.data.permitted_statuses.join(", ") || "no informados"}.
          </p>
          {current?.project_admin === false &&
            permissions.data.project_admin && (
              <p>
                Admin e Issues devuelven indicadores de administración
                distintos. Las capacidades mostradas proceden de Issues; no se
                deducen del nivel de miembro. Esta diferencia no acredita una
                prueba con capacidades restringidas.
              </p>
            )}
        </div>
      )}
      {members.status === "loading" && (
        <p role="status">Consultando miembros del proyecto…</p>
      )}
      {members.status === "error" && <p role="alert">{members.message}</p>}
      {members.status === "ready" && (
        <>
          <p>
            {members.data.length} miembros devueltos por Autodesk. Solo se
            comprueban responsables individuales activos con identidad Autodesk;
            nombres iguales se distinguen por correo, empresa e identificador.
          </p>
          <label>
            Buscar miembro por nombre, correo o empresa
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelected("");
                setCheck(null);
                pending.current?.abort();
              }}
            />
          </label>
          <label>
            Posible responsable
            <select
              value={selected}
              onChange={(event) => {
                pending.current?.abort();
                setSelected(event.target.value);
                setCheck(null);
              }}
            >
              <option value="">Selecciona una persona</option>
              {visible.map((m) => (
                <option
                  key={m.id}
                  value={m.autodesk_id ?? m.id}
                  disabled={m.status !== "active" || !m.autodesk_id}
                >
                  {m.name} · {m.email ?? "sin correo"} ·{" "}
                  {m.company_name ?? "sin empresa"} · {m.autodesk_id ?? m.id} (
                  {m.status})
                </option>
              ))}
            </select>
          </label>
          {!visible.length && (
            <p>No hay miembros que coincidan con la búsqueda.</p>
          )}
          <button
            disabled={
              !selected ||
              permissions.status !== "ready" ||
              check?.status === "loading"
            }
            onClick={() => {
              void validate();
            }}
          >
            Comprobar responsable sin asignar
          </button>
        </>
      )}
      {check?.status === "loading" && (
        <p role="status">
          Revalidando proyecto, miembros y capacidades en Autodesk…
        </p>
      )}
      {check?.status === "error" && <p role="alert">{check.message}</p>}
      {check?.status === "ready" && (
        <p role="status">
          <strong>{check.data.member.name}: </strong>
          {assigneeReasons[check.data.reason]}
        </p>
      )}
      <p>
        Estas capacidades orientan una incidencia nueva. No autorizan editar
        cualquier incidencia existente: habrá que consultar también los permisos
        de cada incidencia y volver a validarlos al ejecutar.
      </p>
    </section>
  );
}
