import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { LiveProvider } from './context/LiveContext';
import { ThemeProvider } from './context/ThemeContext';
import RequireAuth from './components/RequireAuth';
import RequireOwner from './components/RequireOwner';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Repairs from './pages/Repairs';
import Sales from './pages/Sales';
import Reports from './pages/Reports';
import Liabilities from './pages/Liabilities';
import Workers from './pages/Workers';
import Billing from './pages/Billing';

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <AuthProvider>
      <LiveProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="repairs" element={<Repairs />} />
            <Route path="sales" element={<Sales />} />
            <Route path="reports" element={<RequireOwner><Reports /></RequireOwner>} />
            <Route path="liabilities" element={<RequireOwner><Liabilities /></RequireOwner>} />
            <Route path="workers" element={<RequireOwner><Workers /></RequireOwner>} />
            <Route path="billing" element={<RequireOwner><Billing /></RequireOwner>} />
          </Route>
        </Routes>
      </LiveProvider>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
