import { Container, Title } from "@mantine/core";
import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";

// Compiled only for proof builds; tree-shaken from production.
const ProofPage = import.meta.env.VITE_READER_PROOF
  ? lazy(() => import("./reader/ProofPage").then((m) => ({ default: m.ProofPage })))
  : null;

// Placeholder shell: library, reader and administration routes arrive in
// later T005 milestones. This is not a completed reading experience.
function Home() {
  return (
    <Container py="xl">
      <Title order={1}>Litara</Title>
    </Container>
  );
}

export function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        {ProofPage && <Route path="/read/proof" element={<ProofPage />} />}
        <Route path="*" element={<Home />} />
      </Routes>
    </Suspense>
  );
}
