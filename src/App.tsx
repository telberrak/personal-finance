import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { TabLayout } from './components/Layout';
import { useTheme } from './components/useTheme';
import { useFinanceData } from './db/db';
import { Activity } from './pages/Activity';
import { AddTransaction } from './pages/AddTransaction';
import { Bills } from './pages/Bills';
import { Budgets } from './pages/Budgets';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';

export function App() {
  const data = useFinanceData();
  useTheme(data?.settings.theme);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<TabLayout />}>
          <Route index element={<Home data={data} />} />
          <Route path="activity" element={<Activity data={data} />} />
          <Route path="bills" element={<Bills data={data} />} />
          <Route path="budgets" element={<Budgets data={data} />} />
        </Route>
        <Route path="add" element={<AddTransaction data={data} />} />
        <Route path="settings" element={<Settings data={data} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
