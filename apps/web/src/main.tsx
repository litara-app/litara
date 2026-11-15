import "@mantine/core/styles.css";
import "./a11y.css";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { theme } from "./theme";
import { AuthProvider } from "./auth/session";
import { PendingProvider } from "./pending/PendingProvider";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <QueryClientProvider client={queryClient}><AuthProvider><PendingProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PendingProvider></AuthProvider></QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
