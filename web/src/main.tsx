import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "./lib/store";
import { App } from "./App";
import "./styles/app.css";
import "./components/Splash.css";
import "./pages/Login.css";
import "./pages/Landing.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root is missing");

createRoot(host).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
