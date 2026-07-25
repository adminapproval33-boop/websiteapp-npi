import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import AppLayout from "./layout/AppLayout";
import LoginPage from "./pages/Login/LoginPage";
import ChangePasswordPage from "./pages/ChangePassword/ChangePasswordPage";
import PrintCheckSheetPage from "./pages/Print/PrintCheckSheetPage";
import PrintCoaPage from "./pages/Print/PrintCoaPage";
import { flattenLeaves, homeRoute, menuTree, resolveLeafElement } from "./layout/menu";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const leaves = flattenLeaves(menuTree);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/change-password" element={<ChangePasswordPage />} />
              <Route path="/print/check-sheet/:checkId" element={<PrintCheckSheetPage />} />
              <Route path="/print/coa/:checkId" element={<PrintCoaPage />} />
              <Route element={<AppLayout />}>
                <Route path={homeRoute.path} element={homeRoute.element} />
                {leaves.map((leaf) => (
                  <Route key={leaf.path} path={leaf.path} element={resolveLeafElement(leaf)} />
                ))}
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
