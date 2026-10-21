import { useEffect, useRef, useState } from "react";
import { queryProjects, type ResourceList, type Selection } from "./projects";
import { ProjectMembers } from "./ProjectMembers";

type Listing =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ResourceList };

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "No se ha podido completar la consulta.";
}

function ListNotice({ state, kind }: { state: Listing; kind: string }) {
  if (state.status === "loading") return <p role="status">Cargando {kind}…</p>;
  if (state.status === "error") return <p role="alert">{state.message}</p>;
  return (
    <>
      {state.data.incomplete && (
        <p role="alert">
          Autodesk ha devuelto advertencias. Puedes utilizar los resultados que
          aparecen, pero la lista puede estar incompleta. Si falta un recurso,
          revisa la integración y tu acceso en esa cuenta o región.
        </p>
      )}
      {!state.data.incomplete && state.data.items.length === 0 && (
        <p>
          No hay {kind} compatibles accesibles con esta cuenta e integración.
        </p>
      )}
      {state.data.excluded > 0 && (
        <p>
          Se han omitido {state.data.excluded} recursos de otros tipos. Esta
          demostración trabaja con proyectos de construcción ACC/Forma.
        </p>
      )}
    </>
  );
}

export function ProjectBrowser() {
  const [revision, setRevision] = useState(0);
  const [hubs, setHubs] = useState<Listing>({ status: "loading" });
  const [hubId, setHubId] = useState("");
  const [projects, setProjects] = useState<Listing>({ status: "loading" });
  const [projectId, setProjectId] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);

  function resetSelection() {
    pending.current?.abort();
    setSelection(null);
    setSelecting(false);
    setError("");
  }

  useEffect(() => {
    const controller = new AbortController();
    void queryProjects(undefined, undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && "items" in data)
          setHubs({ status: "ready", data });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setHubs({ status: "error", message: message(cause) });
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!hubId) return;
    const controller = new AbortController();
    void queryProjects(hubId, undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && "items" in data)
          setProjects({ status: "ready", data });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setProjects({ status: "error", message: message(cause) });
      });
    return () => controller.abort();
  }, [hubId]);

  useEffect(() => () => pending.current?.abort(), []);

  async function select() {
    resetSelection();
    const controller = new AbortController();
    pending.current = controller;
    setSelecting(true);
    try {
      const data = await queryProjects(hubId, projectId, controller.signal);
      if (!controller.signal.aborted && "project" in data) setSelection(data);
    } catch (cause) {
      if (!controller.signal.aborted) setError(message(cause));
    } finally {
      if (!controller.signal.aborted) setSelecting(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="projects-title">
      <h2 id="projects-title">Elige tu proyecto</h2>
      <p>
        Consultamos los hubs y proyectos accesibles con tu cuenta. La selección
        comprueba el acceso de lectura; después consultamos los miembros y tus
        capacidades sobre incidencias.
      </p>
      <button
        onClick={() => {
          resetSelection();
          setHubId("");
          setProjectId("");
          setHubs({ status: "loading" });
          setRevision((value) => value + 1);
        }}
      >
        Actualizar lista
      </button>
      <ListNotice state={hubs} kind="hubs" />
      {hubs.status === "ready" && hubs.data.items.length > 0 && (
        <label>
          Hub (cuenta de construcción)
          <select
            value={hubId}
            onChange={(event) => {
              resetSelection();
              setHubId(event.target.value);
              setProjectId("");
              setProjects({ status: "loading" });
            }}
          >
            <option value="">Selecciona un hub</option>
            {hubs.data.items.map((hub) => (
              <option key={hub.id} value={hub.id}>
                {hub.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {hubId && (
        <>
          <ListNotice state={projects} kind="proyectos" />
          {projects.status === "ready" && projects.data.items.length > 0 && (
            <>
              <label>
                Proyecto
                <select
                  value={projectId}
                  onChange={(event) => {
                    resetSelection();
                    setProjectId(event.target.value);
                  }}
                >
                  <option value="">Selecciona un proyecto</option>
                  {projects.data.items.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={!projectId || selecting}
                onClick={() => {
                  void select();
                }}
              >
                {selecting ? "Comprobando acceso…" : "Seleccionar proyecto"}
              </button>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {selection && (
        <>
          <div role="status" className="project-selection">
            <strong>Proyecto seleccionado: {selection.project.name}</strong>
            <p>Hub: {selection.hub.name}</p>
            <p>Acceso de lectura comprobado con Autodesk.</p>
          </div>
          <ProjectMembers
            key={`${selection.hub.id}/${selection.project.id}`}
            selection={selection}
          />
        </>
      )}
      <p>
        ¿Falta un proyecto? Comprueba que la aplicación esté habilitada en las
        integraciones de la cuenta y que tengas acceso a Docs y sus archivos.
      </p>
    </section>
  );
}
