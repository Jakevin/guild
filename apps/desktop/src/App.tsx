import { useEffect, useState } from "react";
import type { BenchListing, HealthResponse } from "@guild/protocol";
import { DAEMON_ORIGIN, fetchBench, fetchHealth } from "./api";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; health: HealthResponse; bench: BenchListing }
  | { phase: "error"; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchHealth(), fetchBench()])
      .then(([health, bench]) => {
        if (!cancelled) setState({ phase: "ready", health, bench });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) setState({ phase: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Guild</p>
        <h1>Talent bench</h1>
        <p className="muted">Local daemon {DAEMON_ORIGIN}</p>
      </header>

      {state.phase === "loading" ? <p>Connecting to guildd…</p> : null}

      {state.phase === "error" ? (
        <p className="error">
          Could not reach guildd ({state.message}). Start it with{" "}
          <code>pnpm dev</code>.
        </p>
      ) : null}

      {state.phase === "ready" ? (
        <>
          <p className="health">
            daemon {state.health.service}: {state.health.status}
            {state.health.ready ? " · ready" : ""}
          </p>
          {state.bench.length === 0 ? (
            <section className="empty">
              <h2>No bots on the bench</h2>
              <p>
                The talent pool is empty. Staff a bot once Bot Studio lands.
              </p>
            </section>
          ) : (
            <ul className="bench">
              {state.bench.map((bot) => (
                <li key={bot.id}>
                  <strong>{bot.name}</strong>{" "}
                  <span className="muted">@{bot.handle}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </main>
  );
}
