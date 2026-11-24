import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/source-sans-3/index.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@ui-sdk/core/web.css";
import "./ui/tokens.css";
import "./ui/kit.css";
import "./ui/theme.css";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { AuthProvider } from "./auth/session";
import { PendingProvider } from "./pending/PendingProvider";
import { ThemeProvider } from "./ui/ThemeProvider";
import { notify, notifyError, NotificationHost } from "./ui/notify";

// Responses to actions are notifications (ADR-0089): a failed mutation is reported once, and a mutation that names a
// success message (meta.success) reports it. A mutation can opt out of either with meta.quiet.
const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => { if (!mutation.meta?.quiet) notifyError(error, typeof mutation.meta?.failure === "string" ? mutation.meta.failure : undefined); },
    onSuccess: (data, vars, _ctx, mutation) => {
      const m = mutation.meta?.success;
      const text = typeof m === "function" ? (m as (d: unknown, v: unknown) => string | null)(data, vars) : m;
      if (typeof text === "string" && text) notify.success(text);
    },
  }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider><QueryClientProvider client={queryClient}><AuthProvider><PendingProvider>
      <BrowserRouter>
        <NotificationHost />
        <App />
      </BrowserRouter>
    </PendingProvider></AuthProvider></QueryClientProvider></ThemeProvider>
  </StrictMode>,
);
