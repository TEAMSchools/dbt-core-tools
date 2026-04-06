import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <div>Lineage placeholder</div>;
}

const container = document.getElementById("react-root");
if (container) {
  createRoot(container).render(<App />);
}
