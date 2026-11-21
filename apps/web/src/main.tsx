import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/source-sans-3/index.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@ui-sdk/core/web.css";
import "./ui/tokens.css";
import "./ui/kit.css";
import "./ui/theme.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { AuthProvider } from "./auth/session";
import { PendingProvider } from "./pending/PendingProvider";
import { ThemeProvider } from "./ui/ThemeProvider";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider><QueryClientProvider client={queryClient}><AuthProvider><PendingProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PendingProvider></AuthProvider></QueryClientProvider></ThemeProvider>
  </StrictMode>,
);
